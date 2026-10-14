import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter,once} from 'node:events'
import {beginUsage} from '../backend/usage.js'
import {createUsageStore,createRuntimeUsage,USAGE_SQL} from '../backend/usage-store.js'
import {USAGE_EVENTS} from '../shared/usage.mjs'
import {createPublicApp} from '../backend/public-app.js'
import {nodeDiagnosis} from '../backend/five-axis.js'
const tick=()=>new Promise(r=>setImmediate(r))
test('request has one fixed requested and one terminal event, finish/close duplicates removed',async()=>{
 for(const expected of USAGE_EVENTS.slice(1)){
  const res=new EventEmitter(),events=[],tasks=[]
  const usage=beginUsage(res,{store:{increment:async(...args)=>{assert.equal(args.length,1);events.push(args[0])}},keepAlive:p=>tasks.push(p)})
  if(expected==='diagnosis_disconnected')res.emit('close')
  else {usage.outcome(expected);res.writableFinished=true;res.emit('finish')}
  res.emit('close');res.emit('finish');usage.outcome('diagnosis_ready')
  await Promise.all(tasks);assert.deepEqual(events,['diagnosis_requested',expected]);assert.equal(res.listenerCount('close'),0)
 }
})
test('off never reads connection fields; failing sink and lifecycle do not escape',async()=>{
 assert.equal(createRuntimeUsage({env:{get FYTH_FEEDBACK_DB_URL(){throw Error('must not read')}}}),null)
 const res=new EventEmitter(),tasks=[]
 beginUsage(res,{store:{increment(){throw Error('private failure')}},keepAlive:p=>{tasks.push(p);throw Error('lifecycle unavailable')}})
 res.emit('finish');await Promise.all(tasks)
})
test('adapter sends event-only bound SQL, bounded queue and no retry of unknown result',async()=>{
 let options,calls=[],release
 class Pool {constructor(o){options=o}on(){}end(){}query(q){calls.push(q);return new Promise(r=>release=r)}}
 const fixture=new URL('postgresql:'+'//db.adxoqjgmhmortztqngcz.supabase.co/postgres');fixture.username='fyth_feedback_app_login';fixture.password='dummy';const connectionString=fixture.toString()
 const store=createUsageStore({connectionString,Pool});const first=store.increment(USAGE_EVENTS[0]);await tick()
 assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(calls.length,1)
 assert.deepEqual(calls[0],{text:USAGE_SQL,values:[USAGE_EVENTS[0]],query_timeout:3000})
 const a=store.increment(USAGE_EVENTS[1]),b=store.increment(USAGE_EVENTS[2]),c=store.increment(USAGE_EVENTS[3])
 assert.deepEqual(await store.increment(USAGE_EVENTS[4]),{status:'not_stored'})
 assert.deepEqual(await store.increment('SteamID'),{status:'not_stored'})
 release({rows:[{status:'unexpected'}]});await assert.rejects(first);await tick()
 for(const pending of [a,b,c]){release({rows:[{status:'stored'}]});await pending;await tick()}
 assert.equal(calls.length,4)
})
async function serverTest(collector,run){
 const events=[],tasks=[]
 const s=createPublicApp({collector,timeoutMs:20,usageStore:{increment:async e=>events.push(e)},usageKeepAlive:p=>tasks.push(p)}).listen(0,'127.0.0.1')
 await once(s,'listening');const url='http://127.0.0.1:'+s.address().port
 try{await run(url,events);await Promise.all(tasks)}finally{await new Promise(r=>s.close(r))}
 return events
}
test('invalid requests and feedback never enter diagnosis metrics; failures and retries each count',async()=>{
 const events=await serverTest({collect:async()=>{throw Object.assign(Error('private input'),{code:'cooldown'})}},async url=>{
  const post=body=>fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  assert.equal((await post({account_id:'invalid'})).status,400)
  for(let i=0;i<2;i++)assert.equal((await post({account_id:'1'})).status,429)
  await fetch(url+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({choice:'まだ分からない'})})
 })
 assert.deepEqual(events,['diagnosis_requested','diagnosis_error','diagnosis_requested','diagnosis_error'])
})
test('timeout stays existing 504 and records a single error',async()=>{
 const events=await serverTest({collect:()=>new Promise(()=>{})},async url=>{
  assert.equal((await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})).status,504)
 });assert.deepEqual(events,['diagnosis_requested','diagnosis_error'])
})

test('valid withheld response completes once and failing metrics does not change success',async()=>{
 const result=nodeDiagnosis({rows:[],groups:[]})
 const events=await serverTest({collect:async()=>result},async url=>{
  const res=await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})
  assert.equal(res.status,200);assert.equal((await res.json()).five_axis.status,'withheld')
 });assert.deepEqual(events,['diagnosis_requested','diagnosis_withheld'])
 const tasks=[],server=createPublicApp({collector:{collect:async()=>result},usageStore:{increment:()=>Promise.reject(Error('private failure'))},usageKeepAlive:p=>tasks.push(p)}).listen(0,'127.0.0.1')
 await once(server,'listening')
 try{assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})).status,200);await Promise.all(tasks)}finally{await new Promise(r=>server.close(r))}
})
test('client closes a real diagnosis connection: terminal is disconnected once',async()=>{
 const events=[],tasks=[];let started
 const begun=new Promise(r=>started=r)
 const server=createPublicApp({collector:{collect:()=>{started();return new Promise(()=>{})}},usageStore:{increment:async e=>events.push(e)},usageKeepAlive:p=>tasks.push(p)}).listen(0,'127.0.0.1')
 await once(server,'listening');const controller=new AbortController()
 const response=fetch('http://127.0.0.1:'+server.address().port+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'}),signal:controller.signal}).catch(()=>{})
 try{await begun;controller.abort();await response;for(let i=0;i<100&&events.length<2;i++)await new Promise(r=>setTimeout(r,5));await Promise.all(tasks);assert.deepEqual(events,['diagnosis_requested','diagnosis_disconnected'])}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})

test('ready response uses exactly the current UI recommendation condition',async()=>{
 const fields=['kills','deaths','assists','net_worth_per_min','player_damage_per_min','player_damage_taken_per_min']
 const payload={rows:[{hero_id:15,game_mode:1,match_mode:1,match_duration_s:1200,player_kills:4,player_deaths:2,player_assists:5,net_worth:200,metadata:{status:'available',provider_snapshot_maxima:{player_damage:300,player_damage_taken:400}}}],groups:['15','3','1'].flatMap(hero=>[{hero_id:hero,group:'population',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{percentile5:0,percentile50:10,percentile95:30}]))},{hero_id:hero,group:'top',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{avg:15}]))}])}
 const events=await serverTest({collect:async()=>nodeDiagnosis(payload)},async url=>{
  const response=await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})
  assert.equal(response.status,200);assert.equal((await response.json()).five_axis.status,'ready')
 });assert.deepEqual(events,['diagnosis_requested','diagnosis_ready'])
})
