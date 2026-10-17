import {randomUUID} from 'node:crypto'
import {RecordError,safeRetrySeconds} from './provider.js'

// Durable admission across all instances. Works with transaction pooling.
// The 90s lease exceeds Vercel's 65s function limit. No session-level lock.
export function createSharedSyncGate(pool) {
  return {
    async acquire() {
      const token=randomUUID()
      try {
        const {rows}=await pool.query(`UPDATE deadhub_private.sync_gate SET
          lease_token=$1,lease_until=clock_timestamp()+interval '90 seconds'
          WHERE singleton=true AND (lease_until IS NULL OR lease_until<=clock_timestamp())
          AND retry_after<=clock_timestamp() RETURNING lease_token`,[token])
        if(rows.length)return token
        const state=await pool.query(`SELECT CASE WHEN retry_after='infinity'::timestamptz THEN null
          ELSE greatest(1,ceil(extract(epoch FROM
          (greatest(lease_until,retry_after)-clock_timestamp())))) END AS retry_seconds
          FROM deadhub_private.sync_gate WHERE singleton=true`)
        if(!state.rows.length)throw new Error('Missing shared gate')
        const wait=Number(state.rows[0].retry_seconds)
        if(state.rows[0].retry_seconds===null||!Number.isSafeInteger(wait)||wait<1)throw new RecordError('provider_paused',503,null)
        throw new RecordError('shared_busy',429,wait)
      } catch(error) {
        if(error instanceof RecordError)throw error
        throw new RecordError('shared_unavailable',503)
      }
    },
    async release(token,error) {
      const pause=error?.providerPause||['rate_limited','provider_paused'].includes(error?.code)
      const seconds=pause?safeRetrySeconds(error.retryAfter):0
      const wait=pause?(seconds===null?null:seconds*1000):2100
      try {
        const result=await pool.query(`UPDATE deadhub_private.sync_gate SET lease_token=null,lease_until=null,
          retry_after=CASE WHEN $2::bigint IS NULL THEN 'infinity'::timestamptz
            ELSE clock_timestamp()+($2::bigint * interval '1 millisecond') END
          WHERE singleton=true AND lease_token=$1 RETURNING singleton`,[token,wait])
        if(!result.rows.length)throw new Error('Shared lease lost')
      } catch {throw new RecordError('shared_unavailable',503)}
    },
  }
}
