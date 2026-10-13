import test from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createPublicApp} from '../backend/public-app.js'
import {FEEDBACK_CHOICES} from '../shared/feedback.mjs'
async function withServer(store, run, timeout=100, limits={}, collector={}) {
 const server = createPublicApp({collector,feedbackStore:store,feedbackTimeoutMs:timeout,feedbackLimits:limits}).listen(0,'127.0.0.1')
 await once(server,'listening')
 const url='http://127.0.0.1:'+server.address().port
 const post=(body,headers={})=>fetch(url+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)})
 try { await run({url,post}) } finally { await new Promise(resolve=>server.close(resolve)) }
}
test('disconnected API never claims storage',async()=>withServer(null,async({url,post})=>{
 assert.deepEqual(await (await fetch(url+'/api/feedback')).json(),{enabled:false})
 const res=await post({choice:FEEDBACK_CHOICES[0]})
 assert.equal(res.status,503);assert.equal(res.headers.get('cache-control'),'no-store')
 assert.deepEqual(await res.json(),{status:'not_stored',retryable:true})
}))
test('only exact choice reaches aggregate sink, no body extras or identities',async()=>{
 const calls=[]
 await withServer({increment:async choice=>{calls.push(choice);return {status:'stored'}}},async({url,post})=>{
  assert.deepEqual(await (await fetch(url+'/api/feedback')).json(),{enabled:true})
  for(const choice of FEEDBACK_CHOICES){const res=await post({choice});assert.equal(res.status,200);assert.deepEqual(await res.json(),{status:'stored'})}
  for(const body of [{},{choice:'役に立った'},{choice:FEEDBACK_CHOICES[0],account_id:'1'},{choice:FEEDBACK_CHOICES[0],text:'x'},[],null])assert.equal((await post(body)).status,400)
  assert.equal((await post({choice:FEEDBACK_CHOICES[0]},{'Content-Type':'text/plain'})).status,400)
  assert.equal((await post({choice:FEEDBACK_CHOICES[0]},{Origin:'https://foreign.example'})).status,403)
  assert.equal((await post({choice:FEEDBACK_CHOICES[0]},{'Sec-Fetch-Site':'cross-site'})).status,403)
  assert.equal((await fetch(url+'/api/feedback',{method:'PUT'})).status,404)
  const malformed=await fetch(url+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})
  assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{status:'not_stored',retryable:true})
  const oversized=await post({choice:'x'.repeat(2048)});assert.equal(oversized.status,413);assert.deepEqual(await oversized.json(),{status:'not_stored',retryable:true})
  for(const headers of [{'Content-Type':'application/json; charset=iso-8859-1'},{'Content-Encoding':'unsupported'}]){const rejected=await post({choice:FEEDBACK_CHOICES[0]},headers);assert.equal(rejected.status,415);assert.deepEqual(await rejected.json(),{status:'not_stored',retryable:true})}
 })
 assert.deepEqual(calls,FEEDBACK_CHOICES)
})
test('only guaranteed noncommit permits retry, uncertain failures never claim success',async()=>{
 for(const [increment,expected] of [
  [async()=>({status:'not_stored'}),{status:'not_stored',retryable:true}],
  [async()=>{throw new Error('private details')},{status:'unknown',retryable:false}],
  [async()=>undefined,{status:'unknown',retryable:false}],
  [()=>new Promise(()=>{}),{status:'unknown',retryable:false}],
 ])await withServer({increment},async({post})=>{const res=await post({choice:FEEDBACK_CHOICES[0]});assert.ok(!res.ok);assert.deepEqual(await res.json(),expected)})
})

test('anonymous window quota bounds writes and recovers without individual records',async()=>{
 let now=0,calls=0
 await withServer({increment:async()=>{calls++;return {status:'stored'}}},async({post})=>{
  for(let i=0;i<2;i++)assert.equal((await post({choice:FEEDBACK_CHOICES[0]})).status,200)
  const limited=await post({choice:FEEDBACK_CHOICES[0]});assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');assert.deepEqual(await limited.json(),{status:'not_stored',retryable:true});assert.equal(calls,2)
  now=60000;assert.equal((await post({choice:FEEDBACK_CHOICES[0]})).status,200);assert.equal(calls,3)
 },100,{maxRequests:2,windowMs:60000,maxConcurrent:1,now:()=>now})
})
test('timeout retains concurrent slot until actual write completion',async()=>{
 let finish,calls=0
 await withServer({increment:()=>{calls++;return new Promise(resolve=>{finish=resolve})}},async({post})=>{
  const timeout=await post({choice:FEEDBACK_CHOICES[0]});assert.equal(timeout.status,502);assert.deepEqual(await timeout.json(),{status:'unknown',retryable:false})
  const busy=await post({choice:FEEDBACK_CHOICES[0]});assert.equal(busy.status,429);assert.deepEqual(await busy.json(),{status:'not_stored',retryable:true});assert.equal(calls,1)
  finish({status:'stored'});await new Promise(resolve=>setImmediate(resolve))
  const next=post({choice:FEEDBACK_CHOICES[0]});while(calls<2)await new Promise(resolve=>setImmediate(resolve));finish({status:'stored'});assert.equal((await next).status,200)
 },20,{maxRequests:10,maxConcurrent:1})
})

test('diagnosis parser and acquisition errors retain their original contracts',async()=>{
 let diagnosisCalls=0,feedbackCalls=0
 const collector={collect:async()=>{diagnosisCalls++;throw Object.assign(new Error('private'),{code:'reference_unavailable'})}}
 await withServer({increment:async()=>{feedbackCalls++;return {status:'stored'}}},async({url})=>{
  const malformed=await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})
  assert.equal(malformed.status,400);assert.deepEqual(await malformed.json(),{error:'入力JSONを確認してください。'})
  const failed=await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})
  assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'比較に使うデータを利用できません。'})
  assert.equal((await fetch(url+'/api/health')).status,200)
 },100,{},collector)
 assert.equal(diagnosisCalls,1);assert.equal(feedbackCalls,0)
})
