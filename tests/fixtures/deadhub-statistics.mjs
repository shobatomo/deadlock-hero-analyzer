import {statisticFields} from '../../public-app/shared/record-statistics.mjs'
export function statisticsFixture(mode='mixed'){
 const empty=mode==='empty',missing=mode==='missing',zero=mode==='zero',count=empty?'0':missing||zero?'2':'4'
 const pairs={kills:['6','3'],deaths:['3','2'],assists:['0','1'],hero_damage:['90000','3'],player_healing:['2000','2'],duration_s:['5400','2']}
 return {scope:'saved_all_time',time_zone:'Asia/Tokyo',observed_at:'2026-10-19T10:00:00Z',match_count:count,
  first_started_at:empty?null:'2025-12-31T14:59:59Z',last_started_at:empty?null:'2026-02-01T15:00:00Z',
  outcomes:empty?{wins:'0',losses:'0',unknown:'0'}:missing||zero?{wins:'0',losses:'0',unknown:'2'}:{wins:'1',losses:'1',unknown:'2'},
  metrics:Object.fromEntries(statisticFields.map(key=>[key,empty||missing?{sum:null,known:'0'}:zero?{sum:'0',known:'2'}:{sum:pairs[key][0],known:pairs[key][1]}]))}
}
