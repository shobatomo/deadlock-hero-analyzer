import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {USAGE_CHECK_SQL} from '../public-app/backend/usage-store.js'
const exec=promisify(execFile),name='fyth-usage-sql-'+process.pid
const image='postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
function query(sql,{role,fail=false}={}){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);let out='',err=''
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>fail?(code?resolve(err):reject(Error('expected rejection'))):(code?reject(Error(err)):resolve(out.trim())))
 p.stdin.end((role?`SET SESSION AUTHORIZATION ${role};\n`:'')+sql)
})}
try{
 await exec('docker',['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image])
 for(let i=0;;i++){try{await exec('docker',['exec',name,'pg_isready','-U','postgres','-h','127.0.0.1']);break}catch{if(i>100)throw Error('startup');await new Promise(r=>setTimeout(r,100))}}
 await query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE fyth_reader; CREATE ROLE local_migration_admin CREATEROLE; GRANT CREATE ON DATABASE postgres TO local_migration_admin;')
 await query(await readFile(new URL('../supabase/migrations/20261013111933_fyth_feedback_daily_counts.sql',import.meta.url),'utf8'),{role:'local_migration_admin'})
 const baseline=await query("SELECT rolconfig::text,rolcanlogin FROM pg_roles WHERE rolname='fyth_feedback_app_login'; SELECT proacl::text FROM pg_proc WHERE oid='fyth_feedback_private.increment_choice(text)'::regprocedure;")
 await query(await readFile(new URL('../supabase/migrations/20261014032452_fyth_usage_daily_counts.sql',import.meta.url),'utf8'),{role:'local_migration_admin'})
 assert.equal(await query("SELECT rolconfig::text,rolcanlogin FROM pg_roles WHERE rolname='fyth_feedback_app_login'; SELECT proacl::text FROM pg_proc WHERE oid='fyth_feedback_private.increment_choice(text)'::regprocedure;"),baseline)
 const add="SELECT fyth_usage_private.increment_event('diagnosis_requested');"
 await query(add,{role:'fyth_feedback_app_login',fail:true}) // Application grant deliberately separate.
 assert.equal(await query("SELECT rolcanlogin::text||':'||rolconnlimit::text FROM pg_roles WHERE rolname='fyth_usage_app_login';"),'false:1')
 assert.equal(await query("SELECT count(*) FROM pg_auth_members WHERE roleid='fyth_usage_submitter'::regrole AND member='fyth_feedback_app_login'::regrole;"),'0')

 for(const role of ['anon','authenticated','fyth_reader','fyth_feedback_app_login','fyth_usage_app_login','fyth_usage_submitter','fyth_usage_maintenance']){
  for(const sql of ['SELECT * FROM fyth_usage_private.daily_counts;','DELETE FROM fyth_usage_private.daily_counts;','UPDATE fyth_usage_private.daily_counts SET count=2;',"INSERT INTO fyth_usage_private.daily_counts VALUES(current_date,'diagnosis_ready',1);",'TRUNCATE fyth_usage_private.daily_counts;','CREATE TABLE fyth_usage_private.nope(x int);'])await query(sql,{role,fail:true})
 }
 const app='fyth_usage_app_login'
 const metadata=JSON.parse(await query("SET statement_timeout='800ms'; SET lock_timeout='100ms'; SELECT row_to_json(m) FROM ("+USAGE_CHECK_SQL+") m;",{role:app}))
 assert.equal(metadata.current_role,app);assert.equal(metadata.connection_limit,1);assert.equal(metadata.can_increment,true)
 for(const key of ['can_expire','can_access_table','can_create','can_set_owner','can_set_maintenance','can_submit_feedback'])assert.equal(metadata[key],false)

 for(const sql of ['SET ROLE fyth_feedback_app_login;',"SELECT fyth_feedback_private.increment_choice('まだ分からない');",'SET ROLE fyth_usage_owner;','SET ROLE fyth_usage_submitter;','SET ROLE fyth_usage_maintenance;','SELECT fyth_usage_private.expire_counts();',"SELECT fyth_usage_private.increment_event('secret');","SELECT fyth_usage_private.increment_event(NULL);"])await query(sql,{role:app,fail:true})
 await Promise.all(Array.from({length:8},()=>query(add,{role:app})))
 assert.equal(await query("SELECT count FROM fyth_usage_private.daily_counts WHERE event='diagnosis_requested';"),'8')
 await query("SET timezone='Pacific/Honolulu'; SELECT fyth_usage_private.increment_event('diagnosis_ready');",{role:app})
 assert.equal(await query("SELECT count(*) FROM fyth_usage_private.daily_counts WHERE day=timezone('UTC',now())::date;"),'2')
 await query("INSERT INTO fyth_usage_private.daily_counts VALUES(timezone('UTC',now())::date-29,'diagnosis_ready',1),(timezone('UTC',now())::date-30,'diagnosis_ready',1);")
 await query('SELECT fyth_usage_private.expire_counts();',{role:'fyth_usage_maintenance'})
 assert.equal(await query("SELECT count(*) FROM fyth_usage_private.daily_counts WHERE day=timezone('UTC',now())::date-29;"),'1')
 assert.equal(await query("SELECT count(*) FROM fyth_usage_private.daily_counts WHERE day<timezone('UTC',now())::date-29;"),'0')
 await query(add,{role:'fyth_usage_maintenance',fail:true})
 await query("INSERT INTO fyth_usage_private.daily_counts VALUES(timezone('UTC',now())::date-30,'diagnosis_error',1);")
 for(const event of ['diagnosis_withheld','diagnosis_error','diagnosis_disconnected'])await query(`SELECT fyth_usage_private.increment_event('${event}');`,{role:app})
 assert.equal(await query("SELECT count(*) FROM fyth_usage_private.daily_counts WHERE day<timezone('UTC',now())::date-29;"),'0')
 assert.equal(await query("SELECT count(*) FROM fyth_usage_private.daily_counts WHERE day=timezone('UTC',now())::date;"),'5')
 assert.equal(await query("SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='fyth_usage_private' AND table_name='daily_counts';"),'day,event,count')

 const retention=await readFile(new URL('../docs/fyth/usage-retention-job.sql',import.meta.url),'utf8')
 await query(retention,{fail:true})
 // No real pg_cron in this offline DB: mock catalog only, preserve guard/schedule text.
 await query("CREATE SCHEMA cron; CREATE TABLE cron.job(jobname text,schedule text,command text); CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS 'INSERT INTO cron.job VALUES($1,$2,$3) RETURNING 1::bigint';")
 const simulated=retention.split('\n').filter(line=>!line.includes("pg_catalog.pg_extension")).join('\n')
 await query("SET cron.timezone='Asia/Tokyo';"+simulated,{fail:true})
 assert.equal(await query('SELECT count(*) FROM cron.job;'),'0')
 await query("SET cron.timezone='GMT';"+simulated)
 assert.equal(await query("SELECT schedule FROM cron.job WHERE jobname='fyth-usage-expire-daily';"),'5 0 * * *')
 const command=await query("SELECT command FROM cron.job WHERE jobname='fyth-usage-expire-daily';")
 await query(command,{role:'local_migration_admin'})
 await query("SET cron.timezone='GMT';"+simulated,{fail:true})
 assert.equal(await query('SELECT count(*) FROM cron.job;'),'1')

 console.log(JSON.stringify({status:'passed',network:'none',real_project_access:false,baseline_feedback_unchanged:true,dedicated_role_nologin_limit1:true,feedback_grant_absent:true,parallel_increments:8,utc:true,retention_boundary:true,direct_access_denied:true,cron_absence_rejected:true,cron_timezone_guard:true,cron_catalog_mock_only:true}))
}finally{await exec('docker',['rm','-f',name]).catch(()=>{})}
