// Only stored bulk metadata. No match_ids (which queues parsing), Steam fallback,
// analytics, replay requests, or raw response logging/persistence.
export const PROVIDER_LIMITS = Object.freeze({pageSize:30, pages:3, timeoutMs:12000, bodyBytes:2000000})
export class RecordError extends Error {
  constructor(code, status=502, retryAfter=60) { super(code); this.code=code; this.status=status; this.retryAfter=retryAfter }
}
const uint = value => {
  const n = typeof value==='string' && /^\d+$/.test(value) ? Number(value) : value
  return Number.isSafeInteger(n) && n>=0 ? n : null
}
const team = value => value===0 || value==='Team0' ? 0 : value===1 || value==='Team1' ? 1 : null
export function providerTime(value) {
  // ClickHouse emits UTC DateTime as YYYY-MM-DD HH:mm:ss; epoch is also supported.
  if (uint(value)!==null) return new Date(uint(value)*1000).toISOString()
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:Z|\+00:00)?$/.test(value)) throw new RecordError('invalid_provider')
  const normalized=value.replace(' ','T'), date=new Date(/Z|\+00:00$/.test(normalized)?normalized:normalized+'Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,19)!==normalized.slice(0,19)) throw new RecordError('invalid_provider')
  return date.toISOString()
}
export function projectRecord(raw, accountId, from, until) {
  const match=uint(raw?.match_id)
  if (!match) throw new RecordError('invalid_provider')
  const started_at=providerTime(raw.start_time), time=new Date(started_at).getTime()
  if (time<new Date(from).getTime() || time>=new Date(until).getTime()) throw new RecordError('invalid_provider')
  const players=Array.isArray(raw.players)?raw.players.filter(p=>String(p.account_id)===String(accountId)):[]
  if (players.length!==1) throw new RecordError('invalid_provider')
  const p=players[0], winner=team(raw.winning_team), own=team(p.team)
  const decided=raw.match_outcome==='TeamWin' || raw.match_outcome===0
  return {match_id:String(match), started_at, hero_id:uint(p.hero_id),
    won:decided && winner!==null && own!==null ? winner===own : null,
    kills:uint(p.kills), deaths:uint(p.deaths), assists:uint(p.assists),
    hero_damage:uint(p.final_stats?.player_damage), duration_s:uint(raw.duration_s)}
}
export function createRecordProvider({fetchImpl=fetch}={}) {
  return {async page({accountId, from, until, cursor}, signal) {
    const url=new URL('https://api.deadlock-api.com/v1/matches/metadata')
    const params={account_ids:accountId,only_filtered_players:'true',match_mode:'ranked,unranked',
      include_info:'true',include_player_kda:'true',include_player_final_stats:'true',
      min_unix_timestamp:String(Math.floor(new Date(from).getTime()/1000)),
      max_unix_timestamp:String(Math.floor(new Date(until).getTime()/1000)-1),
      order_by:'match_id',order_direction:'desc',limit:String(PROVIDER_LIMITS.pageSize)}
    if (cursor!==null) params.max_match_id=String(cursor)
    url.search=new URLSearchParams(params).toString()
    const linked=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(PROVIDER_LIMITS.timeoutMs)])
    try {
      const response=await fetchImpl(url,{signal:linked,redirect:'error'})
      if (!response.ok) {
        const retry=Number(response.headers.get('retry-after'))
        throw new RecordError(response.status===429?'rate_limited':'provider_failed',502,
          Number.isFinite(retry)&&retry>0?Math.min(86400,Math.ceil(retry)):60)
      }
      const chunks=[];let size=0
      for await (const chunk of response.body) { size+=chunk.length; if(size>PROVIDER_LIMITS.bodyBytes) throw new RecordError('response_too_large'); chunks.push(chunk) }
      linked.throwIfAborted()
      const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!Array.isArray(raw) || raw.length>PROVIDER_LIMITS.pageSize) throw new RecordError('invalid_provider')
      const records=raw.map(row=>projectRecord(row,accountId,from,until))
      const ids=records.map(r=>Number(r.match_id))
      if (ids.some((id,i)=>(cursor!==null && id>Number(cursor)) || (i>0 && id>=ids[i-1]))) throw new RecordError('invalid_provider')
      return {records, done:raw.length<PROVIDER_LIMITS.pageSize,
        cursor:records.length ? String(Number(records.at(-1).match_id)-1) : cursor}
    } catch (error) {
      if (error instanceof RecordError) throw error
      throw new RecordError(linked.aborted?'provider_timeout':'provider_failed')
    }
  }}
}
