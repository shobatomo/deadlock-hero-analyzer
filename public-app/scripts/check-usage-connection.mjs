// Explicit user-operated metadata probe. Never enables the public API.
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createUsageStore} from '../backend/usage-store.js'
export async function checkUsageConnection({env=process.env,Pool}={}) {
 if (env.FYTH_USAGE_ENABLED === 'true') return {status:'failed',code:'public_usage_must_remain_disabled'}
 let store
 try {
  store=createUsageStore({connectionString:env.FYTH_USAGE_DB_URL,ca:env.FYTH_USAGE_DB_CA_CERT,Pool})
  const result=await store.inspectConnection()
  return {...result,usage_collection_enabled:false,cron_verified:false,backup_verified:false}
 } catch {
  // Do not print URI, raw driver error, certificate content or input values.
  return {status:'failed',code:'usage_connection_check_failed'}
 } finally {
  try {await store?.close()} catch { /* No sensitive close-error logging. */ }
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await checkUsageConnection();console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1
}
