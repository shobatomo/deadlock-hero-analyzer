import {trendHeroes,trendValue} from '../../public-app/shared/record-trends.mjs'
import {TREND_PAGE_SIZE} from '../../public-app/shared/trend-history.mjs'
export function historyRows(n=405) {
 return Array.from({length:n},(_,i)=>({match_id:String(i+1),started_at:new Date(Date.UTC(2025,11,30)+i*86400000).toISOString(),hero_id:15,
  kills:i===0?0:i===197?null:i+1,deaths:0,assists:i%12,hero_damage:i===199?null:i*60,duration_s:i===200?0:60}))
}
export function historyFixture({rows=historyRows(),heroId='15',page=1}={}) {
 const heroes=trendHeroes(rows),ordered=rows.filter(row=>String(row.hero_id)===heroId).sort((a,b)=>Date.parse(a.started_at)-Date.parse(b.started_at)||Number(a.match_id)-Number(b.match_id))
 const offset=(page-1)*TREND_PAGE_SIZE,context=Math.min(offset,4),dates=rows.map(row=>row.started_at).sort()
 return {scope:'saved_all_time',time_zone:'Asia/Tokyo',observed_at:'2027-02-15T00:00:00.000Z',
  match_count:rows.length,unknown_hero_count:rows.filter(row=>!row.hero_id).length,heroes,hero_id:heroId,
  first_started_at:dates[0]??null,last_started_at:dates.at(-1)??null,selected_count:ordered.length,
  page,page_size:TREND_PAGE_SIZE,offset,context_count:context,matches:ordered.slice(offset-context,offset+TREND_PAGE_SIZE),
  maxima:Object.fromEntries(['kills','deaths','assists','damage_per_minute'].map(key=>[key,rows.filter(row=>row.hero_id>0).reduce((max,row)=>{const value=trendValue(row,key);return value===null?max:max===null?value:Math.max(max,value)},null)]))}
}
