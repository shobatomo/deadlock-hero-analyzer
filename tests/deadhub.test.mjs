import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import {once} from 'node:events'
import pg from '../public-app/node_modules/pg/lib/index.js'
import {createRecordStore,createRecordPool} from '../public-app/backend/deadhub/store.js'
import {createRecordProvider,projectRecord,RecordError} from '../public-app/backend/deadhub/provider.js'
import {createRecordSync} from '../public-app/backend/deadhub/sync.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createRecordRuntime} from '../public-app/backend/deadhub/runtime.js'
import {tokyoDay,monthBounds,dayState,daySummary,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'

// Synthetic fixtures only. The test database is disposable and bound to loopback.
const exec=promisify(execFile), name='deadhub-sql-'+process.pid
let admin,pool,store,server,base,sessionCookie
const owner=ownerForAccount('1'),other=ownerForAccount('2'),origin='https://records.example.test'
const month=tokyoDay(Date.now()).slice(0,7)
const raw=(id=99,extra={})=>({match_id:id,start_time:'2026-10-14 15:00:00',duration_s:1200,winning_team:'Team0',match_outcome:'TeamWin',
  players:[{account_id:1,hero_id:15,team:'Team0',kills:0,deaths:2,assists:3,final_stats:{player_damage:0}}],...extra})
const range={accountId:'1',from:'2026-09-15T00:00:00.000Z',until:'2026-10-16T00:00:00.000Z',cursor:null}
const record=(id='99',extra={})=>({match_id:id,started_at:new Date(Date.now()-DAY).toISOString(),hero_id:15,won:false,kills:0,deaths:2,assists:3,hero_damage:null,duration_s:1200,...extra})
const DAY=86400000
async function reset(){await admin.query('TRUNCATE deadhub_private.matches,deadhub_private.accounts,deadhub_private.sessions,deadhub_private.openid_nonces')}
async function ready(){await admin.query("UPDATE deadhub_private.accounts SET retry_after=now()-interval '1 second'")}
before(async()=>{
  await exec('docker',['run','--rm','-d','--name',name,'-p','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.11-bookworm'])
  for(let i=0;;i++){try{await exec('docker',['exec',name,'pg_isready','-U','postgres','-h','127.0.0.1']);break}catch{if(i>100)throw Error('Database startup failed');await new Promise(r=>setTimeout(r,100))}}
  const port=Number((await exec('docker',['port',name,'5432/tcp'])).stdout.trim().split(':').at(-1))
  admin=new pg.Pool({host:'127.0.0.1',port,user:'postgres',database:'postgres'})
  // Exercise stricter-than-current Supabase defaults: direct role grants must
  // also be removed, rather than relying only on a REVOKE from PUBLIC.
  await admin.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON SCHEMAS TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;`)
  await admin.query(await readFile(new URL('../docs/deadhub/schema.sql',import.meta.url),'utf8'))
  // This activation is confined to this disposable DB, never production.
  await admin.query('ALTER ROLE deadhub_app_login LOGIN')
  pool=new pg.Pool({host:'127.0.0.1',port,user:'deadhub_app_login',database:'postgres',max:4})
  store=createRecordStore(pool)
})
after(async()=>{if(server)await new Promise(r=>server.close(r));await pool?.end();await admin?.end();await exec('docker',['stop',name]).catch(()=>{})})

test('JST boundary, month/year/leap transitions, missing versus real zero and partial totals',()=>{
  assert.equal(tokyoDay('2026-10-14T14:59:59Z'),'2026-10-14')
  assert.equal(tokyoDay('2026-10-14T15:00:00Z'),'2026-10-15')
  assert.deepEqual(monthBounds('2026-10'),{start:'2026-09-30T15:00:00.000Z',end:'2026-10-31T15:00:00.000Z'})
  assert.equal(shiftMonth('2026-01',-1),'2025-12')
  assert.equal(monthBounds('2028-02').end,'2028-02-29T15:00:00.000Z')
  assert.throws(()=>monthBounds('2026-13'))
  const result=daySummary([record('1',{hero_damage:0,kills:0}),record('2',{hero_damage:null,kills:null})])
  assert.deepEqual(result.hero_damage,{value:0,known:1,total:2})
  assert.equal(result.losses,2)
  const account={coverage_from:'2026-10-01T00:00:00Z',coverage_until:'2026-10-15T00:00:00Z',sync_status:'success'}
  assert.equal(dayState('2026-10-01',[],account),'unsynced') // partially queried day
  assert.equal(dayState('2026-10-02',[],account),'empty')
  assert.equal(dayState('2026-10-15',[],account),'unsynced')
  assert.equal(dayState('2026-10-02',[],{...account,sync_status:'error'}),'failed')
  assert.equal(dayState('2026-10-15',[{started_at:'2026-10-14T15:00:00Z'}],{...account,sync_status:'error'}),'recorded')
  assert.equal(dayState('2026-10-15',[],{sync_status:'running'}),'initial')
})
test('provider projects only this player, validates time/identity, nullable outcome and damage',()=>{
  const r=projectRecord(raw(),'1',range.from,range.until)
  assert.equal(r.hero_damage,0);assert.equal(r.kills,0);assert.equal(r.won,true)
  assert.equal(r.started_at,'2026-10-14T15:00:00.000Z')
  assert.equal(projectRecord(raw(99,{match_outcome:'Error'}),'1',range.from,range.until).won,null)
  const missing=raw();delete missing.players[0].kills;missing.players[0].final_stats={player_damage:null}
  assert.equal(projectRecord(missing,'1',range.from,range.until).kills,null)
  assert.equal(projectRecord(missing,'1',range.from,range.until).hero_damage,null)
  assert.throws(()=>projectRecord(raw(),'2',range.from,range.until))
  assert.throws(()=>projectRecord(raw(),'1','2026-10-15T00:00:00Z',range.until))
  assert.throws(()=>projectRecord(raw(99,{start_time:'2026-02-30 00:00:00'}),'1','2026-01-01T00:00:00Z',range.until))
})
test('bulk pagination is bounded; no Steam fallback, queue requests, or automatic retry',async()=>{
  let calls=0
  const provider=createRecordProvider({fetchImpl:async url=>{
    calls++;assert.equal(url.pathname,'/v1/matches/metadata');assert.equal(url.searchParams.get('max_match_id'),'100')
    assert.equal(url.searchParams.get('min_unix_timestamp'),String(Date.parse(range.from)/1000))
    assert.equal(url.searchParams.get('only_filtered_players'),'true')
    assert.equal(url.searchParams.has('match_ids'),false)
    return Response.json([raw()])
  }})
  const p=await provider.page({...range,cursor:'100'})
  assert.equal(p.done,true);assert.equal(p.cursor,'98');assert.equal(calls,1)
  let failed=0
  const limited=createRecordProvider({fetchImpl:async()=>{failed++;return new Response('',{status:429,headers:{'Retry-After':'120'}})}})
  await assert.rejects(limited.page(range),e=>e.code==='rate_limited'&&e.retryAfter===120);assert.equal(failed,1)
  await assert.rejects(createRecordProvider({fetchImpl:async()=>Response.json([raw(2),raw(3)])}).page(range),e=>e.code==='invalid_provider')
})
test('registration, RLS owner isolation, global Steam uniqueness, no DELETE or auth-table access',async()=>{
  await reset();await store.register(owner,'1');await store.register(owner,'1')
  assert.equal((await store.snapshot(owner,month)).account.steam_account_id,'1')
  assert.equal((await store.snapshot(other,month)).account,null)
  await assert.rejects(store.register(other,'1'),e=>e.code==='already_registered')
  await assert.rejects(pool.query('DELETE FROM deadhub_private.matches'))
  await assert.rejects(pool.query('SELECT * FROM deadhub_private.sessions'))
  assert.equal((await pool.query('SELECT * FROM deadhub_private.accounts')).rowCount,0)
  await assert.rejects(pool.query('INSERT INTO deadhub_private.matches(owner_id,match_id,started_at) VALUES($1,1,now())',[owner]))
  const privileges=await admin.query(`SELECT r.rolname,
    has_schema_privilege(r.oid,'deadhub_private','USAGE,CREATE') AS schema_access,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='deadhub_private' AND c.relkind='r'
      AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS table_access,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='deadhub_private'
      AND has_function_privilege(r.oid,p.oid,'EXECUTE')) AS function_access
    FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')`)
  assert.equal(privileges.rowCount,3)
  for(const row of privileges.rows)assert.deepEqual([row.schema_access,row.table_access,row.function_access],[false,false,false])
})
test('verified state/nonce consumption and session rotation are atomic, including at the session cap',async()=>{
  await reset()
  const h=value=>hashToken(String(value))
  for(let i=0;i<10;i++)assert.equal(await store.openSession(h('session'+i),owner,'1',h('nonce'+i),h('state'+i)),true)
  assert.equal(await store.openSession(h('over-cap'),owner,'1',h('over-cap-nonce'),h('over-cap-state')),false)
  assert.equal(await store.openSession(h('replacement'),owner,'1',h('new-nonce'),h('new-state'),h('session0')),true)
  assert.equal(await store.resolveSession(h('session0')),null)
  assert.equal((await store.resolveSession(h('replacement'))).owner_id,owner)
  // A reused nonce or state may not revoke the prior good session.
  assert.equal(await store.openSession(h('replay1'),owner,'1',h('new-nonce'),h('different-state'),h('replacement')),false)
  assert.equal(await store.openSession(h('replay2'),owner,'1',h('different-nonce'),h('new-state'),h('replacement')),false)
  assert.equal((await store.resolveSession(h('replacement'))).owner_id,owner)
  const concurrent=await Promise.all(['a','b'].map(suffix=>store.openSession(h('concurrent-'+suffix),owner,'1',h('concurrent-nonce'),h('concurrent-state'),h('replacement'))))
  assert.equal(concurrent.filter(Boolean).length,1)
  const current=h(concurrent[0]?'concurrent-a':'concurrent-b')
  const distinct=await Promise.all(['a','b'].map(suffix=>store.openSession(h('distinct-'+suffix),owner,'1',h('distinct-nonce-'+suffix),h('distinct-state-'+suffix),current)))
  assert.equal(distinct.filter(Boolean).length,1)
  const active=h(distinct[0]?'distinct-a':'distinct-b')
  await assert.rejects(store.openSession('invalid-token-hash',owner,'1',h('rollback-nonce'),h('rollback-state'),active))
  assert.equal((await store.resolveSession(active)).owner_id,owner)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.openid_nonces WHERE token_hash=$1',[h('rollback-nonce')])).rows[0].n,0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.sessions WHERE owner_id=$1',[owner])).rows[0].n,10)
  assert.equal(await store.openSession(h('other-session'),other,'2',h('other-nonce'),h('other-state')),true)
  assert.equal(await store.openSession(h('wrong-owner'),owner,'1',h('wrong-owner-nonce'),h('wrong-owner-state'),h('other-session')),false)
  assert.equal((await store.resolveSession(h('other-session'))).owner_id,other)
})
test('sync is idempotent; sparse responses preserve known values; details can arrive later',async()=>{
  await reset();await store.register(owner,'1')
  const a=await store.acquire(owner)
  assert.ok(Math.abs((Date.parse(a.until)-Date.parse(a.from))/DAY-30)<.001)
  await store.savePage(owner,a,{records:[record()],done:true,cursor:'98'})
  await ready();const b=await store.acquire(owner)
  assert.ok(Math.abs((Date.parse(a.until)-Date.parse(b.from))/DAY-7)<.001)
  await store.savePage(owner,b,{records:[record('99',{hero_damage:1250,kills:8})],done:true,cursor:'98'})
  await ready();const c=await store.acquire(owner)
  await store.savePage(owner,c,{records:[record('99',{hero_damage:null,kills:null,won:null})],done:true,cursor:'98'})
  const saved=await store.snapshot(owner,month)
  assert.equal(saved.observed.count,1);assert.equal(saved.matches[0].hero_damage,1250);assert.equal(saved.matches[0].kills,8);assert.equal(saved.matches[0].won,false)
  // A new store/connection is equivalent to a new app process, not memory state.
  const reopened=createRecordStore(new pg.Pool(pool.options))
  assert.equal((await reopened.snapshot(owner,month)).observed.count,1);await reopened.close()
  await store.register(other,'2')
  assert.equal((await store.snapshot(other,month)).observed.count,0)
  const secondOwner=await store.acquire(other)
  await store.savePage(other,secondOwner,{records:[record('99',{kills:99})],done:true})
  assert.equal((await store.snapshot(owner,month)).matches[0].kills,8)
  assert.equal((await store.snapshot(other,month)).matches[0].kills,99)
})
test('concurrent acquisition, cooldown, lease expiry fencing, saved cursor recovery and stopped days',async()=>{
  await reset();await store.register(owner,'1')
  const outcomes=await Promise.allSettled([store.acquire(owner),store.acquire(owner)])
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1)
  const lease=outcomes.find(r=>r.status==='fulfilled').value
  await store.savePage(owner,lease,{records:[record()],done:false,cursor:'98'})
  await store.fail(owner,lease.token,'provider_failed')
  await assert.rejects(store.acquire(owner),e=>e.code==='cooldown')
  await ready();const next=await store.acquire(owner)
  assert.equal(next.cursor,'98');assert.equal(next.from,lease.from);assert.equal(next.until,lease.until)
  await assert.rejects(store.savePage(owner,lease,{records:[record('98')],done:true}),e=>e.code==='lease_lost')
  await store.fail(owner,lease.token,'late_failure')
  assert.equal((await store.snapshot(owner,month)).account.sync_status,'running')
  await admin.query("UPDATE deadhub_private.accounts SET lease_until=now()-interval '1 second',retry_after=now()-interval '1 second'")
  const resumed=await store.acquire(owner);assert.equal(resumed.cursor,'98')
  await store.savePage(owner,resumed,{records:[record('98')],done:true})
  await admin.query("UPDATE deadhub_private.accounts SET coverage_until=now()-interval '5 days',retry_after=now()-interval '1 second'")
  const catchup=await store.acquire(owner)
  assert.ok(Math.abs((Date.now()-Date.parse(catchup.from))/DAY-12)<.001)
})
test('partial commit and bounded work; API failure keeps rows and last completed coverage',async()=>{
  await reset();await store.register(owner,'1')
  let calls=0
  const sync=createRecordSync({store,delay:async()=>{},provider:{page:async()=>({records:[record(String(99-calls++))],cursor:String(99-calls),done:false})}})
  assert.deepEqual(await sync(owner),{status:'partial',processed:3});assert.equal(calls,3)
  let snapshot=await store.snapshot(owner,month);assert.equal(snapshot.observed.count,3);assert.equal(snapshot.account.coverage_until,null)
  await ready()
  const failure=createRecordSync({store,provider:{page:async()=>{throw new RecordError('provider_failed')}}})
  await assert.rejects(failure(owner));snapshot=await store.snapshot(owner,month)
  assert.equal(snapshot.observed.count,3);assert.equal(snapshot.account.sync_status,'error');assert.equal(snapshot.account.coverage_until,null)
  await ready();const continuation=createRecordSync({store,provider:{page:async lease=>{assert.equal(lease.cursor,'96');return {records:[],done:true}}}})
  await continuation(owner);assert.equal((await store.snapshot(owner,month)).account.sync_status,'success')
  await ready();const lease=await store.acquire(owner)
  await assert.rejects(store.savePage(owner,lease,{records:[record('90'),record('89',{kills:-1})],cursor:'88',done:false}))
  assert.equal((await store.snapshot(owner,month)).observed.count,3) // whole page rolls back
  await store.savePage(owner,lease,{records:[record('90'),record('89',{kills:0})],cursor:'88',done:true})
  assert.equal((await store.snapshot(owner,month)).observed.count,5)
})
test('Steam verified login, safe cookie, replays, wrong identity/origin and endpoint authorization',async()=>{
  await reset()
  let verification=0,syncCalls=0,validVerification=true
  const auth=createSteamAuth({store,origin,allowedAccounts:['1'],fetchImpl:async(url,opts)=>{
    assert.equal(url,'https://steamcommunity.com/openid/login');assert.equal(opts.body.get('openid.mode'),'check_authentication');verification++
    return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:'+validVerification+'\n')
  }})
  const app=createDeadhubApp({store,auth,sync:async id=>{assert.equal(id,owner);syncCalls++;return {status:'success'}},cronOwner:owner,cronSecret:'x'.repeat(40)})
  server=app.listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port
  const post=(path,headers={},body='{}')=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body,redirect:'manual'})
  assert.equal((await fetch(base+'/api/deadhub/records')).status,401)
  assert.equal((await post('/api/deadhub/register')).status,401)
  assert.equal((await post('/api/deadhub/auth/login',{Origin:'https://evil.test'})).status,403)
  for(let i=0;i<120;i++)assert.equal((await post('/api/deadhub/auth/login')).status,200)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.openid_nonces')).rows[0].n,0)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.sessions')).rows[0].n,0)
  async function assertion(account='1',change={}) {
    const start=await post('/api/deadhub/auth/login'),login=new URL((await start.json()).url)
    assert.match(start.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/)
    const ret=new URL(login.searchParams.get('openid.return_to')),stateCookie=start.headers.get('set-cookie').split(';')[0]
    const fields={ns:'http://specs.openid.net/auth/2.0',mode:'id_res',op_endpoint:'https://steamcommunity.com/openid/login',
      claimed_id:'https://steamcommunity.com/openid/id/'+accountIdToSteamId(account),identity:'https://steamcommunity.com/openid/id/'+accountIdToSteamId(account),
      return_to:ret.toString(),response_nonce:new Date().toISOString().slice(0,19)+'Z'+Math.random(),assoc_handle:'test',sig:'signed-by-fake-provider',
      signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',...change}
    for(const [key,value]of Object.entries(fields))ret.searchParams.set('openid.'+key,value)
    return {path:ret.pathname+ret.search,cookie:stateCookie}
  }
  const wrong=await assertion('2'),wrongResult=await fetch(base+wrong.path,{headers:{Cookie:wrong.cookie},redirect:'manual'})
  assert.match(wrongResult.headers.get('location'),/login=failed/);assert.equal(verification,0)
  const forged=await assertion('1',{op_endpoint:'https://evil.test/verify'})
  await fetch(base+forged.path,{headers:{Cookie:forged.cookie},redirect:'manual'});assert.equal(verification,0)
  for(const change of [
    {return_to:'https://evil.test/callback'},
    {signed:'op_endpoint,identity,return_to,response_nonce,assoc_handle'},
    {response_nonce:'2026-99-99T00:00:00Zbad'},
    {response_nonce:'2020-01-01T00:00:00Zold'},
    {identity:'https://steamcommunity.com/openid/id/'+accountIdToSteamId('2')},
  ]) {
    const bad=await assertion('1',change),result=await fetch(base+bad.path,{headers:{Cookie:bad.cookie},redirect:'manual'})
    assert.match(result.headers.get('location'),/login=failed/)
  }
  const duplicate=await assertion()
  await fetch(base+duplicate.path+'&openid.mode=id_res',{headers:{Cookie:duplicate.cookie},redirect:'manual'})
  const noCookie=await assertion()
  await fetch(base+noCookie.path,{redirect:'manual'})
  assert.equal(verification,0)
  validVerification=false
  const invalid=await assertion(),invalidResult=await fetch(base+invalid.path,{headers:{Cookie:invalid.cookie},redirect:'manual'})
  assert.match(invalidResult.headers.get('location'),/login=failed/)
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM deadhub_private.sessions')).rows[0].n,0)
  validVerification=true;verification=0
  const good=await assertion(),verified=await fetch(base+good.path,{headers:{Cookie:good.cookie},redirect:'manual'})
  assert.equal(verified.headers.get('location'),origin+'/deadhub');assert.equal(verification,1)
  sessionCookie=verified.headers.getSetCookie().find(c=>c.startsWith('__Host-deadhub_session=')).split(';')[0]
  const replay=await fetch(base+good.path,{headers:{Cookie:good.cookie},redirect:'manual'})
  assert.match(replay.headers.get('location'),/login=failed/);assert.equal(verification,2)
  const read=await fetch(base+'/api/deadhub/records?month='+month,{headers:{Cookie:sessionCookie}})
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store')
  assert.equal((await post('/api/deadhub/register',{Cookie:sessionCookie},JSON.stringify({account_id:'2'}))).status,400)
  assert.equal((await post('/api/deadhub/register',{Cookie:sessionCookie})).status,200);assert.equal(syncCalls,1)
  assert.equal((await post('/api/deadhub/sync',{Cookie:sessionCookie,Origin:'https://evil.test'})).status,403)
  assert.equal((await fetch(base+'/api/deadhub/cron',{headers:{Cookie:sessionCookie}})).status,401)
  assert.equal((await fetch(base+'/api/deadhub/cron',{headers:{Authorization:'Bearer '+'x'.repeat(40)}})).status,200);assert.equal(syncCalls,2)
  assert.equal((await post('/api/deadhub/auth/logout',{Cookie:sessionCookie})).status,200)
  assert.equal((await fetch(base+'/api/deadhub/records',{headers:{Cookie:sessionCookie}})).status,401)
})
test('disabled runtime reads no DB credentials; existing FYTH roles cannot be reused',()=>{
  const env=new Proxy({DEADHUB_ENABLED:'false'},{get(target,key){if(/URL|CERT|STEAM|SECRET/.test(key))throw Error('secret read');return target[key]}})
  assert.deepEqual(createRecordRuntime({env}),{})
  assert.throws(()=>createRecordPool({connectionString:'postgresql://fyth_reader:fake@db.adxoqjgmhmortztqngcz.supabase.co/postgres'}))
})
