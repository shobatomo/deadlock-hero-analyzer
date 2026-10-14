import pg from 'pg'
import {FEEDBACK_CHOICES} from '../shared/feedback.mjs'
const projectRef = 'adxoqjgmhmortztqngcz'
const login = 'fyth_feedback_app_login'
export const INCREMENT_SQL = 'SELECT fyth_feedback_private.increment_choice($1) AS status'
export const CONNECTION_CHECK_SQL = `SELECT
 current_user AS current_role, session_user AS session_role,
 current_setting('transaction_isolation') AS isolation,
 current_setting('statement_timeout') AS statement_timeout,
 current_setting('lock_timeout') AS lock_timeout,
 has_function_privilege(current_user,'fyth_feedback_private.increment_choice(text)','EXECUTE') AS can_increment,
 has_function_privilege(current_user,'fyth_feedback_private.expire_counts()','EXECUTE') AS can_expire,
 has_table_privilege(current_user,'fyth_feedback_private.daily_counts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS can_access_table,
 has_schema_privilege(current_user,'fyth_feedback_private','CREATE') AS can_create,
 pg_has_role(current_user,'fyth_feedback_owner','SET') AS can_set_owner,
 pg_has_role(current_user,'fyth_feedback_maintenance','SET') AS can_set_maintenance`
const timeoutMs = value => {
 const match = /^(\d+)(ms|s|min)$/.exec(value ?? '')
 return match ? Number(match[1]) * ({ms:1,s:1000,min:60000}[match[2]]) : NaN
}
// A separate bounded connection; never modifies or reuses the reference reader.
export function createAggregatePool({connectionString, ca, Pool = pg.Pool} = {}) {
 let url
 try { url = new URL(connectionString) } catch { throw new Error('Feedback configuration unavailable') }
 const username = decodeURIComponent(url.username)
 const direct = url.hostname === `db.${projectRef}.supabase.co` && username === login
 const pooled = url.hostname.endsWith('.pooler.supabase.com') && username === `${login}.${projectRef}`
 if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooled) || !url.password || url.pathname !== '/postgres') throw new Error('Feedback configuration unavailable')
 // URI flags must not override explicit certificate verification or session defaults.
 for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key)
 const pool = new Pool({connectionString:url.toString(), ssl:{rejectUnauthorized:true, ...(ca ? {ca} : {})},
  max:1, connectionTimeoutMillis:2000, idleTimeoutMillis:10000, query_timeout:3000,
  statement_timeout:2000, lock_timeout:500, application_name:'fyth-feedback',
  options:'-c default_transaction_isolation=read\\ committed',
 })
 pool.on?.('error', () => {})
 return pool
}
export function createFeedbackStore(options = {}) {
 const pool = createAggregatePool(options)
 return {
  async increment(choice) {
   if (!FEEDBACK_CHOICES.includes(choice)) return {status:'not_stored'}
   // Exactly one autocommit statement. Never BEGIN/SET ROLE, raw SQL or auto-retry.
   // pg's query promise must complete; a row alone is not treated as a commit receipt.
   const result = await pool.query({text:INCREMENT_SQL, values:[choice], query_timeout:3000})
   if (result?.rows?.length !== 1 || !['stored', 'not_stored'].includes(result.rows[0]?.status)) throw new Error('Feedback outcome unavailable')
   return {status:result.rows[0].status}
  },
  async inspectConnection() {
   // Explicit owner-operated probe, never called by the public API or runtime gate.
   // No count rows, increment/expiry calls, credentials or job catalog are selected.
   const result = await pool.query({text:CONNECTION_CHECK_SQL, query_timeout:3000})
   const row = result?.rows?.[0]
   const statement = timeoutMs(row?.statement_timeout), lock = timeoutMs(row?.lock_timeout)
   if (result?.rows?.length !== 1 || row.current_role !== login || row.session_role !== login
    || row.isolation !== 'read committed' || !(statement > 0 && statement <= 2000)
    || !(lock > 0 && lock <= 500) || row.can_increment !== true
    || ['can_expire','can_access_table','can_create','can_set_owner','can_set_maintenance'].some(key => row[key] !== false)) throw new Error('Feedback role boundary unavailable')
   return {status:'passed', metadata_only:true, writes:0}
  },
  close:() => pool.end(),
 }
}
// Opt in only after SQL, retention job and user-managed credentials are ready.
// Disabled mode does not inspect DB connection values or create a pool.
export function createRuntimeFeedback({env = process.env, Pool = pg.Pool} = {}) {
 if (env.FYTH_FEEDBACK_ENABLED !== 'true') return null
 try { return createFeedbackStore({connectionString:env.FYTH_FEEDBACK_DB_URL, ca:env.FYTH_FEEDBACK_DB_CA_CERT, Pool}) }
 catch { return null }
}
