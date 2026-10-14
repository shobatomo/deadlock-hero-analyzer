import pg from 'pg'
import {USAGE_EVENTS} from '../shared/usage.mjs'
export const USAGE_CHECK_SQL = `SELECT current_user AS current_role, session_user AS session_role,
 (SELECT rolconnlimit FROM pg_catalog.pg_roles WHERE rolname=current_user) AS connection_limit,
 pg_catalog.current_setting('transaction_isolation') AS isolation,
 pg_catalog.current_setting('statement_timeout') AS statement_timeout,
 pg_catalog.current_setting('lock_timeout') AS lock_timeout,
 pg_catalog.has_function_privilege(current_user,'fyth_usage_private.increment_event(text)','EXECUTE') AS can_increment,
 pg_catalog.has_function_privilege(current_user,'fyth_usage_private.expire_counts()','EXECUTE') AS can_expire,
 pg_catalog.has_table_privilege(current_user,'fyth_usage_private.daily_counts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS can_access_table,
 pg_catalog.has_schema_privilege(current_user,'fyth_usage_private','CREATE') AS can_create,
 pg_catalog.pg_has_role(current_user,'fyth_usage_owner','SET') AS can_set_owner,
 pg_catalog.pg_has_role(current_user,'fyth_usage_maintenance','SET') AS can_set_maintenance,
 pg_catalog.pg_has_role(current_user,'fyth_feedback_submitter','USAGE') AS can_submit_feedback`
export const USAGE_SQL = 'SELECT fyth_usage_private.increment_event($1) AS status'
export function createUsageStore(options = {}) {
 const {connectionString,ca,Pool=pg.Pool}=options
 let url
 try { url=new URL(connectionString) } catch { throw new Error('Usage configuration unavailable') }
 const login='fyth_usage_app_login',ref='adxoqjgmhmortztqngcz'
 const username=decodeURIComponent(url.username)
 const direct=url.hostname===`db.${ref}.supabase.co` && username===login
 const pooled=url.hostname.endsWith('.pooler.supabase.com') && username===`${login}.${ref}`
 if (!['postgres:','postgresql:'].includes(url.protocol) || (!direct && !pooled) || !url.password || url.pathname!=='/postgres') throw new Error('Usage configuration unavailable')
 for (const key of [...url.searchParams.keys()])url.searchParams.delete(key)
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:1,
  connectionTimeoutMillis:1000,idleTimeoutMillis:1000,query_timeout:1000,statement_timeout:800,lock_timeout:100,
  application_name:'fyth-usage',options:'-c default_transaction_isolation=read\\ committed'})
 pool.on?.('error',()=>{})
 let pending = 0, tail = Promise.resolve()
 return {
  increment(event) {
   if (!USAGE_EVENTS.includes(event) || pending >= 4) return Promise.resolve({status:'not_stored'})
   pending++
   // Bounded queue; no identifiers, batch buffer or retry after uncertain writes.
   const operation = tail.then(async () => {
    const result = await pool.query({text:USAGE_SQL,values:[event],query_timeout:1000})
    if (result?.rows?.length !== 1 || !['stored','not_stored'].includes(result.rows[0]?.status)) throw new Error('Usage outcome unavailable')
    return {status:result.rows[0].status}
   })
   tail = operation.catch(() => {}).finally(() => { pending-- })
   return operation
  },
  async inspectConnection() {
   const result=await pool.query({text:USAGE_CHECK_SQL,query_timeout:1000}),row=result?.rows?.[0]
   const ms=value=>{const m=/^(\d+)(ms|s)$/.exec(value??'');return m?Number(m[1])*(m[2]==='s'?1000:1):NaN}
   if(result?.rows?.length!==1 || row.current_role!==login || row.session_role!==login || row.connection_limit!==1
    || row.isolation!=='read committed' || !(ms(row.statement_timeout)>0&&ms(row.statement_timeout)<=800)
    || !(ms(row.lock_timeout)>0&&ms(row.lock_timeout)<=100) || row.can_increment!==true
    || ['can_expire','can_access_table','can_create','can_set_owner','can_set_maintenance','can_submit_feedback'].some(k=>row[k]!==false))throw new Error('Usage role boundary unavailable')
   return {status:'passed',metadata_only:true,writes:0}
  },
  close:() => pool.end(),
 }
}
export function createRuntimeUsage({env = process.env, Pool} = {}) {
 if (env.FYTH_USAGE_ENABLED !== 'true') return null
 try {
  const connectionString=env.FYTH_USAGE_DB_URL,ca=env.FYTH_USAGE_DB_CA_CERT
  if(typeof connectionString!=='string'||!connectionString.trim()||typeof ca!=='string'||!ca.trim())return null
  return createUsageStore({connectionString,ca,Pool})
 }
 catch { return null }
}
