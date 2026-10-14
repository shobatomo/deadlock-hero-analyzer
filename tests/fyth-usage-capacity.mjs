// Role-budget model only; shared database capacity still constrains both roles.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRuntimeFeedback} from '../public-app/backend/feedback-store.js'
import {createRuntimeUsage} from '../public-app/backend/usage-store.js'
function uri(login){const u=new URL('postgresql:'+'//db.adxoqjgmhmortztqngcz.supabase.co/postgres');u.username=login;u.password='dummy';return u.toString()}
const env={FYTH_FEEDBACK_ENABLED:'true',FYTH_USAGE_ENABLED:'true',FYTH_FEEDBACK_DB_URL:uri('fyth_feedback_app_login'),FYTH_USAGE_DB_URL:uri('fyth_usage_app_login'),FYTH_USAGE_DB_CA_CERT:'public-test-ca'}
function model(total=3){const counts=new Map(),pools=[];class Pool{
 constructor(options){this.options=options;this.role=new URL(options.connectionString).username;this.connected=false;pools.push(this)}on(){}
 async query(){if(!this.connected){const limit=this.role==='fyth_usage_app_login'?1:2,used=counts.get(this.role)??0;if(used>=limit||[...counts.values()].reduce((a,b)=>a+b,0)>=total)throw Error('model capacity');counts.set(this.role,used+1);this.connected=true}return {rows:[{status:'stored'}]}}
 async end(){if(this.connected)counts.set(this.role,counts.get(this.role)-1);this.connected=false}
}return {Pool,pools,counts}}
test('dedicated usage uses its own1 budget, leaving feedback2 slots available when total headroom exists',async()=>{
 const m=model(),usage=createRuntimeUsage({env,Pool:m.Pool}),a=createRuntimeFeedback({env,Pool:m.Pool}),b=createRuntimeFeedback({env,Pool:m.Pool})
 await usage.increment('diagnosis_requested');await a.increment('まだ分からない');await b.increment('まだ分からない');await usage.increment('diagnosis_ready')
 assert.equal(m.counts.get('fyth_usage_app_login'),1);assert.equal(m.counts.get('fyth_feedback_app_login'),2)
 assert.equal(m.pools[0].options.max,1);assert.equal(m.pools[0].options.idleTimeoutMillis,1000)
 for(const s of [usage,a,b])await s.close()
})
test('role separation does not isolate shared total capacity; keep gate off without headroom',async()=>{
 const m=model(2),u=createRuntimeUsage({env,Pool:m.Pool}),a=createRuntimeFeedback({env,Pool:m.Pool}),b=createRuntimeFeedback({env,Pool:m.Pool})
 await u.increment('diagnosis_requested');await a.increment('まだ分からない');await assert.rejects(b.increment('まだ分からない'))
 for(const s of [u,a,b])await s.close()
})
test('enabled flag without dedicated settings allocates no usage pool and never borrows feedback URI',()=>{
 const m=model();assert.equal(createRuntimeUsage({env:{FYTH_USAGE_ENABLED:'true',FYTH_FEEDBACK_DB_URL:env.FYTH_FEEDBACK_DB_URL},Pool:m.Pool}),null);assert.equal(m.pools.length,0)
})
