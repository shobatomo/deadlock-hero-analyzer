import {createAggregatePool} from './feedback-store.js'
import {USAGE_EVENTS} from '../shared/usage.mjs'
export const USAGE_SQL = 'SELECT fyth_usage_private.increment_event($1) AS status'
export function createUsageStore(options = {}) {
 const pool = createAggregatePool(options)
 let pending = 0, tail = Promise.resolve()
 return {
  increment(event) {
   if (!USAGE_EVENTS.includes(event) || pending >= 4) return Promise.resolve({status:'not_stored'})
   pending++
   // Bounded queue; no identifiers, batch buffer or retry after uncertain writes.
   const operation = tail.then(async () => {
    const result = await pool.query({text:USAGE_SQL,values:[event],query_timeout:3000})
    if (result?.rows?.length !== 1 || !['stored','not_stored'].includes(result.rows[0]?.status)) throw new Error('Usage outcome unavailable')
    return {status:result.rows[0].status}
   })
   tail = operation.catch(() => {}).finally(() => { pending-- })
   return operation
  },
  close:() => pool.end(),
 }
}
export function createRuntimeUsage({env = process.env, Pool} = {}) {
 if (env.FYTH_USAGE_ENABLED !== 'true') return null
 try { return createUsageStore({connectionString:env.FYTH_FEEDBACK_DB_URL,ca:env.FYTH_FEEDBACK_DB_CA_CERT,Pool}) }
 catch { return null }
}
