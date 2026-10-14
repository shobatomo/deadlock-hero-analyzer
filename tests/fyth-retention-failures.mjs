// Existing SQL only on disposable PG17.11, network none, no real credentials/DB.
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const exec=promisify(execFile),name='fyth-retention-fixture-'+process.pid
const image='postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
const feedback='fyth_feedback_private.daily_counts',usage='fyth_usage_private.daily_counts'
const addF="SELECT fyth_feedback_private.increment_choice('まだ分からない');",addU="SELECT fyth_usage_private.increment_event('diagnosis_requested');"
function query(sql,{role,fail=false}={}){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);let out='',err=''
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>fail?(code?resolve(err):reject(Error('expected failure'))):(code?reject(Error(err)):resolve(out.trim())))
 p.stdin.end("\\set VERBOSITY sqlstate\n"+(role?`SET SESSION AUTHORIZATION ${role};\n`:'')+sql)
})}
function hold(sql){
 const p=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);let text=''
 const finished=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code?reject(Error('fixture lock failed')):resolve())})
 const ready=new Promise((resolve,reject)=>{p.stdout.on('data',b=>{text+=b;if(text.includes('fixture-held'))resolve()});p.on('error',reject);p.on('close',()=>{if(!text.includes('fixture-held'))reject(Error('fixture lock unavailable'))})})
 p.stdin.write('BEGIN; '+sql+" SELECT 'fixture-held';\n")
 return {ready,release:()=>{p.stdin.end('ROLLBACK;\n');return finished}}
}
async function seed(count=1){
 await query(`TRUNCATE ${feedback},${usage}; INSERT INTO ${feedback} VALUES(timezone('UTC',now())::date-30,'まだ分からない',1),(timezone('UTC',now())::date,'まだ分からない',${count}); INSERT INTO ${usage} VALUES(timezone('UTC',now())::date-30,'diagnosis_requested',1),(timezone('UTC',now())::date,'diagnosis_requested',${count});`)
}
const old=table=>query(`SELECT count(*) FROM ${table} WHERE day<timezone('UTC',now())::date-29;`)
const current=table=>query(`SELECT count FROM ${table} WHERE day=timezone('UTC',now())::date;`)
const evidence=[]
try{
 await exec('docker',['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image])
 for(let i=0;;i++){try{await exec('docker',['exec',name,'pg_isready','-U','postgres','-h','127.0.0.1']);break}catch{if(i>100)throw Error('startup');await new Promise(r=>setTimeout(r,100))}}
 await query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE local_migration_admin CREATEROLE; GRANT CREATE ON DATABASE postgres TO local_migration_admin;')
 for(const file of ['20261013111933_fyth_feedback_daily_counts.sql','20261014032452_fyth_usage_daily_counts.sql'])await query(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'),{role:'local_migration_admin'})
 await seed();assert.equal(await query(addF,{role:'fyth_feedback_app_login'}),'stored');assert.equal(await query(addU,{role:'fyth_usage_app_login'}),'stored')
 for(const table of [feedback,usage]){assert.equal(await old(table),'0');assert.equal(await current(table),'2')}
 evidence.push('successful autocommit removes expired rows and increments together')
 await seed();const lock=hold(`SELECT 1 FROM ${feedback} WHERE day<timezone('UTC',now())::date-29 FOR UPDATE; SELECT 1 FROM ${usage} WHERE day<timezone('UTC',now())::date-29 FOR UPDATE;`);await lock.ready
 try{for(const [statement,role] of [[addF,'fyth_feedback_app_login'],[addU,'fyth_usage_app_login']])assert.match(await query("SET lock_timeout='20ms'; SET statement_timeout='200ms'; "+statement,{role,fail:true}),/55P03/)}finally{await lock.release()}
 for(const table of [feedback,usage]){assert.equal(await old(table),'1');assert.equal(await current(table),'1')}
 evidence.push('expired DELETE lock timeout rolls back new increment; old rows remain')
 await seed(9)
 for(const table of [feedback,usage])await query(`ALTER TABLE ${table} ADD CONSTRAINT fixture_late_failure CHECK(count<10);`)
 for(const [statement,role] of [[addF,'fyth_feedback_app_login'],[addU,'fyth_usage_app_login']])assert.match(await query(statement,{role,fail:true}),/23514/)
 for(const table of [feedback,usage]){assert.equal(await old(table),'1');assert.equal(await current(table),'9');await query(`ALTER TABLE ${table} DROP CONSTRAINT fixture_late_failure;`)}
 evidence.push('INSERT failure after DELETE rolls back both; no partial cleanup/collection')
 await seed(1000);assert.equal(await query(addF,{role:'fyth_feedback_app_login'}),'not_stored');assert.equal(await old(feedback),'1');assert.equal(await current(feedback),'1000')
 evidence.push('feedback daily quota returns before expiry: stale rows remain, no new count')
 await seed();const advisory=hold('SELECT pg_advisory_xact_lock(190846237,1);');await advisory.ready
 try{assert.equal(await query(addF,{role:'fyth_feedback_app_login'}),'not_stored')}finally{await advisory.release()}
 assert.equal(await old(feedback),'1');assert.equal(await current(feedback),'1')
 evidence.push('feedback advisory rejection returns before expiry: stale rows remain, no new count')
 await seed()
 for(const [schema,role] of [['fyth_feedback_private','fyth_feedback_maintenance'],['fyth_usage_private','fyth_usage_maintenance']])assert.match(await query(`BEGIN READ ONLY; SELECT ${schema}.expire_counts(); COMMIT;`,{role,fail:true}),/25006/)
 for(const table of [feedback,usage])assert.equal(await old(table),'1')
 evidence.push('failed maintenance or no calls leaves old data; disabling intake does not delete it')
 const timeouts=await query("SET statement_timeout='0'; SET lock_timeout='0'; BEGIN; SET LOCAL ROLE fyth_feedback_maintenance; SHOW statement_timeout; SHOW lock_timeout; ROLLBACK;")
 assert.equal(timeouts,'0\n0')
 evidence.push('SET LOCAL ROLE does not add job timeouts; feedback command relies on executor settings')
 for(const [schema,role] of [['fyth_feedback_private','fyth_feedback_maintenance'],['fyth_usage_private','fyth_usage_maintenance']])await query(`BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='500ms'; SELECT ${schema}.expire_counts(); COMMIT;`,{role})
 for(const table of [feedback,usage])assert.equal(await old(table),'0')
 evidence.push('maintenance can purge stale rows without a submission or new privileges')
 // Design model only: successful cleanup renews lease atomically; failure leaves it stale.
 const end=Date.parse('2026-10-15T00:10:00Z');let lease=end
 const accepted=now=>Number.isFinite(lease)&&now<lease
 assert.equal(accepted(end-1),true);assert.equal(accepted(end),false);assert.equal(accepted(end+1),false)
 const failedCleanup=()=>{};failedCleanup();assert.equal(accepted(end+1),false)
 lease=NaN;assert.equal(accepted(end-1),false)
 evidence.push('proposed lease model rejects missing/expired marker; no DB lease implementation added')
 console.log(JSON.stringify({status:'passed',network:'none',real_project_access:false,evidence},null,2))
}finally{await exec('docker',['rm','-f',name]).catch(()=>{})}
