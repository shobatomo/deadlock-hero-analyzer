import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {createSyncRunRecorder} from '../public-app/backend/deadhub/sync-runs.js'
import {createRecordSync} from '../public-app/backend/deadhub/sync.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {RecordError} from '../public-app/backend/deadhub/provider.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
const owner='00000000-0000-4000-8000-000000000001',origin='https://audit.example.test'
const privateError=()=>Object.assign(new Error('DUMMY_PRIVATE_COOKIE'),{code:'DUMMY_PRIVATE_CODE'})
function fixture(overrides={}){
  const rows=[],logs=[],reports=[]
  const store={
    async startSyncRun(id,run_id,source){rows.push({id,run_id,source,outcome:'started'})},
    async finishSyncRun(id,run_id,result){Object.assign(rows.find(r=>r.run_id===run_id&&r.id===id),result)},
    async syncRunSnapshot(){return {sources:{}}},...overrides
  }
  const audit=createSyncRunRecorder({store,logger:(...args)=>logs.push(args)})
  const run=(source,op)=>audit.run(owner,source,op,value=>reports.push(value))
  return {audit,store,rows,logs,reports,run}
}
test('success with zero rows and partial remain distinct; unknown results never become success',async()=>{
  const f=fixture()
  for(const value of [{status:'success',processed:0},{status:'partial',processed:90},{status:'success',processed:-1},{status:'unknown',processed:0}])
    assert.equal(await f.run('manual',async()=>value),value)
  assert.deepEqual(f.rows.map(r=>[r.outcome,r.result_code,r.processed_count]),[
    ['success','complete',0],['partial','page_limit',90],['failed','unexpected_result',null],['failed','unexpected_result',null]])
  assert.deepEqual(f.reports,Array(4).fill('recorded'));assert.deepEqual(f.logs,[])
})
test('safe error codes only, preserving the exact original thrown value',async()=>{
  const f=fixture()
  for(const code of ['shared_busy','not_registered','busy','cooldown','rate_limited','provider_timeout','lease_lost','provider_paused','DUMMY_PRIVATE_CODE']){
    const error=new RecordError(code)
    await assert.rejects(f.run('cron_endpoint',async()=>{throw error}),e=>e===error)
  }
  const error=privateError();await assert.rejects(f.run('manual',async()=>{throw error}),e=>e===error)
  assert.deepEqual(f.rows.map(r=>r.outcome),['skipped','skipped','skipped','skipped','failed','failed','failed','failed','failed','failed'])
  assert.equal(f.rows.at(-1).result_code,'sync_failed');assert.equal(f.rows.at(-2).result_code,'sync_failed')
  assert.ok(!JSON.stringify(f.rows).includes('DUMMY'));assert.deepEqual(f.logs,[])
})
test('start/finish/read diagnostics have fixed codes and cannot override synchronization',async()=>{
  for(const stage of ['startSyncRun','finishSyncRun'])for(const fails of [false,true]){
    const f=fixture({[stage]:async()=>{throw privateError()}}),value={status:'success',processed:0},error=new RecordError('provider_timeout')
    const pending=f.run('manual',async()=>{if(fails)throw error;return value})
    if(fails)await assert.rejects(pending,e=>e===error);else assert.equal(await pending,value)
    assert.deepEqual(f.reports,['unavailable'])
    assert.deepEqual(f.logs,[[stage==='startSyncRun'?'DEADHUB_SYNC_AUDIT_START_FAILED':'DEADHUB_SYNC_AUDIT_FINISH_FAILED']])
    if(stage==='finishSyncRun')assert.equal(f.rows[0].outcome,'started')
  }
  const f=fixture({syncRunSnapshot:async()=>{throw privateError()}})
  assert.deepEqual(await f.audit.snapshot(owner),{available:false,evidence:'unavailable',cron_origin_verified:false,sources:null})
  assert.deepEqual(f.logs,[['DEADHUB_SYNC_AUDIT_READ_FAILED']])
  const audit=createSyncRunRecorder({store:f.store,logger:()=>{throw privateError()}})
  assert.equal((await audit.snapshot(owner)).available,false)
  await assert.rejects(f.run('untrusted-source',async()=>{}),TypeError)
})
test('overlapping requests use separate run IDs; a pending operation stays started',async()=>{
  const f=fixture();let finish,started
  const waiting=new Promise(r=>{started=r}),pending=f.run('cron_endpoint',()=>{started();return new Promise(r=>{finish=r})})
  await waiting;assert.equal(f.rows[0].outcome,'started')
  await f.run('manual',async()=>({status:'success',processed:0}))
  assert.equal(f.rows[0].outcome,'started');assert.equal(f.rows[1].outcome,'success')
  assert.notEqual(f.rows[0].run_id,f.rows[1].run_id)
  finish({status:'partial',processed:30});await pending;assert.equal(f.rows[0].outcome,'partial')
})
test('actual sync: shared lock skip calls no provider and release failure is never audited as success',async()=>{
  for(const stage of ['acquire','release']){
    const f=fixture(),calls=[],sync=createRecordSync({store:{
      acquire:async()=>{calls.push('account');return {token:'dummy'}},savePage:async()=>calls.push('saved')},
      provider:{page:async()=>{calls.push('provider');return {done:true,records:[]}}},
      gate:{acquire:async()=>{if(stage==='acquire')throw new RecordError('shared_busy');return 'gate'},
        release:async()=>{throw new RecordError('shared_unavailable')}}})
    await assert.rejects(f.run('cron_endpoint',()=>sync(owner)),e=>e.code===(stage==='acquire'?'shared_busy':'shared_unavailable'))
    assert.equal(f.rows[0].outcome,stage==='acquire'?'skipped':'failed')
    assert.deepEqual(calls,stage==='acquire'?[]:['account','provider','saved'])
  }
})
test('actual sync: page limit, timeout and failure after a saved page retain existing criteria',async()=>{
  for(const scenario of ['partial','timeout','failed']){
    const f=fixture(),calls=[];let pages=0,now=0
    const sync=createRecordSync({store:{acquire:async()=>({token:'dummy'}),savePage:async()=>calls.push('saved'),
      finishPartial:async()=>calls.push('partial'),fail:async(id,token,code)=>calls.push(code)},
      provider:{page:async()=>{pages++;if(pages===2&&scenario==='failed')throw new RecordError('rate_limited');return {done:false,records:[{}],cursor:pages}}},
      delay:async()=>{if(scenario==='timeout')now=46000},now:()=>now})
    const pending=f.run('cron_endpoint',()=>sync(owner))
    if(scenario==='partial'){assert.deepEqual(await pending,{status:'partial',processed:3});assert.equal(f.rows[0].outcome,'partial')}
    else {await assert.rejects(pending);assert.equal(f.rows[0].outcome,'failed');assert.equal(f.rows[0].processed_count,null)}
    assert.equal(calls[0],'saved')
  }
})
function route(app,url,{method='GET',body={},headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=new IncomingMessage(new Socket()),res=new ServerResponse(req),payload=JSON.stringify(body)
    req.method=method;req.url=url;req.headers={...(method==='POST'?{origin,'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}),...headers}
    const timer=setTimeout(()=>reject(Error('Fixture route timeout')),1500)
    res.end=function(chunk){clearTimeout(timer);resolve({status:this.statusCode,headers:this.getHeaders(),body:JSON.parse(Buffer.from(chunk??'{}').toString())});return this}
    app.handle(req,res,e=>{clearTimeout(timer);reject(e??Error('Unhandled route'))})
    if(method==='POST')req.push(payload);req.push(null)
  })
}
test('routes assign sources server-side; unauthorized and invalid bodies create no audit record',async()=>{
  const f=fixture(),calls=[];let authenticated=true,registrationFails=false
  const store={...f.store,register:async()=>{calls.push('register');if(registrationFails)throw new RecordError('already_registered',409)},snapshot:async()=>({matches:[]})}
  const auth={origin,identify:async()=>{if(!authenticated)throw new RecordError('unauthorized',401);return {owner,accountId:'1'}}}
  const app=createDeadhubApp({store,auth,syncRuns:f.audit,cronOwner:owner,cronSecret:'c'.repeat(32),sync:async()=>{calls.push('sync');return {status:'success',processed:0}}})
  for(const path of ['sync','register']){
    const result=await route(app,'/api/deadhub/'+path+'?source=cron_endpoint',{method:'POST',headers:{'x-sync-source':'cron_endpoint'}})
    assert.equal(result.status,200);assert.equal(result.headers['x-deadhub-sync-recording'],'recorded')
    assert.deepEqual(result.body,{status:'success',processed:0})
  }
  await route(app,'/api/deadhub/cron?source=manual',{headers:{authorization:'Bearer '+'c'.repeat(32),'x-vercel-cron':'1'}})
  assert.deepEqual(f.rows.map(r=>r.source),['manual','registration','cron_endpoint']);assert.deepEqual(calls,['sync','register','sync','sync'])
  assert.equal((await route(app,'/api/deadhub/sync',{method:'POST',body:{source:'cron_endpoint'}})).status,400)
  assert.equal((await route(app,'/api/deadhub/cron')).status,401)
  authenticated=false;assert.equal((await route(app,'/api/deadhub/sync',{method:'POST'})).status,401)
  assert.equal((await route(app,'/api/deadhub/sync-runs')).status,401);assert.equal(f.rows.length,3)
  authenticated=true;registrationFails=true
  assert.equal((await route(app,'/api/deadhub/register',{method:'POST'})).status,409)
  assert.equal(f.rows[3].source,'registration');assert.equal(f.rows[3].outcome,'failed');assert.equal(calls.at(-1),'register')
  assert.equal((await route(app,'/api/deadhub/sync-runs')).body.cron_origin_verified,false)
})
test('audit failures leave records and existing success/error/cron skip response semantics intact',async()=>{
  for(const code of [null,'shared_busy','provider_timeout']){
    const f=fixture({startSyncRun:async()=>{throw privateError()},syncRunSnapshot:async()=>{throw privateError()}})
    const app=createDeadhubApp({store:{snapshot:async()=>({matches:[{kills:0}]})},auth:{origin,identify:async()=>({owner})},
      syncRuns:f.audit,cronSecret:'c'.repeat(32),cronOwner:owner,sync:async()=>{if(code)throw new RecordError(code);return {status:'success',processed:0}}})
    const result=await route(app,'/api/deadhub/cron',{headers:{authorization:'Bearer '+'c'.repeat(32)}})
    assert.equal(result.headers['x-deadhub-sync-recording'],'unavailable')
    assert.equal(result.status,code==='provider_timeout'?502:200)
    assert.equal(result.body.status,code==='shared_busy'?'skipped':code===null?'success':undefined)
    assert.equal((await route(app,'/api/deadhub/sync-runs')).body.available,false)
    const records=await route(app,'/api/deadhub/records?month=2026-10');assert.equal(records.status,200);assert.deepEqual(records.body.matches,[{kills:0}])
  }
})

test('real session authentication scopes the inspection API to the caller, ignoring foreign-owner query/header claims',async()=>{
  const tokens=['a','b','c','d'].map(c=>c.repeat(43)),lookups=[],reads=[]
  const sessions=new Map(tokens.map((token,i)=>[hashToken(token),{
    steam_account_id:String(i+1),owner_id:ownerForAccount(String(i+1))
  }]))
  // A malformed DB session binding must not authorize its claimed owner either.
  sessions.set(hashToken(tokens[3]),{steam_account_id:'1',owner_id:ownerForAccount('2')})
  const ownResult={outcome:'failed',result_code:'provider_timeout',processed_count:null},
    otherResult={outcome:'success',result_code:'complete',processed_count:12}
  const store={
    resolveSession:async hash=>{lookups.push(hash);return sessions.get(hash)??null},
    syncRunSnapshot:async id=>{reads.push(id);return {sources:{manual:{latest:id===ownerForAccount('1')?ownResult:otherResult}}}}
  }
  const auth=createSteamAuth({store,origin,allowedAccounts:['1','2'],fetchImpl:()=>{throw Error('Unexpected external request')}})
  const audit=createSyncRunRecorder({store,logger:()=>{throw Error('Unexpected log')}})
  const app=createDeadhubApp({store,auth,syncRuns:audit,cronOwner:ownerForAccount('1'),cronSecret:'z'.repeat(32),sync:async()=>{throw Error('Read-only route must not sync')}})
  const session=index=>({cookie:'__Host-deadhub_session='+tokens[index]})
  const request=async(index,target)=>route(app,'/api/deadhub/sync-runs?owner_id='+ownerForAccount(target)+'&account_id='+target+'&source=cron_endpoint',
    {headers:{...session(index),'x-owner-id':ownerForAccount(target),'x-sync-source':'cron_endpoint'}})
  const first=await request(0,'2'),second=await request(1,'1')
  assert.equal(first.status,200);assert.equal(second.status,200)
  assert.deepEqual(first.body.sources.manual.latest,ownResult);assert.deepEqual(second.body.sources.manual.latest,otherResult)
  assert.deepEqual(reads,[ownerForAccount('1'),ownerForAccount('2')])
  assert.deepEqual(lookups,[hashToken(tokens[0]),hashToken(tokens[1])])
  for(const result of [first,second]){
    assert.equal(result.headers['cache-control'],'private, no-store')
    assert.equal(result.headers['access-control-allow-origin'],undefined)
    assert.equal(result.body.cron_origin_verified,false)
    assert.ok(!JSON.stringify(result.body).includes(ownerForAccount('1')))
    assert.ok(!JSON.stringify(result.body).includes(ownerForAccount('2')))
    assert.ok(!JSON.stringify(result.body).includes('steam_account_id'))
  }
  for(const headers of [{},{authorization:'Bearer '+'z'.repeat(32)},session(2),session(3),
    {cookie:'__Host-deadhub_session='+'e'.repeat(43)},
    {cookie:'__Host-deadhub_session='+tokens[0]+'; __Host-deadhub_session='+tokens[1]}]){
    const denied=await route(app,'/api/deadhub/sync-runs',{headers})
    assert.equal(denied.status,401);assert.equal(denied.body.code,'unauthorized')
    assert.equal(denied.body.sources,undefined)
  }
  assert.equal(reads.length,2,'Rejected requests must never reach the audit store')
  sessions.delete(hashToken(tokens[0])) // Expired/revoked session is absent from the store.
  assert.equal((await request(0,'1')).status,401)
  assert.equal(reads.length,2)
})

test('audit errors containing request, credential and account fields yield only fixed diagnostics and safe HTTP errors',async()=>{
  const secret='DUMMY_SECRET_VALUE',logs=[]
  const error=Object.assign(new Error(secret),{code:secret,detail:secret,stack:secret,
    request:{headers:{authorization:secret,cookie:secret},url:secret},steam_id:secret,match_id:secret})
  for(const stage of ['startSyncRun','finishSyncRun','syncRunSnapshot']){
    const f=fixture({[stage]:async()=>{throw error}})
    const audit=createSyncRunRecorder({store:f.store,logger:(...args)=>logs.push(args)})
    const app=createDeadhubApp({store:f.store,auth:{origin,identify:async()=>({owner})},syncRuns:audit,
      sync:async()=>{throw error}})
    const response=stage==='syncRunSnapshot'?await route(app,'/api/deadhub/sync-runs'):
      await route(app,'/api/deadhub/sync',{method:'POST',headers:{authorization:secret,cookie:secret}})
    assert.ok(!JSON.stringify(response).includes(secret))
    if(stage==='syncRunSnapshot'){
      assert.equal(response.body.available,false);assert.equal(response.body.sources,null)
    }else{
      assert.equal(response.status,503);assert.equal(response.body.code,'request_failed')
      assert.equal(response.headers['x-deadhub-sync-recording'],'unavailable')
    }
  }
  assert.deepEqual(logs,[['DEADHUB_SYNC_AUDIT_START_FAILED'],['DEADHUB_SYNC_AUDIT_FINISH_FAILED'],['DEADHUB_SYNC_AUDIT_READ_FAILED']])
})

test('a failed start followed by a readable empty history remains incomplete evidence, never proof of non-execution',async()=>{
  const empty={sources:Object.fromEntries(['manual','registration','cron_endpoint'].map(source=>[source,{
    latest:null,last_success:null,last_failure:null,unfinished_count:'0',oldest_unfinished_at:null
  }]))}
  let operations=0,finishes=0,readFails=false
  const f=fixture({startSyncRun:async()=>{throw privateError()},finishSyncRun:async()=>{finishes++},
    syncRunSnapshot:async()=>{if(readFails)throw privateError();return empty}})
  const result=await f.run('cron_endpoint',async()=>{operations++;return {status:'success',processed:0}})
  assert.deepEqual(result,{status:'success',processed:0});assert.equal(operations,1);assert.equal(finishes,0)
  assert.deepEqual(f.reports,['unavailable'])
  const snapshot=await f.audit.snapshot(owner)
  assert.equal(snapshot.available,true);assert.equal(snapshot.evidence,'recorded_attempts_only')
  assert.equal(snapshot.sources.cron_endpoint.latest,null);assert.equal(snapshot.cron_origin_verified,false)
  assert.equal(snapshot.never_executed,undefined)
  readFails=true
  const unavailable=await f.audit.snapshot(owner)
  assert.equal(unavailable.available,false);assert.equal(unavailable.evidence,'unavailable');assert.equal(unavailable.sources,null)
})
