// Disposable PG17 fixture, network none; no real DB/credentials.
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {formatSevenDayReport} from '../tools/fyth-seven-day-report.mjs'
const exec=promisify(execFile),name='fyth-read-report-'+process.pid
const image='postgres:17.11-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826'
function query(sql){return new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i',name,'psql','-X','-U','postgres','-Atq','-v','ON_ERROR_STOP=1']);let out='',err=''
 p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(sql)
})}
try{
 await exec('docker',['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image])
 for(let i=0;;i++){try{await exec('docker',['exec',name,'pg_isready','-U','postgres','-h','127.0.0.1']);break}catch{if(i>100)throw Error('startup');await new Promise(r=>setTimeout(r,100))}}
 await query(`CREATE SCHEMA fyth_usage_private; CREATE SCHEMA fyth_feedback_private;
 CREATE TABLE fyth_usage_private.daily_counts(day date,event text,count bigint,PRIMARY KEY(day,event));
 CREATE TABLE fyth_feedback_private.daily_counts(day date,choice text,count bigint,PRIMARY KEY(day,choice));
 CREATE ROLE report_fixture NOLOGIN; GRANT USAGE ON SCHEMA fyth_usage_private,fyth_feedback_private TO report_fixture;
 GRANT SELECT ON fyth_usage_private.daily_counts,fyth_feedback_private.daily_counts TO report_fixture;`)
 const today=await query("SELECT timezone('UTC',now())::date::text;")
 await query(`INSERT INTO fyth_usage_private.daily_counts VALUES
 ('${today}','diagnosis_requested',3),('${today}','diagnosis_ready',1),('${today}','diagnosis_withheld',2),('${today}','diagnosis_error',1),('${today}','diagnosis_disconnected',1),
 ('${today}'::date-1,'diagnosis_requested',9007199254740993),('${today}'::date-6,'diagnosis_requested',9),('${today}'::date-7,'diagnosis_requested',50),('${today}'::date+1,'diagnosis_requested',777);
 INSERT INTO fyth_feedback_private.daily_counts VALUES('${today}','使ってみたいと思った',2),('${today}','使ってみたいとは思わなかった',4),('${today}','まだ分からない',1);`)
 const baseline=await query("SELECT json_agg(t ORDER BY day,event)::text FROM fyth_usage_private.daily_counts t; SELECT json_agg(t ORDER BY day,choice)::text FROM fyth_feedback_private.daily_counts t;")
 const report={}
 for(const [kind,file] of [['usage','seven-day-usage.sql'],['feedback','seven-day-feedback.sql']]){
  const sql=(await readFile(new URL('../docs/fyth/'+file,import.meta.url),'utf8')).trim().replace(/;$/,'')
  report[kind]=JSON.parse(await query("SET SESSION AUTHORIZATION report_fixture; SET timezone='Pacific/Kiritimati'; BEGIN READ ONLY; SELECT json_agg(r) FROM ("+sql+") r; COMMIT;"))
  assert.equal(report[kind].length,7);assert.equal(report[kind].at(-1).day_utc,today);assert.equal(report[kind][0].window_end_utc,today)
 }
 assert.equal(report.usage.at(-1).diagnosis_requested,'3');assert.equal(report.usage.at(-1).diagnosis_ready,'1')
 assert.equal(report.usage.at(-2).diagnosis_requested,'9007199254740993');assert.equal(report.usage[0].diagnosis_requested,'9');assert.equal(report.usage[1].diagnosis_requested,'0')
 assert.equal(report.feedback.at(-1).feedback_wanted,'2');assert.equal(report.feedback.at(-1).feedback_unwanted,'4');assert.equal(report.feedback.at(-1).feedback_unsure,'1')
 assert.ok(formatSevenDayReport(report).includes('9007199254741005'))
 assert.equal(await query("SELECT json_agg(t ORDER BY day,event)::text FROM fyth_usage_private.daily_counts t; SELECT json_agg(t ORDER BY day,choice)::text FROM fyth_feedback_private.daily_counts t;"),baseline)
 console.log(JSON.stringify({status:'passed',network:'none',real_database_access:false,read_only_transaction:true,rows_per_table:7,utc_boundary:true,no_join_multiplication:true,bigint_precision:true,fixture_data_unchanged:true}))
}finally{await exec('docker',['rm','-f',name]).catch(()=>{})}
