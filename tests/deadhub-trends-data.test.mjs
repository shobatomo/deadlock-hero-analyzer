import {test} from 'node:test'
import assert from 'node:assert/strict'
import {trendHeroes,trendHeroId,trendValue,rollingFive,buildHeroTrend,lineSegments,trendCeiling,monthlyTrendCeiling} from '../public-app/shared/record-trends.mjs'
const month='2026-10'
const row=(n,extra={})=>({match_id:String(n),started_at:`2026-10-${String(n).padStart(2,'0')}T12:00:00+09:00`,hero_id:15,kills:n,deaths:n+1,assists:n+2,hero_damage:n*100,duration_s:60,...extra})
const model=(rows,metric='kills',heroId='15')=>buildHeroTrend(rows,{month,heroId,metric})
test('empty, one, four and five matches have the correct rolling-five eligibility',()=>{
 assert.deepEqual(rollingFive([]),[])
 assert.deepEqual(rollingFive([0]),[null])
 assert.deepEqual(rollingFive([1,2,3,4]),[null,null,null,null])
 assert.deepEqual(rollingFive([1,2,3,4,5,6]),[null,null,null,null,3,4])
 assert.equal(model([]).points.length,0);assert.equal(model([row(1)]).averages,0)
})
test('a missing value breaks every five-match window containing it and never borrows older values',()=>{
 const values=[1,2,3,4,5,null,7,8,9,10,11,12]
 assert.deepEqual(rollingFive(values),[null,null,null,null,3,null,null,null,null,null,9,10])
 assert.deepEqual(lineSegments(values).map(run=>run.map(p=>p.index)),[[0,1,2,3,4],[6,7,8,9,10,11]])
 assert.deepEqual(lineSegments(rollingFive(values)).map(run=>run.map(p=>p.index)),[[4],[10,11]])
})
test('actual zero survives in counts, damage per minute, the mean and an all-zero axis',()=>{
 const input=row(1,{kills:0,deaths:0,assists:0,hero_damage:0,duration_s:120})
 for(const key of ['kills','deaths','assists','damage_per_minute'])assert.equal(trendValue(input,key),0)
 assert.deepEqual(rollingFive([0,0,0,0,0]),[null,null,null,null,0])
 assert.equal(trendCeiling([{value:0}]),2)
 assert.deepEqual(lineSegments([null,0,null,0]).map(x=>x.map(p=>p.index)),[[1],[3]])
})
test('damage/min uses each match duration; zero or missing duration never becomes zero damage/min',()=>{
 assert.equal(trendValue(row(1,{hero_damage:1200,duration_s:120}),'damage_per_minute'),600)
 for(const duration_s of [0,null,undefined,-1,NaN,Infinity,'120'])assert.equal(trendValue(row(1,{duration_s}),'damage_per_minute'),null)
 for(const hero_damage of [null,undefined,-1,NaN,Infinity,'100'])assert.equal(trendValue(row(1,{hero_damage}),'damage_per_minute'),null)
 assert.equal(trendValue(row(1,{hero_damage:0,duration_s:0}),'damage_per_minute'),null)
})
test('K/D/A are separate counts, not a ratio; invalid numeric values remain missing',()=>{
 assert.deepEqual(['kills','deaths','assists'].map(key=>trendValue(row(1,{kills:8,deaths:0,assists:12}),key)),[8,0,12])
 for(const kills of [null,undefined,-1,NaN,Infinity,'0',1.5])assert.equal(trendValue(row(1,{kills}),'kills'),null)
 assert.throws(()=>trendValue(row(1),'ratio'),/Unknown/)
})
test('damage/min mean is an arithmetic mean of per-match rates, not weighted by duration',()=>{
 const records=[row(1,{hero_damage:60,duration_s:60}),row(2,{hero_damage:600,duration_s:600}),row(3,{hero_damage:0}),row(4,{hero_damage:120}),row(5,{hero_damage:60})]
 assert.equal(model(records,'damage_per_minute').points.at(-1).average,60)
 const changed=records.map(r=>r.match_id==='3'?{...r,duration_s:0}:r)
 assert.equal(model(changed,'damage_per_minute').points.at(-1).average,null)
 assert.equal(model(changed,'kills').points.at(-1).average,3)
})
test('hero filtering happens before chronological windows; another hero cannot fill or break a window',()=>{
 const records=[row(1),row(2),row(3,{hero_id:4,kills:null}),row(4),row(5),row(6),row(7,{hero_id:null})]
 assert.deepEqual(model(records).points.map(p=>p.row.match_id),['1','2','4','5','6'])
 assert.ok(Math.abs(model(records).points.at(-1).average-3.6)<1e-12)
 assert.deepEqual(trendHeroes(records),[{id:'15',count:5},{id:'4',count:1}])
 assert.equal(trendHeroId(null),null);assert.equal(trendHeroId(0),null);assert.equal(trendHeroId('15'),'15')
})
test('sort ascending by start, then exact numeric match ID, without mutating saved records',()=>{
 const same='2026-10-02T12:00:00+09:00',records=[row(3),row(2,{match_id:'9007199254740993',started_at:same}),row(1),row(2,{match_id:'9007199254740992',started_at:same})]
 const before=structuredClone(records)
 assert.deepEqual(model(records).points.map(p=>p.row.match_id),['1','9007199254740992','9007199254740993','3'])
 assert.deepEqual(records,before)
})
test('JST calendar month boundaries exclude previous/next month, so the average never crosses month boundaries',()=>{
 const records=[row(1,{started_at:'2026-09-30T14:59:59Z'}),row(2,{started_at:'2026-09-30T15:00:00Z'}),row(3),row(4),row(5,{started_at:'2026-10-31T14:59:59Z'}),row(6,{started_at:'2026-10-31T15:00:00Z'})]
 const result=model(records)
 assert.deepEqual(result.points.map(p=>p.row.match_id),['2','3','4','5']);assert.equal(result.averages,0)
})
test('malformed dates cannot silently manufacture consecutive-five averages',()=>{
 const result=model([1,2,3,4,5].map(n=>row(n)).concat(row(6,{started_at:'invalid'})))
 assert.equal(result.undated,1);assert.equal(result.points.length,5);assert.equal(result.averages,0)
})
test('large saved months retain every match rather than sampling or collapsing missing positions',()=>{
 const records=Array.from({length:2000},(_,index)=>row(1,{match_id:String(index+1),started_at:new Date(Date.parse('2026-10-01T00:00:00+09:00')+index*1000).toISOString(),kills:index%13===0?null:index%30}))
 const result=model(records.reverse())
 assert.equal(result.points.length,2000);assert.equal(result.points[0].row.match_id,'1');assert.equal(result.points.at(-1).row.match_id,'2000')
 for(let i=4;i<result.points.length;i++)assert.equal(result.points[i].average===null,result.points.slice(i-4,i+1).some(p=>p.value===null))
})
test('one monthly metric scale includes all identified heroes but excludes unknown heroes and other months',()=>{
 const records=[row(1,{kills:3}),row(2,{hero_id:4,kills:31}),row(3,{hero_id:null,kills:999}),row(4,{started_at:'2026-09-30T14:59:59Z',kills:1000})]
 assert.equal(monthlyTrendCeiling(records,{month,metric:'kills'}),50)
 assert.equal(monthlyTrendCeiling([],{month,metric:'kills'}),2)
})
