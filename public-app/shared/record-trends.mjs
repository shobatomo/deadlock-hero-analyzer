import {monthBounds} from './deadhub.mjs'

export const TREND_METRICS = [
  {id:'kills', label:'キル', short:'キル（K）', unit:'回'},
  {id:'deaths', label:'デス', short:'デス（D）', unit:'回'},
  {id:'assists', label:'アシスト', short:'アシスト（A）', unit:'回'},
  {id:'damage_per_minute', label:'敵ヒーローへの分間ダメージ', short:'ダメージ/分', unit:'ダメージ/分'},
]
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
export function trendHeroId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647 ? value : null
}
export function trendHeroes(rows) {
  const counts = new Map()
  for (const row of rows) {
    const id = trendHeroId(row.hero_id)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts].map(([id,count]) => ({id,count})).sort((a,b) => b.count-a.count || Number(a.id)-Number(b.id))
}
export function trendValue(row, metric) {
  if (metric === 'damage_per_minute') {
    if (!nonnegative(row.hero_damage) || !nonnegative(row.duration_s) || row.duration_s === 0) return null
    const value = row.hero_damage / row.duration_s * 60
    return Number.isFinite(value) ? value : null
  }
  if (!['kills','deaths','assists'].includes(metric)) throw new Error('Unknown trend metric')
  return nonnegative(row[metric]) && Number.isInteger(row[metric]) ? row[metric] : null
}
export function rollingFive(values) {
  return values.map((_,index) => {
    if (index < 4) return null
    const window = values.slice(index-4,index+1)
    // Never skip missing matches or reach outside these five consecutive matches.
    return window.every(nonnegative) ? window.reduce((sum,value) => sum+value/5,0) : null
  })
}
function compareIds(left,right) {
  const a = String(left), b = String(right)
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
  return a < b ? -1 : a > b ? 1 : 0
}
export function buildHeroTrend(rows,{month,heroId,metric}) {
  const bounds = month === null ? null : monthBounds(month)
  const start = bounds ? Date.parse(bounds.start) : -Infinity, end = bounds ? Date.parse(bounds.end) : Infinity
  const selected = rows.filter(row => trendHeroId(row.hero_id) === heroId)
  const undated = selected.filter(row => !Number.isFinite(Date.parse(row.started_at))).length
  const ordered = selected.filter(row => {
    const time = Date.parse(row.started_at)
    return Number.isFinite(time) && time >= start && time < end
  }).slice().sort((a,b) => Date.parse(a.started_at)-Date.parse(b.started_at) || compareIds(a.match_id,b.match_id))
  const values = ordered.map(row => trendValue(row,metric))
  // Stored dates are required by the DB. If malformed input occurs, do not imply
  // that excluding an unordered match leaves a known consecutive-five window.
  const averages = undated ? values.map(() => null) : rollingFive(values)
  return {points:ordered.map((row,index) => ({row,index,value:values[index],average:averages[index]})),undated,
    missing:values.filter(value => value === null).length, averages:averages.filter(value => value !== null).length}
}
export function lineSegments(values) {
  const segments = []
  let current = []
  values.forEach((value,index) => {
    if (value === null) { if (current.length) segments.push(current); current = [] }
    else current.push({index,value})
  })
  if (current.length) segments.push(current)
  return segments
}
export function trendCeiling(points) {
  let maximum = 0
  for (const point of points) if (point.value !== null) maximum = Math.max(maximum,point.value)
  if (maximum === 0) return 2
  const magnitude = 10 ** Math.floor(Math.log10(maximum))
  return [1,2,5,10].find(step => step*magnitude >= maximum)*magnitude
}
export function monthlyTrendCeiling(rows,{month,metric}) {
  const bounds = monthBounds(month), start = Date.parse(bounds.start), end = Date.parse(bounds.end)
  return trendCeiling(rows.filter(row => {
    const time = Date.parse(row.started_at)
    return trendHeroId(row.hero_id) !== null && time >= start && time < end
  }).map(row => ({value:trendValue(row,metric)})))
}
