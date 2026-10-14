import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {formatSevenDayReport} from '../tools/fyth-seven-day-report.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/fyth-seven-day-report.json',import.meta.url),'utf8'))
const clone=()=>structuredClone(fixture)
test('7 UTC dates, exact choices and event totals; no unique-user or rendering claims',()=>{
 const text=formatSevenDayReport(fixture)
 assert.ok(text.includes('2026-10-08 ～ 2026-10-14'));assert.ok(text.includes('UTC当日分は途中'))
 assert.ok(text.includes('| 7日合計 | 3 | 1 | 2 | 1 | 1 |'));assert.ok(text.includes('| 7日合計 | 2 | 4 | 1 |'))
 for(const choice of ['使ってみたいと思った','使ってみたいとは思わなかった','まだ分からない'])assert.ok(text.includes(choice))
 for(const note of ['ユーザー数ではありません','本人テストを分離できません','画面描画','個人単位に結合できません','改善効果'])assert.ok(text.includes(note))
})
test('empty saved days remain zeros; incomplete/missing query results never become zeros',()=>{
 assert.ok(formatSevenDayReport(fixture).includes('| 2026-10-08 | 0 | 0 | 0 | 0 | 0 |'))
 for(const data of [{usage:[],feedback:fixture.feedback},{usage:fixture.usage,feedback:[]},{}])assert.throws(()=>formatSevenDayReport(data))
})
test('unsorted rows normalize without joining events to individuals',()=>{
 const data=clone();data.usage.reverse();data.feedback.reverse();assert.equal(formatSevenDayReport(data),formatSevenDayReport(fixture))
})
test('large PostgreSQL counts preserve precision; unsafe JS number rejected',()=>{
 const data=clone();data.usage[0].diagnosis_requested='9007199254740993';assert.ok(formatSevenDayReport(data).includes('| 7日合計 | 9007199254740996 |'))
 data.usage[0].diagnosis_requested=9007199254740992;assert.throws(()=>formatSevenDayReport(data))
})
test('rejects identifiers, unexpected fields, duplicates, invalid dates and invalid counts',()=>{
 for(const mutate of [d=>d.usage[0].account_id='public-private-fixture',d=>d.extra='unexpected',d=>d.usage[1].day_utc=d.usage[0].day_utc,d=>d.usage[0].day_utc='2026-02-30',d=>d.usage[0].diagnosis_ready=-1,d=>d.usage[0].diagnosis_ready=1.5,d=>d.usage[0].diagnosis_ready='1e3']){
  const data=clone();mutate(data);assert.throws(()=>formatSevenDayReport(data))
 }
})
test('two queries crossing UTC midnight must be fetched again, not combined',()=>{
 const data=clone();for(const row of data.feedback){row.window_end_utc='2026-10-15';row.day_utc=new Date(new Date(row.day_utc+'T00:00:00Z').valueOf()+86400000).toISOString().slice(0,10)}
 assert.throws(()=>formatSevenDayReport(data))
})
test('CLI rejects malformed/unexpected input with fixed code and no input content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fyth-report-fixture-'));const file=join(dir,'bad.json')
 try{
  await writeFile(file,JSON.stringify({private:'public-private-fixture'}))
  try{await promisify(execFile)(process.execPath,[new URL('../tools/fyth-seven-day-report.mjs',import.meta.url).pathname,file]);assert.fail('must reject')}catch(error){assert.equal(error.stdout,'');assert.equal(error.stderr,'{"status":"failed","code":"report_input_invalid"}\n')}
 }finally{await rm(dir,{recursive:true})}
})
