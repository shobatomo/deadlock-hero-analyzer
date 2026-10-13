import test from 'node:test'
import assert from 'node:assert/strict'
import {createFeedbackStore, createRuntimeFeedback, INCREMENT_SQL} from '../backend/feedback-store.js'
import {FEEDBACK_CHOICES} from '../shared/feedback.mjs'
const ref='adxoqjgmhmortztqngcz'
// Synthetic fixtures only; never load .env or existing credentials.
const fixtureUrl=(pooled=false)=>{
 const url=new URL('postgresql:'+'//'+(pooled?'aws-0-ap-northeast-1.pooler.supabase.com':`db.${ref}.supabase.co`)+'/postgres')
 url.username='fyth_feedback_app_login'+(pooled?'.'+ref:'');url.password='fixture-only'
 url.search='sslmode=disable&options=unsafe';return url.toString()
}
function fakePool(behaviour=async()=>({rows:[{status:'stored'}]})){
 const connections=[],queries=[]
 class Pool {
  constructor(options){connections.push(options)}
  on(){}
  query(options){queries.push(options);return behaviour(options)}
  end(){return Promise.resolve()}
 }
 return {Pool,connections,queries}
}
test('disabled mode never reads connection values or constructs a pool',()=>{
 const env=new Proxy({}, {get:(target,key)=>{if(key==='FYTH_FEEDBACK_ENABLED')return 'false';throw Error('unexpected configuration access')}})
 const fake=fakePool();assert.equal(createRuntimeFeedback({env,Pool:fake.Pool}),null);assert.equal(fake.connections.length,0)
})
test('missing or wrong target configuration stays unavailable',()=>{
 const fake=fakePool()
 for(const connectionString of [undefined,'bad',fixtureUrl().replace(ref,'other-project'),fixtureUrl().replace('fyth_feedback_app_login','fyth_reader')])assert.equal(createRuntimeFeedback({env:{FYTH_FEEDBACK_ENABLED:'true',FYTH_FEEDBACK_DB_URL:connectionString},Pool:fake.Pool}),null)
 assert.equal(fake.connections.length,0)
})
test('only dedicated direct/pooler connection and TLS-safe bounded options are accepted',async()=>{
 for(const pooled of [false,true]){
  const fake=fakePool();const store=createFeedbackStore({connectionString:fixtureUrl(pooled),ca:'fixture-ca',Pool:fake.Pool})
  const options=fake.connections[0]
  assert.equal(options.ssl.rejectUnauthorized,true);assert.equal(options.ssl.ca,'fixture-ca');assert.equal(new URL(options.connectionString).search,'')
  assert.equal(options.max,1);assert.equal(options.statement_timeout,2000);assert.equal(options.lock_timeout,500)
  assert.equal(options.options,'-c default_transaction_isolation=read\\ committed')
  await store.close()
 }
})
test('choice uses one fixed parameterized autocommit statement, no identity/extra SQL',async()=>{
 const fake=fakePool();const store=createFeedbackStore({connectionString:fixtureUrl(),Pool:fake.Pool})
 for(const choice of FEEDBACK_CHOICES)assert.deepEqual(await store.increment(choice),{status:'stored'})
 assert.equal(fake.queries.length,3)
 fake.queries.forEach((q,index)=>{assert.equal(q.text,INCREMENT_SQL);assert.deepEqual(q.values,[FEEDBACK_CHOICES[index]]);assert.equal(q.query_timeout,3000)})
 assert.deepEqual(await store.increment('理由を入力'),{status:'not_stored'});assert.equal(fake.queries.length,3)
})
test('never reports stored before query completion',async()=>{
 let finish;const fake=fakePool(()=>new Promise(resolve=>{finish=resolve}))
 const store=createFeedbackStore({connectionString:fixtureUrl(),Pool:fake.Pool})
 let settled=false;const pending=store.increment(FEEDBACK_CHOICES[0]).then(result=>{settled=true;return result})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false)
 finish({rows:[{status:'stored'}]});assert.deepEqual(await pending,{status:'stored'})
})
test('known quota rejection is retryable upstream; malformed outcome/driver failure is unknown, no retry',async()=>{
 for(const behaviour of [async()=>({rows:[]}),async()=>({rows:[{status:'unknown'}]}),async()=>{throw Error('fixture transport loss')}]){
  const fake=fakePool(behaviour);const store=createFeedbackStore({connectionString:fixtureUrl(),Pool:fake.Pool})
  await assert.rejects(store.increment(FEEDBACK_CHOICES[0]));assert.equal(fake.queries.length,1)
 }
 const fake=fakePool(async()=>({rows:[{status:'not_stored'}]}));const store=createFeedbackStore({connectionString:fixtureUrl(),Pool:fake.Pool})
 assert.deepEqual(await store.increment(FEEDBACK_CHOICES[0]),{status:'not_stored'})
})

test('explicit disabled-mode probe checks metadata without increment, expiry or count data',async()=>{
 const {checkFeedbackConnection}=await import('./check-feedback-connection.mjs')
 const {CONNECTION_CHECK_SQL}=await import('../backend/feedback-store.js')
 const metadata={current_role:'fyth_feedback_app_login',session_role:'fyth_feedback_app_login',isolation:'read committed',statement_timeout:'2s',lock_timeout:'500ms',can_increment:true,can_expire:false,can_access_table:false,can_create:false,can_set_owner:false,can_set_maintenance:false}
 const fake=fakePool(async()=>({rows:[metadata]}))
 const result=await checkFeedbackConnection({env:{FYTH_FEEDBACK_ENABLED:'false',FYTH_FEEDBACK_DB_URL:fixtureUrl()},Pool:fake.Pool})
 assert.deepEqual(result,{status:'passed',metadata_only:true,writes:0,public_api_enabled:false,cron_verified:false,backup_verified:false})
 assert.equal(fake.queries.length,1);assert.equal(fake.queries[0].text,CONNECTION_CHECK_SQL);assert.equal(fake.queries[0].values,undefined)
 assert.notEqual(fake.queries[0].text,INCREMENT_SQL)
 const forbidden=fakePool();assert.equal((await checkFeedbackConnection({env:{FYTH_FEEDBACK_ENABLED:'true'},Pool:forbidden.Pool})).status,'failed');assert.equal(forbidden.connections.length,0)
})
test('probe refuses unexpected identity/privileges/timeouts and hides raw driver failures',async()=>{
 const {checkFeedbackConnection}=await import('./check-feedback-connection.mjs')
 const metadata={current_role:'fyth_feedback_app_login',session_role:'fyth_feedback_app_login',isolation:'read committed',statement_timeout:'2s',lock_timeout:'500ms',can_increment:true,can_expire:false,can_access_table:false,can_create:false,can_set_owner:false,can_set_maintenance:false}
 for(const change of [{current_role:'postgres'},{session_role:'postgres'},{can_access_table:true},{can_expire:true},{statement_timeout:'0'},{lock_timeout:'1s'},{isolation:'repeatable read'}]){
  const fake=fakePool(async()=>({rows:[{...metadata,...change}]}))
  assert.deepEqual(await checkFeedbackConnection({env:{FYTH_FEEDBACK_DB_URL:fixtureUrl()},Pool:fake.Pool}),{status:'failed',code:'feedback_connection_check_failed'})
 }
 const fake=fakePool(async()=>{throw Error('fixture sensitive details must stay hidden')})
 assert.deepEqual(await checkFeedbackConnection({env:{FYTH_FEEDBACK_DB_URL:fixtureUrl()},Pool:fake.Pool}),{status:'failed',code:'feedback_connection_check_failed'})
})
