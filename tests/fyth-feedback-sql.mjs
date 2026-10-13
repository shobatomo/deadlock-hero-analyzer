// Disposable PostgreSQL 17.11, no network, passwords, real data or external DB.
import {spawn, execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {CONNECTION_CHECK_SQL} from '../public-app/backend/feedback-store.js'
const exec=promisify(execFile)
const image='postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
const name='fyth-feedback-sql-'+process.pid
const migration=new URL('../supabase/migrations/20261013111933_fyth_feedback_daily_counts.sql',import.meta.url)
const evidence=[]
function query(sql,{role,fail=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{stdio:['pipe','pipe','pipe']})
  let output='',error='';child.stdout.on('data',bytes=>output+=bytes);child.stderr.on('data',bytes=>error+=bytes)
  child.on('error',reject);child.on('close',code=>{if(fail){if(code===0)reject(Error('Expected permission/validation rejection'));else resolve(error)}else if(code!==0)reject(Error(error));else resolve(output.trim())})
  child.stdin.end((role?`SET SESSION AUTHORIZATION ${role};\n`:'')+sql)
 })
}
const app='fyth_feedback_app_login',privateTable='fyth_feedback_private.daily_counts'
const choice='使ってみたいと思った'
const add=(value=choice)=>`SELECT fyth_feedback_private.increment_choice('${value}');`
const total=()=>query(`SELECT COALESCE(sum(count),0) FROM ${privateTable} WHERE day=timezone('UTC',now())::date;`)
try {
 await exec('docker',['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image])
 for(let attempt=0;;attempt++){
  try{await exec('docker',['exec',name,'pg_isready','-U','postgres','-h','127.0.0.1']);break}catch{if(attempt>=100)throw Error('Isolated DB startup failed');await new Promise(r=>setTimeout(r,100))}
 }
 assert.match(await query('SELECT version();'),/PostgreSQL 17\.11/)
 await query(`CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE fyth_reader NOLOGIN;
 CREATE ROLE local_migration_admin NOLOGIN CREATEROLE; GRANT CREATE ON DATABASE postgres TO local_migration_admin;
 CREATE SCHEMA fyth_private; CREATE TABLE fyth_private.test_reference(value integer);
 GRANT USAGE ON SCHEMA fyth_private TO fyth_reader; GRANT SELECT ON fyth_private.test_reference TO fyth_reader;`)
 const baseline=await query("SELECT rolconfig::text FROM pg_roles WHERE rolname='fyth_reader'; SELECT relacl::text FROM pg_class WHERE oid='fyth_private.test_reference'::regclass;")
 await query(await readFile(migration,'utf8'),{role:'local_migration_admin'})
 const after=await query("SELECT rolconfig::text FROM pg_roles WHERE rolname='fyth_reader'; SELECT relacl::text FROM pg_class WHERE oid='fyth_private.test_reference'::regclass;")
 await query('SET ROLE fyth_feedback_owner; CREATE FUNCTION fyth_feedback_private.future_acl_probe() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;')
 assert.equal(await query("SELECT has_function_privilege('fyth_feedback_app_login','fyth_feedback_private.future_acl_probe()','EXECUTE');"),'f')
 await query('SET ROLE fyth_feedback_owner; DROP FUNCTION fyth_feedback_private.future_acl_probe();')
 assert.equal(after,baseline);evidence.push('migration succeeds as non-superuser CREATEROLE administrator; reader ACL/config unchanged')
 assert.equal(await query(`SELECT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname='${app}';`),'f')
 assert.equal(await query(`SELECT string_agg(column_name,',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='fyth_feedback_private' AND table_name='daily_counts';`),'day,choice,count')
 for(const role of ['anon','authenticated','fyth_reader',app,'fyth_feedback_submitter','fyth_feedback_maintenance']){
  for(const operation of [`SELECT * FROM ${privateTable};`,`INSERT INTO ${privateTable} VALUES (current_date,'${choice}',1);`,`UPDATE ${privateTable} SET count=count+1;`,`DELETE FROM ${privateTable};`,`TRUNCATE ${privateTable};`,`CREATE TABLE fyth_feedback_private.forbidden(value integer);`])await query(operation,{role,fail:true})
 }
 await query('SET ROLE fyth_feedback_owner;',{role:app,fail:true})
 await query('SET ROLE fyth_reader;',{role:app,fail:true})
 await query('SET ROLE fyth_feedback_submitter;',{role:app,fail:true})
 await query('SELECT * FROM fyth_private.test_reference;',{role:app,fail:true})
 await query('SELECT fyth_feedback_private.expire_counts();',{role:app,fail:true})
 for(const role of ['anon','authenticated','fyth_reader','fyth_feedback_maintenance'])await query(add(),{role,fail:true})
 evidence.push('all six unprivileged roles denied direct table read/write/truncate/create; app denied owner/reader/group SET ROLE and reference read/expiry')
 for(const value of ['使ってみたいと思った','使ってみたいとは思わなかった','まだ分からない'])assert.equal(await query(add(value),{role:app}),'stored')
 assert.equal(await query(add(),{role:app}),'stored');assert.equal(await total(),'4')
 assert.equal(await query(`SELECT count(*) FROM ${privateTable};`),'3')
 await query(add('未承認の理由'),{role:app,fail:true});assert.equal(await total(),'4')
 await query(`BEGIN ISOLATION LEVEL REPEATABLE READ; ${add()} COMMIT;`,{role:app,fail:true});assert.equal(await total(),'4')
 const probe=JSON.parse(await query(`SET statement_timeout='2s'; SET lock_timeout='500ms'; SELECT row_to_json(probe) FROM (${CONNECTION_CHECK_SQL}) AS probe;`,{role:app}))
 assert.equal(probe.current_role,app);assert.equal(probe.session_role,app);assert.equal(probe.can_increment,true);for(const key of ['can_expire','can_access_table','can_create','can_set_owner','can_set_maintenance'])assert.equal(probe[key],false)
 evidence.push('disabled-mode metadata probe SQL checks identity/privileges without reading or changing count rows')
 evidence.push('three exact choices aggregate into three rows; invalid choice and stale isolation reject without increment')
 const held=query('BEGIN; SELECT pg_advisory_xact_lock(190846237,1); SELECT pg_sleep(1.5); ROLLBACK;')
 for(let attempt=0;;attempt++){
  if(await query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND classid=190846237 AND objid=1 AND objsubid=2 AND granted);')==='t')break
  if(attempt>50)throw Error('Lock not acquired');await new Promise(r=>setTimeout(r,20))
 }
 assert.equal(await query(add(),{role:app}),'not_stored');assert.equal(await total(),'4');await held
 assert.equal(await query(add(),{role:app}),'stored');assert.equal(await total(),'5')
 evidence.push('global advisory contention rejects without write; completion releases capacity')
 await query(`TRUNCATE ${privateTable}; INSERT INTO ${privateTable} VALUES(timezone('UTC',now())::date,'${choice}',999);`)
 const results=await Promise.all(Array.from({length:8},()=>query(add('まだ分からない'),{role:app})))
 assert.equal(results.filter(value=>value==='stored').length,1);assert.equal(await total(),'1000')
 assert.equal(await query(add(),{role:app}),'not_stored');assert.equal(await total(),'1000')
 evidence.push('eight concurrent attempts at 999 yield exactly one accepted increment; global daily cap stays 1000')
 await query(`TRUNCATE ${privateTable}; INSERT INTO ${privateTable} VALUES(timezone('UTC',now())::date-1,'${choice}',1000);`)
 assert.equal(await query(add(),{role:app}),'stored');assert.equal(await total(),'1')
 await query(`SET TIME ZONE 'Pacific/Kiritimati'; ${add()}`,{role:app});assert.equal(await total(),'2')
 evidence.push('previous-day quota does not block today; session timezone does not alter UTC bucket')
 await query(`TRUNCATE ${privateTable}; INSERT INTO ${privateTable} SELECT timezone('UTC',now())::date-age,'${choice}',1 FROM generate_series(0,35) AS ages(age);`)
 await query('SELECT fyth_feedback_private.expire_counts();',{role:'fyth_feedback_maintenance'})
 assert.equal(await query(`SELECT count(*) FROM ${privateTable};`),'30')
 assert.equal(await query(`SELECT timezone('UTC',now())::date-min(day) FROM ${privateTable};`),'29')
 evidence.push('maintenance expiry works with zero submissions; boundary -29 retained and -30 deleted')
 await query(`INSERT INTO ${privateTable} VALUES(timezone('UTC',now())::date-30,'まだ分からない',1);`)
 assert.equal(await query(add(),{role:app}),'stored');assert.equal(await query(`SELECT count(*) FROM ${privateTable} WHERE day<timezone('UTC',now())::date-29;`),'0')
 evidence.push('increment also prunes expired buckets; maintenance cannot increment or read answers')
 const result=await exec('docker',['exec','-e','PGOPTIONS=-c default_transaction_isolation=read\\ committed',name,'psql','-X','-U','postgres','-Atq','-c','SHOW transaction_isolation;'])
 assert.equal(result.stdout.trim(),'read committed');evidence.push('actual PostgreSQL accepts adapter startup isolation options')
 const retentionSql=await readFile(new URL('../docs/fyth/feedback-retention-job.sql',import.meta.url),'utf8')
 const rejected=await query(retentionSql,{fail:true});assert.match(rejected,/pg_cron must already be installed/)
 evidence.push('Cron script stops safely when pg_cron is absent; real scheduler remains unverified')
 console.log(JSON.stringify({status:'passed',database:'isolated PostgreSQL 17.11',network:'none',realProjectAccess:false,passwordsCreated:false,evidence},null,2))
} finally {
 await exec('docker',['rm','-f',name]).catch(()=>{})
}
