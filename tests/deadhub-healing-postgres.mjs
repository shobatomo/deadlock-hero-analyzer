// Disposable loopback PostgreSQL only. No existing DB, connection strings,
// credentials, API requests, role/grant/policy changes, or environment files.
import {test,before,after} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:net'
import pg from '../public-app/node_modules/pg/lib/index.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {projectRecord} from '../public-app/backend/deadhub/provider.js'
import {daySummary} from '../public-app/shared/deadhub.mjs'
const bin=process.platform==='win32'?'C:/Program Files/PostgreSQL/16/bin':'/usr/lib/postgresql/16/bin'
const exec=promisify(execFile),command=(name,args)=>exec(join(bin,name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024})
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002'
const stamp='2026-10-05T12:31:21.000Z',range={from:'2026-10-01T00:00:00Z',until:'2026-11-01T00:00:00Z'}
let folder,pool,store,started=false
before(async()=>{
  folder=await mkdtemp(join(tmpdir(),'deadhub-healing-pg-'))
  await command('initdb',['-D',folder,'-U','healing_local_test','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'])
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
  await command('pg_ctl',['-D',folder,'-l',join(folder,'test.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=8`,'-w','start']);started=true
  pool=new pg.Pool({host:'127.0.0.1',port,user:'healing_local_test',database:'postgres',password:()=>'',ssl:false,max:1,connectionTimeoutMillis:3000,query_timeout:15000})
  const {stdout:schema}=await exec('git',['show','2cc9b7e0e16c7b4861442f17059a4eedaeac6282:docs/deadhub/schema.sql'],{cwd:new URL('../',import.meta.url),windowsHide:true})
  const tables=['accounts','matches'].map(name=>schema.match(new RegExp(`create table deadhub_private\\.${name} \\([\\s\\S]*?\\n\\);`))[0])
  await pool.query('CREATE SCHEMA deadhub_private;'+tables.join('\n'))
  store=createRecordStore(pool);await store.register(owner,'1');await store.register(other,'2')
  await pool.query('INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,kills,hero_damage) VALUES($1,90,$2,4,41901)',[owner,stamp])
  await pool.query(await readFile(new URL('../docs/deadhub/healing-schema-proposal.sql',import.meta.url),'utf8'))
  console.log(JSON.stringify({postgres:(await pool.query('show server_version')).rows[0].server_version,temporary_cluster:folder,loopback_only:true,synthetic_data_only:true,production:false,rls_scope:'Existing policy behavior is not tested by this table-only harness.'}))
})
after(async()=>{await pool?.end();if(started)await command('pg_ctl',['-D',folder,'-w','-m','fast','stop'])})
const record=(id,healing)=>projectRecord({match_id:id,start_time:stamp.replace('.000',''),duration_s:2375,winning_team:'Team0',match_outcome:'TeamWin',
  players:[{account_id:1,hero_id:15,team:'Team0',kills:4,deaths:2,assists:3,final_stats:{player_damage:41901,player_healing:healing,self_healing:2000,teammate_healing:462}}]},'1',range.from,range.until)
async function save(records,who=owner){
  await pool.query('UPDATE deadhub_private.accounts SET retry_after=null WHERE owner_id=$1',[who])
  const lease=await store.acquire(who);await store.savePage(who,lease,{records,done:true,cursor:null})
}
const snapshot=who=>store.snapshot(who??owner,'2026-10')
const find=async id=>(await snapshot()).matches.find(row=>row.match_id===String(id))

test('migration retains legacy data, adds nullable bigint without default, and enforces nonnegative values',async()=>{
  const column=(await pool.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='deadhub_private' AND table_name='matches' AND column_name='player_healing'")).rows[0]
  assert.deepEqual(column,{data_type:'bigint',is_nullable:'YES',column_default:null})
  const legacy=await find(90);assert.equal(legacy.player_healing,null);assert.equal(legacy.kills,4);assert.equal(legacy.hero_damage,41901)
  await assert.rejects(pool.query('UPDATE deadhub_private.matches SET player_healing=-1 WHERE match_id=90'),e=>e.code==='23514'&&e.constraint==='matches_player_healing_nonnegative')
  assert.equal((await find(90)).player_healing,null)
})

test('provider -> actual store -> PostgreSQL -> JSON snapshot preserves 2462 and resync replaces without double counting',async()=>{
  await save([record(91,2462)]);await save([record(91,2462)])
  const rows=(await snapshot()).matches.filter(row=>row.match_id==='91')
  assert.equal(rows.length,1);assert.equal(rows[0].player_healing,2462);assert.equal(typeof rows[0].player_healing,'number')
  assert.equal(JSON.parse(JSON.stringify(rows))[0].player_healing,2462)
  await save([record(91,3000)]);assert.equal((await find(91)).player_healing,3000)
})

test('sparse or invalid later observations cannot erase saved healing; explicit zero can replace it',async()=>{
  for(const value of [undefined,null,-1,'invalid'])await save([record(91,value)])
  assert.equal((await find(91)).player_healing,3000)
  await save([record(91,0)]);await save([record(91,null)])
  assert.equal((await find(91)).player_healing,0)
  await save([record(91,2462)]);assert.equal((await find(91)).player_healing,2462)
})

test('new missing healing stays null and fills on ordinary resync; batch widths preserve adjacent fields',async()=>{
  await save([record(92,null),record(93,0)])
  assert.equal((await find(92)).player_healing,null);assert.equal((await find(93)).player_healing,0)
  await save([record(92,2462),record(93,0)])
  for(const id of [92,93]){const row=await find(id);assert.equal(row.duration_s,2375);assert.equal(row.hero_damage,41901);assert.equal(row.final_items,null)}
  assert.equal((await find(92)).player_healing,2462)
})

test('same match ID remains owner scoped and missing daily values yield a partial total including real zero',async()=>{
  await save([record(91,100)],other)
  const own=(await snapshot()).matches,theirs=(await snapshot(other)).matches
  assert.equal(theirs.length,1);assert.equal(theirs[0].player_healing,100)
  assert.equal(own.find(row=>row.match_id==='91').player_healing,2462)
  assert.deepEqual(daySummary(own).player_healing,{value:4924,known:3,total:4})
})

test('old explicit-column inserts/updates remain compatible after migration',async()=>{
  await pool.query('INSERT INTO deadhub_private.matches(owner_id,match_id,started_at,kills) VALUES($1,94,$2,0)',[owner,stamp])
  assert.equal((await find(94)).player_healing,null)
  await pool.query('UPDATE deadhub_private.matches SET kills=5 WHERE owner_id=$1 AND match_id=91',[owner])
  assert.equal((await find(91)).player_healing,2462);assert.equal((await find(91)).kills,5)
})
