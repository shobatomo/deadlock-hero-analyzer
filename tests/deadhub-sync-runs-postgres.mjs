// Explicit local runner: a fresh loopback-only cluster and synthetic data only.
// node --import ./tests/deadhub-review-register.mjs tests/deadhub-sync-runs-postgres.mjs <postgres-bin-dir>
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import pg from '../public-app/node_modules/pg/lib/index.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {createRecordSync} from '../public-app/backend/deadhub/sync.js'
import {createSyncRunRecorder} from '../public-app/backend/deadhub/sync-runs.js'
import {createSharedSyncGate} from '../public-app/backend/deadhub/sync-gate.js'
import {RecordError} from '../public-app/backend/deadhub/provider.js'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
const bin=process.argv[2]
if(!bin)throw Error('Explicit PostgreSQL binary directory required; existing databases are not accepted')
const exec=promisify(execFile),command=(name,args)=>exec(join(resolve(bin),name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024})
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
const success={outcome:'success',result_code:'complete',processed_count:0}
let data,admin,pool,store,audit,started=false
const logs=[]
before(async()=>{
  data=await mkdtemp(join(tmpdir(),'deadhub-sync-runs-pg-'))
  await command('initdb',['-D',data,'-U','sync_runs_test_admin','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'])
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
  await command('pg_ctl',['-D',data,'-l',join(data,'test.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=16`,'-w','start']);started=true
  const options={host:'127.0.0.1',port,database:'postgres',ssl:false,connectionTimeoutMillis:3000,query_timeout:5000}
  admin=new pg.Pool({...options,user:'sync_runs_test_admin',max:2})
  await admin.query('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role')
  for(const file of ['schema.sql','invitation-sync-gate.sql'])await admin.query(await readFile(new URL('../docs/deadhub/'+file,import.meta.url),'utf8'))
  await admin.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO deadhub_app_login')
  await admin.query(await readFile(new URL('../docs/deadhub/sync-runs-schema-proposal.sql',import.meta.url),'utf8'))
  await admin.query('ALTER ROLE deadhub_app_login LOGIN') // Only this new disposable cluster.
  pool=new pg.Pool({...options,user:'deadhub_app_login',max:4})
  store=createRecordStore(pool);audit=createSyncRunRecorder({store,logger:code=>logs.push(code)})
  console.log(JSON.stringify({temporary_cluster:data,loopback_only:true,synthetic_only:true,production:false,postgres:(await admin.query('show server_version')).rows[0].server_version}))
})
after(async()=>{await pool?.end();await admin?.end();if(started)await command('pg_ctl',['-D',data,'-w','-m','fast','stop'])})
async function reset(){await admin.query("TRUNCATE deadhub_private.sync_runs,deadhub_private.matches,deadhub_private.accounts;UPDATE deadhub_private.sync_gate SET lease_token=null,lease_until=null,retry_after='-infinity'");logs.length=0}
const run=(source,value={status:'success',processed:0})=>audit.run(owner,source,async()=>value)
const sources=async()=>(await audit.snapshot(owner)).sources
async function asOwner(id,query,args=[]){
  const client=await pool.connect()
  try{await client.query('BEGIN');await client.query("SELECT set_config('deadhub.owner_id',$1,true)",[id]);return await client.query(query,args)}
  finally{await client.query('ROLLBACK');client.release()}
}
test('proposal limits new table privileges, forces owner RLS, and cannot rewrite terminal records',async()=>{
  await reset()
  const flags=(await admin.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='deadhub_private.sync_runs'::regclass")).rows[0]
  assert.deepEqual(flags,{relrowsecurity:true,relforcerowsecurity:true})
  for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
    assert.equal((await admin.query("SELECT has_table_privilege($1,'deadhub_private.sync_runs',$2) AS ok",[role,privilege])).rows[0].ok,false)
  for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])
    assert.equal((await admin.query("SELECT has_table_privilege('deadhub_app_login','deadhub_private.sync_runs',$1) AS ok",[privilege])).rows[0].ok,false)
  const id=randomUUID();await store.startSyncRun(owner,id,'manual')
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM deadhub_private.sync_runs')).rows[0].count,0)
  assert.equal((await asOwner(other,'SELECT * FROM deadhub_private.sync_runs')).rows.length,0)
  await assert.rejects(asOwner(other,'INSERT INTO deadhub_private.sync_runs(run_id,owner_id,source) VALUES($1,$2,$3)',[randomUUID(),owner,'manual']),e=>e.code==='42501')
  await assert.rejects(store.finishSyncRun(other,id,success))
  await assert.rejects(asOwner(owner,"UPDATE deadhub_private.sync_runs SET source='cron_endpoint'"),e=>e.code==='42501')
  await assert.rejects(asOwner(owner,"UPDATE deadhub_private.sync_runs SET started_at=now()"),e=>e.code==='42501')
  await assert.rejects(asOwner(owner,'DELETE FROM deadhub_private.sync_runs'),e=>e.code==='42501')
  await store.finishSyncRun(owner,id,success)
  await assert.rejects(store.finishSyncRun(owner,id,{outcome:'failed',result_code:'sync_failed',processed_count:null}))
  assert.equal((await sources()).manual.latest.outcome,'success')
})
test('no cron record stays absent after manual success; cron failure survives later manual success',async()=>{
  await reset();const empty=await audit.snapshot(owner)
  assert.equal(empty.available,true);assert.equal(empty.cron_origin_verified,false)
  for(const source of Object.values(empty.sources)){assert.equal(source.latest,null);assert.equal(source.unfinished_count,'0')}
  await run('manual');assert.equal((await sources()).cron_endpoint.latest,null)
  await assert.rejects(audit.run(owner,'cron_endpoint',async()=>{throw new RecordError('provider_timeout')}))
  const cron=(await sources()).cron_endpoint
  await run('manual');assert.deepEqual((await sources()).cron_endpoint,cron)
  await audit.run(other,'cron_endpoint',async()=>({status:'success',processed:0}))
  assert.deepEqual((await sources()).cron_endpoint,cron)
  assert.equal((await audit.snapshot(other)).sources.cron_endpoint.latest.outcome,'success')
})
test('unfinished starts persist across process replacement and later successes; start order controls latest',async()=>{
  await reset();const older=randomUUID();await store.startSyncRun(owner,older,'cron_endpoint')
  await admin.query("UPDATE deadhub_private.sync_runs SET started_at=clock_timestamp()-interval '1 hour' WHERE run_id=$1",[older])
  await run('manual');await run('cron_endpoint')
  let cron=(await createSyncRunRecorder({store:createRecordStore(pool)}).snapshot(owner)).sources.cron_endpoint
  assert.equal(cron.latest.outcome,'success');assert.equal(cron.unfinished_count,'1');assert.ok(cron.oldest_unfinished_at)
  const latest=cron.latest
  await store.finishSyncRun(owner,older,{outcome:'failed',result_code:'provider_timeout',processed_count:null})
  cron=(await sources()).cron_endpoint
  assert.deepEqual(cron.latest,latest);assert.equal(cron.last_failure.outcome,'failed');assert.equal(cron.unfinished_count,'0')
})
test('actual simultaneous manual and cron calls preserve one shared-lock skip and one zero-row success',async()=>{
  await reset();await store.register(owner,'1')
  let notify,finish;const entered=new Promise(r=>{notify=r})
  const sync=createRecordSync({store,gate:createSharedSyncGate(pool),provider:{page:()=>{notify();return new Promise(r=>{finish=r})}}})
  const first=audit.run(owner,'cron_endpoint',()=>sync(owner));await entered
  await assert.rejects(audit.run(owner,'manual',()=>sync(owner)),e=>e.code==='shared_busy')
  assert.equal((await sources()).cron_endpoint.latest.outcome,'started')
  finish({done:true,records:[]});assert.deepEqual(await first,{status:'success',processed:0})
  const result=await sources();assert.equal(result.manual.latest.outcome,'skipped');assert.equal(result.manual.latest.result_code,'shared_busy')
  assert.equal(result.cron_endpoint.latest.outcome,'success');assert.equal(result.cron_endpoint.latest.processed_count,0)
  const all=(await admin.query('SELECT run_id FROM deadhub_private.sync_runs')).rows;assert.equal(all.length,2);assert.notEqual(all[0].run_id,all[1].run_id)
})
test('zero new matches after replay remains success; stored match contents and snapshot remain unchanged',async()=>{
  await reset();await store.register(owner,'1')
  const record={match_id:'99',started_at:new Date().toISOString(),hero_id:15,won:true,kills:0,deaths:2,assists:3,hero_damage:100,player_healing:0,duration_s:600,final_items:[]}
  const sync=createRecordSync({store,provider:{page:async()=>({done:true,records:[record]})}})
  for(let i=0;i<2;i++){await admin.query('UPDATE deadhub_private.accounts SET retry_after=null');assert.deepEqual(await audit.run(owner,'manual',()=>sync(owner)),{status:'success',processed:1})}
  const saved=await store.snapshot(owner,tokyoDay(Date.now()).slice(0,7))
  assert.equal(saved.matches.length,1);assert.equal(saved.matches[0].kills,0);assert.equal(saved.matches[0].player_healing,0);assert.equal(saved.account.sync_status,'success')
  assert.equal((await sources()).manual.latest.processed_count,1) // Processed, never new_count.
})
test('missing audit table does not stop actual synchronization or stored-record reads',async()=>{
  await reset();await store.register(owner,'1');await admin.query('ALTER TABLE deadhub_private.sync_runs RENAME TO sync_runs_temporarily_unavailable')
  try{
    const sync=createRecordSync({store,provider:{page:async()=>({done:true,records:[]})}}),reports=[]
    assert.deepEqual(await audit.run(owner,'manual',()=>sync(owner),value=>reports.push(value)),{status:'success',processed:0})
    assert.deepEqual(reports,['unavailable']);assert.equal((await audit.snapshot(owner)).available,false)
    assert.equal((await store.snapshot(owner,tokyoDay(Date.now()).slice(0,7))).account.sync_status,'success')
    assert.deepEqual(logs,['DEADHUB_SYNC_AUDIT_START_FAILED','DEADHUB_SYNC_AUDIT_READ_FAILED'])
  }finally{await admin.query('ALTER TABLE deadhub_private.sync_runs_temporarily_unavailable RENAME TO sync_runs')}
  assert.equal((await sources()).manual.latest,null)
})
test('completion failure leaves durable started evidence; returned synchronization still succeeds',async()=>{
  await reset()
  const reports=[],broken=createSyncRunRecorder({store:{...store,finishSyncRun:async()=>{throw Error('DUMMY_PRIVATE')}},logger:code=>logs.push(code)})
  assert.deepEqual(await broken.run(owner,'manual',async()=>({status:'success',processed:0}),x=>reports.push(x)),{status:'success',processed:0})
  assert.deepEqual(reports,['unavailable']);assert.deepEqual(logs,['DEADHUB_SYNC_AUDIT_FINISH_FAILED'])
  const result=(await sources()).manual;assert.equal(result.latest.outcome,'started');assert.equal(result.latest.finished_at,null);assert.equal(result.last_success,null)
})
test('schema rejects arbitrary codes, incomplete result shapes and negative counts',async()=>{
  await reset();const id=randomUUID();await store.startSyncRun(owner,id,'manual')
  for(const values of [ ['success',null,0],['success','complete',null],['success','complete',-1],['failed','DUMMY_PRIVATE',null],['skipped','complete',0],['partial','page_limit',null]]){
    await assert.rejects(asOwner(owner,'UPDATE deadhub_private.sync_runs SET finished_at=clock_timestamp(),outcome=$1,result_code=$2,processed_count=$3 WHERE run_id=$4',[...values,id]),e=>e.code==='23514')
  }
  assert.equal((await sources()).manual.latest.outcome,'started')
  const columns=(await admin.query("SELECT column_name FROM information_schema.columns WHERE table_schema='deadhub_private' AND table_name='sync_runs' ORDER BY ordinal_position")).rows.map(r=>r.column_name)
  assert.deepEqual(columns,['run_id','owner_id','source','started_at','finished_at','outcome','result_code','processed_count'])
})
