// Synthetic accounts 1/2/3 only. No real Steam login, DB, or provider request.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {invitedAccounts} from '../public-app/backend/deadhub/invitations.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createRecordSync} from '../public-app/backend/deadhub/sync.js'
import {createSharedSyncGate} from '../public-app/backend/deadhub/sync-gate.js'
import {RecordError,providerRetryAfter,MAX_RETRY_SECONDS} from '../public-app/backend/deadhub/provider.js'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const steam=accountIdToSteamId,owner=ownerForAccount,origin='https://invite.example.test'
const ns='http://specs.openid.net/auth/2.0'
test('Retry-After preserves numeric and HTTP-date pauses with bounded safe fallbacks',()=>{
  const now=Date.parse('2026-10-16T00:00:00Z')
  for(const [value,expected]of [['120',120],[new Date(now+600000).toUTCString(),600],['999999',999999],
    [new Date(now+172800000).toUTCString(),172800],['0',60],['1',60],[null,60],['',60],['invalid',60],
    [new Date(now-60000).toUTCString(),60]])assert.equal(providerRetryAfter(value,now),expected)
})
test('unrepresentable Retry-After stops instead of shortening; long finite waits retain their seconds',()=>{
  const now=Date.parse('2026-10-16T00:00:00Z')
  for(const seconds of [86401,172800,2592000,MAX_RETRY_SECONDS])assert.equal(providerRetryAfter(String(seconds),now),seconds)
  for(const value of [String(MAX_RETRY_SECONDS+1),'9'.repeat(400),'Fri, 31 Dec 9999 23:59:59 GMT'])assert.equal(providerRetryAfter(value,now),null)
  assert.equal(providerRetryAfter('0'.repeat(150)+'172800',now),172800)
})
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},json(v){this.body=v},redirect(status,url){this.status=status;this.url=url}}}
function fixture(){
  const sessions=new Map(),accounts=new Map(),calls=[],syncs=[]
  const store={
    async openSession(hash,id,account){sessions.set(hash,{owner_id:id,steam_account_id:account});return true},
    async resolveSession(hash){return sessions.get(hash)??null},async closeSession(hash){sessions.delete(hash)},
    async register(id,account){accounts.set(id,{steam_account_id:account,sync_status:'never'})},
    async snapshot(id,month){return {month,account:accounts.get(id)??null,matches:[{match_id:'77',kills:id===owner('1')?1:2}],observed:{count:1}}},
  }
  const makeAuth=allowed=>createSteamAuth({store,origin,allowedAccounts:allowed,fetchImpl:async()=>{calls.push('verify');return new Response(`ns:${ns}\nis_valid:true\n`)}})
  const auth=makeAuth(['1','2']),app=createDeadhubApp({store,auth,cronOwner:owner('1'),cronSecret:'c'.repeat(32),sync:async id=>{syncs.push(id);return {status:'success'}}})
  return {store,sessions,accounts,calls,syncs,auth,app,makeAuth}
}
async function login(auth,account){
  const res=response();await auth.start({headers:{}},res)
  const ret=new URL(new URL(res.body.url).searchParams.get('openid.return_to')),id='https://steamcommunity.com/openid/id/'+steam(account)
  const fields={ns,mode:'id_res',op_endpoint:'https://steamcommunity.com/openid/login',claimed_id:id,identity:id,return_to:ret.href,
    response_nonce:new Date().toISOString().slice(0,19)+'Zsynthetic-'+account,assoc_handle:'dummy',sig:'dummy',signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle'}
  for(const [k,v] of Object.entries(fields))ret.searchParams.set('openid.'+k,v)
  const out=response();await auth.callback({originalUrl:ret.pathname+ret.search,headers:{cookie:res.headers['Set-Cookie'].split(';')[0]}},out)
  return out.headers['Set-Cookie'][1].split(';')[0]
}
function route(app,url,{cookie='',method='GET',body={},headers={}}={}){
  return new Promise((resolve,reject)=>{
    const req=new IncomingMessage(new Socket()),res=new ServerResponse(req),payload=JSON.stringify(body)
    req.method=method;req.url=url;req.headers={cookie,...(method==='POST'?{origin,'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{}),...headers}
    const timer=setTimeout(()=>reject(Error('Fixture router timeout')),1500)
    res.end=function(chunk){clearTimeout(timer);resolve({status:this.statusCode,headers:this.getHeaders(),body:JSON.parse(Buffer.from(chunk??'{}').toString())});return this}
    app.handle(req,res,e=>{clearTimeout(timer);reject(e??Error('Unhandled fixture route'))})
    if(method==='POST')req.push(payload);req.push(null)
  })
}

test('invitation setting defaults to owner, canonicalizes and deduplicates a small private trial',()=>{
  assert.deepEqual(invitedAccounts('1',undefined),['1'])
  assert.deepEqual(invitedAccounts('1',steam('2')),['1','2'])
  assert.deepEqual(invitedAccounts('1',[steam('1'),steam('2'),steam('2')].join(',')),['1','2'])
  assert.deepEqual(invitedAccounts('1',steam('1')),['1'])
})
test('empty, noncanonical, over-limit, and partially valid invitation settings fail closed',()=>{
  for(const raw of ['',null,[],42,'2',steam('2')+' ', ' '+steam('2'),steam('2')+',',','+steam('2'),steam('2')+'\n',
    '00000000000000001',String(BigInt(steam('1'))-1n),String(BigInt(steam('1'))+2147483647n),
    steam('2')+','+steam('3'),Array(5).fill(steam('2')).join(','),'x'.repeat(10000),steam('2')+',invalid'])
    assert.throws(()=>invitedAccounts('1',raw))
})
test('two invited users log in as themselves; an uninvited assertion makes no Steam verification or session',async()=>{
  const f=fixture(),a=await login(f.auth,'1'),b=await login(f.auth,'2')
  assert.equal((await f.auth.identify({headers:{cookie:a}})).owner,owner('1'))
  assert.equal((await f.auth.identify({headers:{cookie:b}})).owner,owner('2'))
  await assert.rejects(login(f.auth,'3'),e=>e.code==='not_allowed')
  assert.equal(f.calls.length,2);assert.equal(f.sessions.size,2)
})
test('records and writes bind verified owner; same match IDs, forged query/body and cron remain separated',async()=>{
  const f=fixture(),a=await login(f.auth,'1'),b=await login(f.auth,'2')
  for(const [cookie,account,mode] of [[a,'1','daily'],[b,'2','manual']]){
    const result=await route(f.app,'/api/deadhub/records?month=2026-10&owner='+owner('3')+'&account_id=3&sync_mode=daily',{cookie})
    assert.equal(result.status,200);assert.equal(result.body.identity.steam_id,steam(account));assert.equal(result.body.sync_mode,mode)
    assert.equal(result.body.matches[0].kills,Number(account));assert.equal(result.headers['cache-control'],'private, no-store')
    assert.equal((await route(f.app,'/api/deadhub/register',{cookie,method:'POST',body:{owner:owner('3')}})).status,400)
    assert.equal((await route(f.app,'/api/deadhub/register',{cookie,method:'POST'})).status,200)
    assert.equal(f.accounts.get(owner(account)).steam_account_id,account)
    assert.equal((await route(f.app,'/api/deadhub/sync',{cookie,method:'POST',body:{account_id:'3'}})).status,400)
  }
  assert.equal((await route(f.app,'/api/deadhub/cron',{cookie:b})).status,401)
  assert.equal((await route(f.app,'/api/deadhub/cron?owner='+owner('2'),{headers:{authorization:'Bearer '+'c'.repeat(32)}})).status,200)
  assert.deepEqual(f.syncs,[owner('1'),owner('2'),owner('1')])
  assert.ok(!JSON.stringify((await route(f.app,'/api/deadhub/config')).body).includes(steam('2')))
})
test('removed invitation rejects an existing session in the new runtime; expired and forged-owner sessions reject',async()=>{
  const f=fixture(),a=await login(f.auth,'1'),b=await login(f.auth,'2'),revoked=f.makeAuth(['1'])
  await assert.rejects(revoked.identify({headers:{cookie:b}}),e=>e.code==='unauthorized')
  assert.equal((await revoked.identify({headers:{cookie:a}})).owner,owner('1'))
  const key=hashToken(a.split('=')[1]);f.sessions.get(key).owner_id=owner('2')
  await assert.rejects(f.auth.identify({headers:{cookie:a}}),e=>e.code==='unauthorized')
  f.sessions.delete(key);await assert.rejects(f.auth.identify({headers:{cookie:a}}),e=>e.code==='unauthorized')
})
function syncFixture(){
  const events=[],lease={token:'private-lease',cursor:null},store={async acquire(id){events.push(['acquire',id]);return {...lease}},async savePage(id,l,page){events.push(['save',id]);},async finishPartial(){events.push(['partial'])},async fail(id,token,code){events.push(['fail',id,code])}}
  const gate={async acquire(){events.push(['gate']);return 'shared-token'},async release(token,error){events.push(['release',token,error?.code])}}
  const provider={async page(){events.push(['page']);return {records:[],done:true}}}
  return {events,store,gate,provider}
}
test('shared admission precedes owner writes; missing gate cannot make provider or owner calls',async()=>{
  const f=syncFixture();await createRecordSync(f)('A')
  assert.deepEqual(f.events.map(e=>e[0]),['gate','acquire','page','save','release'])
  const blocked=syncFixture();blocked.gate.acquire=async()=>{throw new RecordError('shared_busy',429)}
  await assert.rejects(createRecordSync(blocked)('B'),e=>e.code==='shared_busy');assert.deepEqual(blocked.events,[])
})
test('shared lease is released on owner acquire failure, first fetch failure, and 429 even if owner failure storage fails',async()=>{
  for(const mode of ['acquire','provider','fail-store']){
    const f=syncFixture()
    if(mode==='acquire')f.store.acquire=async()=>{throw new RecordError('cooldown',429)}
    else f.provider.page=async()=>{throw new RecordError('rate_limited',502,120)}
    if(mode==='fail-store')f.store.fail=async()=>{throw Error('Synthetic DB failure')}
    let released;f.gate.release=async(token,error)=>{released={token,code:error.code,retry:error.retryAfter}}
    await assert.rejects(createRecordSync(f)('A'))
    assert.equal(released.token,'shared-token');assert.equal(released.code,mode==='acquire'?'cooldown':'rate_limited')
    if(mode!=='acquire')assert.equal(released.retry,120)
  }
})
test('deadline after delayed admission or between pages prevents late outbound calls; page budget stays three',async()=>{
  for(const phase of ['admission','delay','normal']){
    const f=syncFixture();let time=0,pages=0
    f.now=()=>time;f.provider.page=async()=>{pages++;return {records:[],cursor:String(100-pages),done:false}}
    f.delay=async ms=>{assert.equal(ms,2100);if(phase==='delay')time=45001}
    if(phase==='admission')f.gate.acquire=async()=>{time=45001;return 'shared-token'}
    if(phase==='normal'){assert.equal((await createRecordSync(f)('A')).status,'partial');assert.equal(pages,3)}
    else{await assert.rejects(createRecordSync(f)('A'),e=>e.code==='provider_timeout');assert.equal(pages,phase==='delay'?1:0)}
    assert.equal(f.events.at(-1)[0],'release')
  }
})
test('gate errors are sanitized; cooldown and token fencing use bounded SQL parameters',async()=>{
  for(const query of [async()=>{throw Error('DUMMY_DATABASE_DETAILS')},async()=>({rows:[]})])
    await assert.rejects(createSharedSyncGate({query}).acquire(),e=>e.code==='shared_unavailable'&&!e.message.includes('DUMMY'))
  const calls=[],gate=createSharedSyncGate({async query(sql,values){calls.push({sql,values});return {rows:[{singleton:true}]}}})
  const token=await gate.acquire();assert.match(token,/^[0-9a-f-]{36}$/)
  await gate.release(token,new RecordError('rate_limited',502,120));assert.deepEqual(calls.at(-1).values,[token,120000])
  await gate.release(token);assert.deepEqual(calls.at(-1).values,[token,2100])
  await gate.release(token,new RecordError('rate_limited',502,2592000));assert.deepEqual(calls.at(-1).values,[token,2592000000])
  assert.match(calls.at(-1).sql,/\$2::bigint/)
  await gate.release(token,new RecordError('provider_paused',503,null));assert.deepEqual(calls.at(-1).values,[token,null])
  assert.match(calls.at(-1).sql,/lease_token=\$1/)
})

test('an infinite shared pause blocks before owner/provider work without an invalid Retry-After',async()=>{
  const gate=createSharedSyncGate({async query(sql){return {rows:sql.startsWith('UPDATE')?[]:[{retry_seconds:null}]}}})
  let calls=0
  await assert.rejects(createRecordSync({gate,store:{async acquire(){calls++}},provider:{async page(){calls++}}})('A'),e=>e.code==='provider_paused'&&e.retryAfter===null)
  assert.equal(calls,0)
  const f=fixture(),cookie=await login(f.auth,'2')
  const app=createDeadhubApp({store:f.store,auth:f.auth,sync:async()=>{throw new RecordError('provider_paused',503,null)}})
  const result=await route(app,'/api/deadhub/sync',{cookie,method:'POST'})
  assert.equal(result.status,503);assert.equal(result.headers['retry-after'],undefined);assert.match(result.body.error,/管理者/)
})
test('shared contention returns Retry-After, cron skips without switching to the invited user',async()=>{
  const f=fixture(),cookie=await login(f.auth,'2'),seen=[]
  const app=createDeadhubApp({store:f.store,auth:f.auth,cronOwner:owner('1'),cronSecret:'c'.repeat(32),sync:async id=>{seen.push(id);throw new RecordError('shared_busy',429,80)}})
  const browser=await route(app,'/api/deadhub/sync',{cookie,method:'POST'});assert.equal(browser.status,429);assert.equal(browser.headers['retry-after'],'80')
  const cron=await route(app,'/api/deadhub/cron',{headers:{authorization:'Bearer '+'c'.repeat(32)}})
  assert.deepEqual(cron.body,{status:'skipped',reason:'shared_busy'});assert.deepEqual(seen,[owner('2'),owner('1')])
})
