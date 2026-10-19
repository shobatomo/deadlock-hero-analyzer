// Fixed limits bound both the API response and chart/table rendering. Pages are
// explicit; the four preceding matches are calculation context, never skipped.
export const TREND_PAGE_SIZE = 200
export const TREND_HERO_LIMIT = 512
const integer = value => Number.isSafeInteger(value) && value >= 0
const positive = value => integer(value) && value > 0
const heroId = value => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const metric = value => value === null || typeof value === 'number' && Number.isFinite(value) && value >= 0
export function trendHistoryQuery(query = {}) {
  const hero = query.hero_id ?? null, page = query.page ?? '1'
  if (hero !== null && !heroId(hero) || typeof page !== 'string' || !/^[1-9]\d*$/.test(page) || !positive(Number(page)) || !integer((Number(page)-1)*TREND_PAGE_SIZE)) throw Error('Invalid trend query')
  return {heroId:hero,page:Number(page)}
}
export function trendHistory(value) {
  const fail = () => { throw Error('Invalid saved trend history') }
  if (!value || value.scope !== 'saved_all_time' || value.time_zone !== 'Asia/Tokyo' || !timestamp(value.observed_at)) fail()
  const {match_count:total,unknown_hero_count:unknown,heroes,hero_id:hero,page,page_size:size,offset,context_count:context,selected_count:selected,matches,maxima}=value
  if (!integer(total) || !integer(unknown) || unknown>total || !Array.isArray(heroes) || heroes.length>TREND_HERO_LIMIT) fail()
  const seen=new Set();let known=0
  for (const item of heroes) { if (!heroId(item.id) || !positive(item.count) || seen.has(item.id)) fail();seen.add(item.id);known+=item.count }
  if (!integer(known) || known+unknown !== total || !integer(selected) || selected !== (heroes.find(item=>item.id===hero)?.count ?? 0) || hero !== null && !heroId(hero) || hero === null && heroes.length) fail()
  if (!positive(page) || size!==TREND_PAGE_SIZE || offset!==(page-1)*size || !integer(offset) || page>Math.max(1,Math.ceil(selected/size)) || context!==Math.min(offset,4)) fail()
  if (!Array.isArray(matches) || matches.length!==context+Math.min(size,Math.max(0,selected-offset))) fail()
  const first=value.first_started_at,last=value.last_started_at
  if (total===0 ? first!==null || last!==null : !timestamp(first) || !timestamp(last) || Date.parse(first)>Date.parse(last)) fail()
  if (!maxima || ['kills','deaths','assists','damage_per_minute'].some(key=>!metric(maxima[key]))) fail()
  let previous=null
  for (const row of matches) {
    if (!row || typeof row.match_id!=='string' || !/^[1-9]\d{0,18}$/.test(row.match_id) || !timestamp(row.started_at) || String(row.hero_id)!==hero) fail()
    if (['kills','deaths','assists','hero_damage','duration_s'].some(key=>!metric(row[key]) || row[key]!==null && !Number.isInteger(row[key]))) fail()
    const time=Date.parse(row.started_at)
    if (time<Date.parse(first) || time>Date.parse(last) || previous && (time<Date.parse(previous.started_at) || time===Date.parse(previous.started_at) && BigInt(row.match_id)<=BigInt(previous.match_id))) fail()
    previous=row
  }
  return value
}
