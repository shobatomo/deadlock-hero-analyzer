// Missing coverage: provider timestamps -> real page save -> monthly SQL read
// -> JST daily grouping at month/year/leap boundaries. Synthetic records only.
// node --import ./tests/deadhub-review-register.mjs tests/deadhub-jst-postgres.mjs <postgres-bin-dir>
// Creates its own loopback cluster; cannot accept an existing DB/connection URL.
// Uses only the two record tables. This does not test production RLS or roles.
import {test,before,after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createServer} from 'node:net'
import pg from '../public-app/node_modules/pg/lib/index.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {projectRecord} from '../public-app/backend/deadhub/provider.js'
import {tokyoDay,shiftMonth,daySummary} from '../public-app/shared/deadhub.mjs'
const bin=process.argv[2]
if(!bin)throw Error('Explicit PostgreSQL binary directory required; existing databases are not accepted')
const exec=promisify(execFile),command=(name,args)=>exec(join(resolve(bin),name+(process.platform==='win32'?'.exe':'')),args,{windowsHide:true,timeout:60000,maxBuffer:1024*1024})
const owner='00000000-0000-4000-8000-000000000001'
let data,pool,store,started=false
before(async()=>{
  data=await mkdtemp(join(tmpdir(),'deadhub-jst-pg-'))
  await command('initdb',['-D',data,'-U','jst_local_test','--auth-local=trust','--auth-host=trust','--encoding=UTF8','--no-locale'])
  const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r))
  await command('pg_ctl',['-D',data,'-l',join(data,'test.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=8`,'-w','start']);started=true
  pool=new pg.Pool({host:'127.0.0.1',port,user:'jst_local_test',database:'postgres',password:()=>'',ssl:false,max:1,connectionTimeoutMillis:3000,query_timeout:5000,options:'-c timezone=America/Los_Angeles'})
  const schema=await readFile(new URL('../docs/deadhub/schema.sql',import.meta.url),'utf8')
  const tables=['accounts','matches'].map(name=>{
    const match=schema.match(new RegExp(`create table deadhub_private\\.${name} \\([\\s\\S]*?\\n\\);`))
    assert.ok(match,'Record table definition missing: '+name);return match[0]
  })
  await pool.query('CREATE SCHEMA deadhub_private;'+tables.join('\n'));store=createRecordStore(pool)
  assert.equal((await pool.query('show timezone')).rows[0].TimeZone,'America/Los_Angeles')
  console.log(JSON.stringify({temporary_cluster:data,loopback_only:true,synthetic_only:true,production:false,postgres:(await pool.query('show server_version')).rows[0].server_version,rls_verified:false}))
})
beforeEach(async()=>{await pool.query('TRUNCATE deadhub_private.matches,deadhub_private.accounts');await store.register(owner,'1')})
after(async()=>{await pool?.end();if(started)await command('pg_ctl',['-D',data,'-w','-m','fast','stop'])})

for(const [month,start,end,lastDay] of [
  ['2026-10','2026-09-30T15:00:00Z','2026-10-31T15:00:00Z','31'],
  ['2027-01','2026-12-31T15:00:00Z','2027-01-31T15:00:00Z','31'],
  ['2028-02','2028-01-31T15:00:00Z','2028-02-29T15:00:00Z','29'],
])test(`${month}: real SQL includes JST start, excludes next month, and keeps midnight daily totals separate`,async()=>{
  const first=Date.parse(start),next=Date.parse(end),from=new Date(first-1000).toISOString(),until=new Date(next+1000).toISOString()
  const stamps=[first-1000,first,first+86400000-1000,first+86400000,next-1000,next]
  const records=stamps.map((time,i)=>projectRecord({match_id:100+i,start_time:time/1000,duration_s:600,match_outcome:'TeamWin',winning_team:'Team0',
    players:[{account_id:1,hero_id:15,team:'Team0',kills:i===2?null:0,deaths:0,assists:0,final_stats:{player_damage:i===2?null:0,player_healing:i===2?null:0}}]},'1',from,until))
  // Fixed test window avoids dependence on today's date, including future leap years.
  await pool.query('UPDATE deadhub_private.accounts SET initial_from=$2,window_from=$2,window_until=$3 WHERE owner_id=$1',[owner,from,until])
  const lease=await store.acquire(owner);await store.savePage(owner,lease,{records,done:true,cursor:null})
  const current=await store.snapshot(owner,month),previous=await store.snapshot(owner,shiftMonth(month,-1)),following=await store.snapshot(owner,shiftMonth(month,1))
  assert.deepEqual(current.matches.map(row=>row.match_id),['104','103','102','101'])
  assert.deepEqual(previous.matches.map(row=>row.match_id),['100'])
  assert.deepEqual(following.matches.map(row=>row.match_id),['105'])
  assert.equal(current.observed.count,6) // Stored total is distinct from this month's four rows.
  assert.deepEqual(current.matches.map(row=>tokyoDay(row.started_at)),[month+'-'+lastDay,month+'-02',month+'-01',month+'-01'])
  const daily=daySummary(current.matches.filter(row=>tokyoDay(row.started_at)===month+'-01'))
  assert.equal(daily.count,2)
  for(const field of ['kills','hero_damage','player_healing'])assert.deepEqual(daily[field],{value:0,known:1,total:2})
})
