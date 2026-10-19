// Explicit disposable loopback cluster only; no existing DB or credentials.
// Fixtures reproduce existing owner RLS with SELECT-only access, never production.
// node --import ./tests/deadhub-review-register.mjs tests/deadhub-statistics-postgres.mjs <postgres-bin-dir>
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
import {statisticDay,statisticRatio,statisticFields} from '../public-app/shared/record-statistics.mjs'
const bin=process.argv[2]
if(!bin)throw Error('Explicit PostgreSQL binary directory required; existing databases are not accepted')
const exec=promisify(execFile),command=(name,args)=>exec(join(resolve(bin),name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024})
const owners=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'))
let folder,admin,pool,store,started=false
before(async()=>{
 folder=await mkdtemp(join(tmpdir(),'deadhub-statistics-pg-'))
 await command('initdb',['-D',folder,'-U','statistics_local_admin','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'])
 const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
 await command('pg_ctl',['-D',folder,'-l',join(folder,'test.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=8`,'-w','start']);started=true
 const options={host:'127.0.0.1',port,database:'postgres',password:()=>'',ssl:false,connectionTimeoutMillis:3000,query_timeout:5000,max:2}
 admin=new pg.Pool({...options,user:'statistics_local_admin'})
 const schema=await readFile(new URL('../docs/deadhub/schema.sql',import.meta.url),'utf8')
 const tables=['accounts','matches'].map(name=>schema.match(new RegExp(`create table deadhub_private\\.${name} \\([\\s\\S]*?\\n\\);`))[0])
 await admin.query('CREATE SCHEMA deadhub_private;'+tables.join('\n'))
 await admin.query(`CREATE ROLE deadhub_app_login LOGIN NOSUPERUSER NOBYPASSRLS;
  GRANT USAGE ON SCHEMA deadhub_private TO deadhub_app_login;
  GRANT SELECT ON deadhub_private.matches TO deadhub_app_login;
  ALTER TABLE deadhub_private.matches ENABLE ROW LEVEL SECURITY;
  ALTER TABLE deadhub_private.matches FORCE ROW LEVEL SECURITY;
  CREATE POLICY match_owner ON deadhub_private.matches TO deadhub_app_login
   USING (owner_id=nullif(current_setting('deadhub.owner_id',true),'')::uuid);
  CREATE INDEX matches_owner_started_idx ON deadhub_private.matches(owner_id,started_at DESC)`)
 pool=new pg.Pool({...options,user:'deadhub_app_login'});store=createRecordStore(pool)
 for(let i=0;i<owners.length;i++)await admin.query('INSERT INTO deadhub_private.accounts(owner_id,steam_account_id,initial_from) VALUES($1,$2,$3)',[owners[i],i+1,'2025-01-01T00:00:00Z'])
 const rows=[
  ['2025-12-31T14:59:59Z',true,4,2,null,'90000','2000',3600],
  ['2025-12-31T15:00:00Z',false,0,0,0,'0','0',0],
  ['2026-01-31T15:00:00Z',null,2,null,null,'0',null,1800],
  ['2026-02-01T15:00:00Z',null,null,null,null,null,null,null]
 ]
 for(let i=0;i<rows.length;i++)await admin.query('INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,won,kills,deaths,assists,hero_damage,player_healing,duration_s) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[owners[0],i+1,...rows[i]])
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,won,kills) VALUES($1,1,'2024-01-01',true,9999)",[owners[1]])
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at) VALUES($1,1,'2026-01-01')",[owners[2]])
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,kills,deaths,assists,hero_damage,player_healing,duration_s) VALUES($1,1,'2026-01-01',0,0,0,0,0,0)",[owners[3]])
 console.log(JSON.stringify({temporary_cluster:folder,loopback_only:true,synthetic_only:true,production:false,postgres:(await admin.query('show server_version')).rows[0].server_version,grants:'SELECT on matches only'}))
})
after(async()=>{await pool?.end();await admin?.end();if(started)await command('pg_ctl',['-D',folder,'-w','-m','fast','stop'])})
test('actual SQL aggregates across months and years with null-aware counts and exact date range',async()=>{
 const data=await store.statistics(owners[0])
 assert.equal(data.match_count,'4');assert.deepEqual(data.outcomes,{wins:'1',losses:'1',unknown:'2'})
 assert.equal(statisticRatio(String(BigInt(data.outcomes.wins)*100n),String(BigInt(data.outcomes.wins)+BigInt(data.outcomes.losses))),'50.0')
 assert.deepEqual(data.metrics,{kills:{sum:'6',known:'3'},deaths:{sum:'2',known:'2'},assists:{sum:'0',known:'1'},hero_damage:{sum:'90000',known:'3'},player_healing:{sum:'2000',known:'2'},duration_s:{sum:'5400',known:'3'}})
 assert.equal(data.first_started_at,'2025-12-31T14:59:59.000Z');assert.equal(data.last_started_at,'2026-02-01T15:00:00.000Z')
 assert.equal(statisticDay(data.first_started_at),'2025/12/31 JST');assert.equal(statisticDay(data.last_started_at),'2026/02/02 JST')
 assert.equal(data.matches,undefined)
})
test('zero rows, all missing and actual zero retain their different database meanings',async()=>{
 const empty=await store.statistics(owners[4]),missing=await store.statistics(owners[2]),zero=await store.statistics(owners[3])
 assert.equal(empty.match_count,'0');assert.equal(empty.first_started_at,null);assert.equal(empty.last_started_at,null)
 assert.deepEqual(empty.outcomes,{wins:'0',losses:'0',unknown:'0'})
 assert.deepEqual(missing.outcomes,{wins:'0',losses:'0',unknown:'1'})
 for(const key of statisticFields){assert.deepEqual(empty.metrics[key],{sum:null,known:'0'});assert.deepEqual(missing.metrics[key],{sum:null,known:'0'});assert.deepEqual(zero.metrics[key],{sum:'0',known:'1'})}
})
test('pooled transaction owner context does not leak between users or subsequent unscoped reads',async()=>{
 const results=await Promise.all([store.statistics(owners[0]),store.statistics(owners[1]),store.statistics(owners[0])])
 assert.deepEqual(results.map(r=>r.match_count),['4','1','4']);assert.equal(results[1].metrics.kills.sum,'9999')
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM deadhub_private.matches')).rows[0].n,0)
})
test('existing owner RLS blocks a different owner even when the query predicate is forged',async()=>{
 const client=await pool.connect()
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('deadhub.owner_id',$1,true)",[owners[0]])
  assert.equal((await client.query('SELECT count(*)::int AS n FROM deadhub_private.matches')).rows[0].n,4)
  assert.equal((await client.query('SELECT count(*)::int AS n FROM deadhub_private.matches WHERE owner_id=$1',[owners[1]])).rows[0].n,0)
 }finally{await client.query('ROLLBACK');client.release()}
})
test('aggregation succeeds with SELECT only and no write, account-table or elevated privileges',async()=>{
 const r=(await pool.query("SELECT current_user,has_table_privilege(current_user,'deadhub_private.matches','SELECT') AS can_read,has_table_privilege(current_user,'deadhub_private.matches','INSERT') AS can_insert,has_table_privilege(current_user,'deadhub_private.accounts','SELECT') AS can_read_accounts")).rows[0]
 assert.deepEqual(r,{current_user:'deadhub_app_login',can_read:true,can_insert:false,can_read_accounts:false})
 assert.equal((await store.statistics(owners[0])).match_count,'4')
 await assert.rejects(pool.query('DELETE FROM deadhub_private.matches'),e=>e.code==='42501')
})
test('ten thousand stored matches still return one small aggregate, with integer precision retained',async()=>{
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_damage) SELECT $1,n,'2026-01-01'::timestamptz,9007199254740993 FROM generate_series(1,10000) n",[owners[5]])
 const data=await store.statistics(owners[5])
 assert.equal(data.match_count,'10000');assert.equal(data.metrics.hero_damage.sum,'90071992547409930000');assert.equal(data.metrics.hero_damage.known,'10000')
 assert.ok(Buffer.byteLength(JSON.stringify(data))<2000);assert.equal(data.matches,undefined)
})
