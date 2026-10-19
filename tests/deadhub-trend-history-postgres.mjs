// Explicit disposable loopback cluster only; no existing DB or credentials.
// Fixtures reproduce existing owner RLS with SELECT-only access, never production.
// node --import ./tests/deadhub-review-register.mjs tests/deadhub-trend-history-postgres.mjs <postgres-bin-dir>
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
import {buildHeroTrend} from '../public-app/shared/record-trends.mjs'
import {historyRows} from './fixtures/deadhub-trend-history.mjs'
const bin=process.argv[2]
if(!bin)throw Error('Explicit PostgreSQL binary directory required; existing databases are not accepted')
const exec=promisify(execFile),command=(name,args)=>exec(join(resolve(bin),name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024})
const owners=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'))
let folder,admin,pool,store,started=false
before(async()=>{
 folder=await mkdtemp(join(tmpdir(),'deadhub-trend-history-pg-'))
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

test('real SQL traverses all saved months and years without truncation and preserves the same five-match windows',async()=>{
 await admin.query('DELETE FROM deadhub_private.matches WHERE owner_id=$1',[owners[0]])
 const rows=historyRows(405)
 await admin.query(`INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_id,kills,deaths,assists,hero_damage,duration_s)
 SELECT $1,x.match_id,x.started_at,x.hero_id,x.kills,x.deaths,x.assists,x.hero_damage,x.duration_s
 FROM jsonb_to_recordset($2::jsonb) AS x(match_id bigint,started_at timestamptz,hero_id integer,kills integer,deaths integer,assists integer,hero_damage bigint,duration_s integer)`,[owners[0],JSON.stringify(rows)])
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_id,kills) VALUES($1,1001,'2024-01-01T00:00:00Z',4,999),($1,1002,'2023-12-31T00:00:00Z',NULL,9999),($1,1003,'2023-12-30T00:00:00Z',0,9999)",[owners[0]])
 const collected=[]
 for(let page=1;page<=3;page++){
  const data=await store.trendHistory(owners[0],{hero_id:'15',page:String(page)})
  assert.equal(data.match_count,408);assert.equal(data.unknown_hero_count,2);assert.equal(data.selected_count,405)
  assert.equal(data.maxima.kills,999);assert.equal(data.first_started_at,'2023-12-30T00:00:00.000Z')
  assert.deepEqual(data.heroes,[{id:'15',count:405},{id:'4',count:1}]);assert.ok(data.matches.length<=204)
  assert.ok(data.matches.every(row=>Object.keys(row).length===8 && !('owner_id' in row) && !('final_items' in row)))
  collected.push(...buildHeroTrend(data.matches,{month:null,heroId:'15',metric:'kills'}).points.slice(data.context_count))
 }
 assert.deepEqual(collected.map(p=>[p.row.match_id,p.value,p.average]),buildHeroTrend(rows,{month:null,heroId:'15',metric:'kills'}).points.map(p=>[p.row.match_id,p.value,p.average]))
 assert.equal((await store.trendHistory(owners[0])).hero_id,'15')
 assert.equal((await store.trendHistory(owners[0],{hero_id:'4'})).matches[0].kills,999)
 assert.equal((await store.trendHistory(owners[0],{hero_id:'99'})).selected_count,0)
 await assert.rejects(store.trendHistory(owners[0],{hero_id:'15',page:'4'}),e=>e.status===400)
})
test('database empty, unknown-only, zero and missing cases are honest',async()=>{
 const empty=await store.trendHistory(owners[4]),unknown=await store.trendHistory(owners[2])
 assert.equal(empty.match_count,0);assert.equal(empty.first_started_at,null);assert.deepEqual(empty.matches,[])
 assert.equal(unknown.unknown_hero_count,1);assert.equal(unknown.hero_id,null)
 await admin.query('UPDATE deadhub_private.matches SET hero_id=15 WHERE owner_id=ANY($1::uuid[])',[ [owners[2],owners[3]] ])
 const missing=await store.trendHistory(owners[2]),zero=await store.trendHistory(owners[3])
 assert.equal(missing.matches[0].kills,null);assert.equal(zero.matches[0].kills,0)
 assert.equal(missing.maxima.kills,null);assert.equal(zero.maxima.kills,0);assert.equal(zero.maxima.damage_per_minute,null)
})
test('SELECT-only existing grants suffice; reused sessions and forged predicates remain owner isolated',async()=>{
 const values=await Promise.all([store.trendHistory(owners[0]),store.trendHistory(owners[1]),store.trendHistory(owners[0])])
 assert.deepEqual(values.map(value=>value.match_count),[408,1,408])
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM deadhub_private.matches')).rows[0].n,0)
 const client=await pool.connect()
 try{
  await client.query('BEGIN');await client.query("SELECT set_config('deadhub.owner_id',$1,true)",[owners[0]])
  assert.equal((await client.query('SELECT count(*)::int AS n FROM deadhub_private.matches WHERE owner_id=$1',[owners[1]])).rows[0].n,0)
 }finally{await client.query('ROLLBACK');client.release()}
 const grants=(await pool.query("SELECT has_table_privilege(current_user,'deadhub_private.matches','SELECT') AS read,has_table_privilege(current_user,'deadhub_private.matches','INSERT') AS write,has_table_privilege(current_user,'deadhub_private.accounts','SELECT') AS accounts")).rows[0]
 assert.deepEqual(grants,{read:true,write:false,accounts:false})
 await assert.rejects(pool.query('DELETE FROM deadhub_private.matches'),e=>e.code==='42501')
})
test('ten thousand matches have bounded responses through the last page, ordered by exact bigint IDs for tied timestamps',async()=>{
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_id,kills) SELECT $1,9007199254740992+n,'2026-01-01'::timestamptz,15,n FROM generate_series(1,10000) n",[owners[5]])
 const first=await store.trendHistory(owners[5]),last=await store.trendHistory(owners[5],{page:'50'})
 assert.equal(first.match_count,10000);assert.equal(first.matches.length,200);assert.equal(first.matches[0].match_id,'9007199254740993')
 assert.equal(last.matches.length,204);assert.equal(last.matches.at(-1).match_id,'9007199254750992')
 assert.ok(Buffer.byteLength(JSON.stringify(last))<50000)
 const points=buildHeroTrend(last.matches,{month:null,heroId:'15',metric:'kills'}).points.slice(4)
 assert.equal(points[0].average,9799);assert.equal(points.at(-1).average,9998)
})
test('metadata and page share a repeatable read snapshot even if a match arrives between queries',async()=>{
 let inserted=false
 const wrapped=createRecordStore({connect:async()=>{
  const client=await pool.connect();return {release:broken=>client.release(broken),query:async(sql,params)=>{
   const result=await client.query(sql,params)
   if(!inserted && sql.includes('AS unknown_hero_count')){inserted=true;await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_id,kills) VALUES($1,20000,'2028-01-01',15,123)",[owners[5]])}
   return result
  }}
 }})
 const current=await wrapped.trendHistory(owners[5],{page:'50'}),next=await store.trendHistory(owners[5],{page:'51'})
 assert.equal(current.match_count,10000);assert.equal(current.matches.at(-1).kills,10000)
 assert.equal(next.match_count,10001);assert.equal(next.matches.at(-1).kills,123)
})
test('hero metadata boundary fails explicitly instead of silently dropping groups',async()=>{
 await admin.query("INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,hero_id) SELECT $1,n,'2026-01-01'::timestamptz,n FROM generate_series(1,513) n",[owners[4]])
 await assert.rejects(store.trendHistory(owners[4]),e=>e.code==='trend_capacity'&&e.status===503)
})
