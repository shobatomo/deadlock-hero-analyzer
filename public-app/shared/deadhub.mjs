export const TIME_ZONE = 'Asia/Tokyo'
export const DAY_MS = 86400000
export const RECORD_FIELDS = ['hero_id', 'won', 'kills', 'deaths', 'assists', 'hero_damage', 'duration_s']
export function tokyoDay(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date')
  return new Intl.DateTimeFormat('sv-SE', {timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(date)
}
export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || +month.slice(0,4) < 2020 || +month.slice(0,4) > 2100) throw new Error('Invalid month')
  const start = new Date(`${month}-01T00:00:00+09:00`)
  const [year, index] = month.split('-').map(Number)
  const end = new Date(Date.UTC(year, index, 1) - 9*3600000)
  return {start:start.toISOString(), end:end.toISOString()}
}
export function shiftMonth(month, step) {
  monthBounds(month)
  const [year, index] = month.split('-').map(Number)
  return new Date(Date.UTC(year, index-1+step, 1)).toISOString().slice(0,7)
}
export function sumKnown(rows, field) {
  const known = rows.filter(row => row[field] !== null && row[field] !== undefined)
  return {value:known.length ? known.reduce((sum,row) => sum + row[field],0) : null, known:known.length, total:rows.length}
}
export function daySummary(rows) {
  return {count:rows.length, wins:rows.filter(r=>r.won===true).length, losses:rows.filter(r=>r.won===false).length,
    unknown:rows.filter(r=>r.won==null).length, ...Object.fromEntries(['kills','deaths','assists','hero_damage'].map(f=>[f,sumKnown(rows,f)]))}
}
export function dayState(day, rows, account) {
  if (rows.some(row=>tokyoDay(row.started_at)===day)) return 'recorded'
  if (!account) return 'unsynced'
  if (account.sync_status==='running' && !account.last_success_at) return 'initial'
  if (account.sync_status==='error') return 'failed'
  const start = new Date(`${day}T00:00:00+09:00`).getTime(), end=start+DAY_MS
  // Only whole days inside a completed query range may be labelled queried-empty.
  if (account.coverage_from && account.coverage_until && new Date(account.coverage_from).getTime()<=start && new Date(account.coverage_until).getTime()>=end) return 'empty'
  return 'unsynced'
}
