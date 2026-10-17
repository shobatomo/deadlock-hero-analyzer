// Explicit opt-in local integration runner. Creates/stops a fresh loopback-only
// PostgreSQL cluster below OS temp; never reads a DB URL or existing data folder.
// node --import ./tests/deadhub-review-register.mjs tests/deadhub-invitations-postgres.mjs <postgres-bin-dir>
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import pg from '../public-app/node_modules/pg/lib/index.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {createRecordSync} from '../public-app/backend/deadhub/sync.js'
import {createSharedSyncGate} from '../public-app/backend/deadhub/sync-gate.js'
import {RecordError,createRecordProvider,MAX_RETRY_SECONDS} from '../public-app/backend/deadhub/provider.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
const bin=process.argv[2]
if(!bin)throw Error('Explicit PostgreSQL binary directory is required; no existing DB is accepted')
const exec=promisify(execFile),extension=process.platform==='win32'?'.exe':''
const command=(name,args)=>exec(join(resolve(bin),name+extension),args,{windowsHide:true,timeout:30000,maxBuffer:1024*1024})
let data,admin,poolA,poolB,storeA,storeB,gateA,gateB,started=false
const owner=ownerForAccount('1'),friend=ownerForAccount('2'),month=tokyoDay(Date.now()).slice(0,7)
const record=(kills=1)=>({match_id:'99',started_at:new Date().toISOString(),hero_id:15,won:true,kills,deaths:0,assists:0,hero_damage:100,duration_s:600,final_items:[]})
before(async()=>{
  data=await mkdtemp(join(process.argv[3]?resolve(process.argv[3]):tmpdir(),'deadhub-invite-pg-'))
  await command('initdb',['-D',data,'-U','invite_test_admin','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'])
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r))
  await command('pg_ctl',['-D',data,'-l',join(data,'test-server.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=16`,'-w','start']);started=true
  const connection={host:'127.0.0.1',port,database:'postgres',connectionTimeoutMillis:3000,query_timeout:5000}
  admin=new pg.Pool({...connection,user:'invite_test_admin',max:2})
  await admin.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;`)
  await admin.query(await readFile(new URL('../docs/deadhub/schema.sql',import.meta.url),'utf8'))
  // Reproduce extra direct privileges inherited from CREATE TABLE defaults.
  await admin.query('ALTER DEFAULT PRIVILEGES GRANT INSERT,DELETE ON TABLES TO deadhub_app_login')
  await admin.query(await readFile(new URL('../docs/deadhub/invitation-sync-gate.sql',import.meta.url),'utf8'))
  await admin.query('ALTER ROLE deadhub_app_login LOGIN') // Only this fresh disposable cluster.
  poolA=new pg.Pool({...connection,user:'deadhub_app_login',max:1});poolB=new pg.Pool({...connection,user:'deadhub_app_login',max:1})
  storeA=createRecordStore(poolA);storeB=createRecordStore(poolB);gateA=createSharedSyncGate(poolA);gateB=createSharedSyncGate(poolB)
  console.log(JSON.stringify({postgres:(await admin.query('show server_version')).rows[0].server_version,loopback:true,temporary_cluster:data}))
})
after(async()=>{await poolA?.end();await poolB?.end();await admin?.end();if(started)await command('pg_ctl',['-D',data,'-w','-m','fast','stop'])})
async function reset(){await admin.query(`TRUNCATE deadhub_private.matches,deadhub_private.accounts,deadhub_private.sessions,deadhub_private.openid_nonces;
  UPDATE deadhub_private.sync_gate SET lease_token=null,lease_until=null,retry_after='-infinity';`)}
async function gateReady(){await admin.query("UPDATE deadhub_private.sync_gate SET retry_after='-infinity'")}
async function ready(){await admin.query("UPDATE deadhub_private.accounts SET retry_after=now()-interval '1 second'")}

test('proposal grants only private SELECT/UPDATE, forces RLS, and revokes direct API-role defaults',async()=>{
  const flags=(await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='deadhub_private.sync_gate'::regclass")).rows[0]
  assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true})
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','UPDATE','INSERT','DELETE','TRUNCATE'])
    assert.equal((await admin.query("SELECT has_table_privilege($1,'deadhub_private.sync_gate',$2) AS ok",[role,privilege])).rows[0].ok,false)
  for(const privilege of ['INSERT','DELETE','TRUNCATE'])assert.equal((await admin.query("SELECT has_table_privilege('deadhub_app_login','deadhub_private.sync_gate',$1) AS ok",[privilege])).rows[0].ok,false)
  assert.equal((await poolA.query('SELECT count(*)::int AS n FROM deadhub_private.sync_gate')).rows[0].n,1)
  await assert.rejects(poolA.query('DELETE FROM deadhub_private.sync_gate'),e=>e.code==='42501')
  await assert.rejects(poolA.query('SELECT * FROM deadhub_private.sessions'),e=>e.code==='42501')
})

test('extra app-login INSERT/DELETE defaults are removed from the new table direct ACL',async()=>{
  const defaults=(await admin.query(`SELECT privilege_type FROM pg_default_acl d,
    LATERAL aclexplode(d.defaclacl) a WHERE grantee='deadhub_app_login'::regrole AND defaclobjtype='r' ORDER BY privilege_type`)).rows.map(r=>r.privilege_type)
  assert.deepEqual(defaults,['DELETE','INSERT'])
  const direct=(await admin.query(`SELECT privilege_type,is_grantable FROM pg_class c,
    LATERAL aclexplode(c.relacl) a WHERE c.oid='deadhub_private.sync_gate'::regclass AND grantee='deadhub_app_login'::regrole ORDER BY privilege_type`)).rows
  assert.deepEqual(direct,[{privilege_type:'SELECT',is_grantable:false},{privilege_type:'UPDATE',is_grantable:false}])
  await assert.rejects(poolA.query('INSERT INTO deadhub_private.sync_gate(singleton) VALUES(true)'),e=>e.code==='42501')
  await assert.rejects(poolA.query('DELETE FROM deadhub_private.sync_gate'),e=>e.code==='42501')
})
test('independent database clients compete atomically: exactly one shared lease, with durable release spacing',async()=>{
  await reset();const results=await Promise.allSettled([gateA.acquire(),gateB.acquire()])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
  const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'shared_busy')
  const token=results.find(r=>r.status==='fulfilled').value;await gateA.release(token)
  const wait=Number((await admin.query('SELECT extract(epoch FROM(retry_after-clock_timestamp())) AS wait FROM deadhub_private.sync_gate')).rows[0].wait)
  assert.ok(wait>1.5&&wait<=2.1)
  await assert.rejects(createSharedSyncGate(poolB).acquire(),e=>e.code==='shared_busy')
  await new Promise(r=>setTimeout(r,2150));const next=await gateB.acquire();await gateB.release(next)
})
test('lease expiry recovers a stopped worker and stale completion cannot release or shorten the replacement lease',async()=>{
  await reset();const stale=await gateA.acquire()
  await admin.query("UPDATE deadhub_private.sync_gate SET lease_until=clock_timestamp()-interval '1 second'")
  const current=await gateB.acquire();assert.notEqual(current,stale)
  await assert.rejects(gateA.release(stale,new RecordError('rate_limited',502,120)),e=>e.code==='shared_unavailable')
  assert.equal((await admin.query('SELECT lease_token FROM deadhub_private.sync_gate')).rows[0].lease_token,current)
  await gateB.release(current)
})
test('two users keep the same match ID independently; actual RLS rejects foreign-owner reads and writes',async()=>{
  await reset();await storeA.register(owner,'1');await storeB.register(friend,'2')
  for(const [store,id,kills] of [[storeA,owner,1],[storeB,friend,2]]){
    const lease=await store.acquire(id);await store.savePage(id,lease,{records:[record(kills)],done:true})
  }
  assert.equal((await storeA.snapshot(owner,month)).matches[0].kills,1)
  assert.equal((await storeB.snapshot(friend,month)).matches[0].kills,2)
  const c=await poolA.connect()
  try{
    await c.query('BEGIN');await c.query("SELECT set_config('deadhub.owner_id',$1,true)",[owner])
    assert.equal((await c.query('SELECT * FROM deadhub_private.matches WHERE owner_id=$1',[friend])).rows.length,0)
    await assert.rejects(c.query('UPDATE deadhub_private.matches SET owner_id=$1 WHERE owner_id=$2',[friend,owner]),e=>e.code==='42501')
  }finally{await c.query('ROLLBACK');c.release()}
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.matches')).rows[0].n,2)
})
test('parallel user syncs use one gate; blocked user retains the original registration/window and can retry',async()=>{
  await reset();await storeA.register(owner,'1');await storeB.register(friend,'2')
  let finish,entered;const startedPage=new Promise(r=>entered=r),pending=new Promise(r=>finish=r),calls=[]
  const syncA=createRecordSync({store:storeA,gate:gateA,provider:{async page(){calls.push('A');entered();await pending;return {records:[record(1)],done:true}}}})
  const syncB=createRecordSync({store:storeB,gate:gateB,provider:{async page(){calls.push('B');return {records:[record(2)],done:true}}}})
  const a=syncA(owner);await startedPage
  await assert.rejects(syncB(friend),e=>e.code==='shared_busy')
  const untouched=(await storeB.snapshot(friend,month)).account
  assert.equal(untouched.sync_status,'never');assert.equal(untouched.last_attempt_at,null)
  finish();await a;await gateReady();await syncB(friend)
  assert.deepEqual(calls,['A','B']);assert.equal((await storeB.snapshot(friend,month)).account.initial_from,untouched.initial_from)
})
test('429 persists a shared cooldown across independently created runtimes, even if owner failure storage fails',async()=>{
  await reset();await storeA.register(owner,'1');await storeB.register(friend,'2')
  const provider=createRecordProvider({fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':'120'}})})
  const sync=createRecordSync({store:{...storeA,fail:async()=>{throw Error('Synthetic owner storage outage')}},gate:gateA,provider})
  await assert.rejects(sync(owner))
  const row=(await admin.query('SELECT lease_token,extract(epoch FROM(retry_after-clock_timestamp())) AS wait FROM deadhub_private.sync_gate')).rows[0]
  assert.equal(row.lease_token,null);assert.ok(Number(row.wait)>118)
  await assert.rejects(createSharedSyncGate(poolB).acquire(),e=>e.code==='shared_busy'&&e.retryAfter>=118)
  assert.equal((await storeB.snapshot(friend,month)).account.last_attempt_at,null)
})
test('first fetch failure leaves registration and fixed 30-day initial window intact for manual retry',async()=>{
  await reset();await storeB.register(friend,'2');const initial=(await storeB.snapshot(friend,month)).account
  const span=(new Date(initial.created_at)-new Date(initial.initial_from))/86400000;assert.ok(span>=30&&span<30.0001)
  await assert.rejects(createRecordSync({store:storeB,gate:gateB,provider:{async page(){throw new RecordError('provider_failed')}}})(friend))
  const failed=(await storeB.snapshot(friend,month)).account
  assert.equal(failed.sync_status,'error');assert.equal(failed.initial_from,initial.initial_from);assert.equal(failed.last_success_at,null)
  await ready();await gateReady()
  await createRecordSync({store:storeB,gate:gateB,provider:{async page(lease){assert.equal(lease.from,initial.initial_from);return {records:[record(2)],done:true}}}})(friend)
  const success=await storeB.snapshot(friend,month);assert.equal(success.account.sync_status,'success');assert.equal(success.observed.count,1)
})
test('HTTP-date 429 also persists its longer wait across users in the shared database gate',async()=>{
  await reset();await storeA.register(owner,'1')
  const now=Date.now(),retry=new Date(now+600000).toUTCString()
  const provider=createRecordProvider({now:()=>now,fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':retry}})})
  await assert.rejects(createRecordSync({store:storeA,gate:gateA,provider})(owner),e=>e.code==='rate_limited'&&e.retryAfter>=599)
  await assert.rejects(gateB.acquire(),e=>e.code==='shared_busy'&&e.retryAfter>=598)
})
test('long numeric/date waits persist in both gates without 24h truncation or millisecond overflow',async()=>{
  for(const seconds of [172800,2592000,MAX_RETRY_SECONDS]){
    await reset();await storeA.register(owner,'1')
    const now=Date.now(),header=seconds===172800?new Date(now+seconds*1000).toUTCString():String(seconds)
    const provider=createRecordProvider({now:()=>now,fetchImpl:async()=>new Response('',{status:429,headers:{'Retry-After':header}})})
    await assert.rejects(createRecordSync({store:storeA,gate:gateA,provider})(owner),e=>e.code==='rate_limited'&&e.retryAfter>=seconds-1)
    for(const table of ['accounts','sync_gate']){
      const wait=Number((await admin.query(`SELECT extract(epoch FROM(retry_after-clock_timestamp())) AS wait FROM deadhub_private.${table}`)).rows[0].wait)
      assert.ok(wait>=seconds-2&&wait<=seconds,`${table} retained ${wait} of ${seconds} seconds`)
    }
    await assert.rejects(createSharedSyncGate(poolB).acquire(),e=>e.code==='shared_busy'&&e.retryAfter>=seconds-2)
    await assert.rejects(storeA.acquire(owner),e=>e.code==='cooldown'&&e.retryAfter>=seconds-2)
    assert.equal((await storeA.snapshot(owner,month)).account.sync_paused,false)
  }
})

test('unrepresentable waits persist an infinite stop across runtimes and owner-only mode without breaking snapshots',async()=>{
  for(const header of [String(MAX_RETRY_SECONDS+1),'9'.repeat(400),'Fri, 31 Dec 9999 23:59:59 GMT'])for(const shared of [true,false]){
    await reset();await storeA.register(owner,'1');let calls=0
    const provider=createRecordProvider({fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':header}})}})
    await assert.rejects(createRecordSync({store:storeA,gate:shared?gateA:null,provider})(owner),e=>e.code==='provider_paused'&&e.retryAfter===null)
    assert.equal((await admin.query('SELECT retry_after FROM deadhub_private.accounts')).rows[0].retry_after,Infinity)
    const snapshot=await storeA.snapshot(owner,month)
    assert.equal(snapshot.account.sync_paused,true);assert.equal(snapshot.account.retry_after,null)
    assert.equal(snapshot.account.last_error,'provider_paused');assert.doesNotThrow(()=>JSON.stringify(snapshot))
    if(shared){
      assert.equal((await admin.query('SELECT retry_after FROM deadhub_private.sync_gate')).rows[0].retry_after,Infinity)
      await assert.rejects(createSharedSyncGate(poolB).acquire(),e=>e.code==='provider_paused')
    }
    await assert.rejects(createRecordSync({store:storeB,gate:shared?createSharedSyncGate(poolB):null,provider})(owner),e=>e.code==='provider_paused')
    assert.equal(calls,1)
  }
})

test('a 503 provider Retry-After also preserves a multi-day shared wait',async()=>{
  await reset();await storeA.register(owner,'1')
  const provider=createRecordProvider({fetchImpl:async()=>new Response('',{status:503,headers:{'Retry-After':'172800'}})})
  await assert.rejects(createRecordSync({store:storeA,gate:gateA,provider})(owner),e=>e.code==='provider_failed'&&e.retryAfter===172800)
  await assert.rejects(gateB.acquire(),e=>e.code==='shared_busy'&&e.retryAfter>=172798)
})

test('actual session expiry, revoked invitation, and forged owner are rejected without changing other users',async()=>{
  await reset()
  for(const [id,account,token]of [[owner,'1','a'],[friend,'2','b']])assert.equal(await storeA.openSession(hashToken(token.repeat(43)),id,account,hashToken('nonce-'+account),hashToken('state-'+account)),true)
  const auth=createSteamAuth({store:storeA,origin:'https://invite.example.test',allowedAccounts:['1','2']})
  const req=token=>({headers:{cookie:'__Host-deadhub_session='+token.repeat(43)}})
  assert.equal((await auth.identify(req('b'))).owner,friend)
  const revoked=createSteamAuth({store:storeA,origin:auth.origin,allowedAccounts:['1']})
  await assert.rejects(revoked.identify(req('b')),e=>e.code==='unauthorized')
  assert.equal((await revoked.identify(req('a'))).owner,owner)
  await admin.query('UPDATE deadhub_private.sessions SET owner_id=$1 WHERE steam_account_id=2',[owner])
  await assert.rejects(auth.identify(req('b')),e=>e.code==='unauthorized')
  await admin.query("UPDATE deadhub_private.sessions SET expires_at=now()-interval '1 second' WHERE steam_account_id=1")
  await assert.rejects(auth.identify(req('a')),e=>e.code==='unauthorized')
})
test('missing coordination table or singleton fails closed before account acquisition or provider work',async()=>{
  await reset();let touched=0
  const sync=createRecordSync({store:{async acquire(){touched++}},provider:{async page(){touched++}},gate:gateA})
  await admin.query('ALTER TABLE deadhub_private.sync_gate RENAME TO sync_gate_test_missing')
  try{await assert.rejects(sync(owner),e=>e.code==='shared_unavailable')}finally{await admin.query('ALTER TABLE deadhub_private.sync_gate_test_missing RENAME TO sync_gate')}
  await admin.query('DELETE FROM deadhub_private.sync_gate')
  try{await assert.rejects(sync(owner),e=>e.code==='shared_unavailable')}finally{await admin.query('INSERT INTO deadhub_private.sync_gate(singleton) VALUES(true)')}
  assert.equal(touched,0)
})
