// Explicit user-operated metadata probe. Never enables the public API.
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createFeedbackStore} from '../backend/feedback-store.js'
export async function checkFeedbackConnection({env=process.env,Pool}={}) {
 if (env.FYTH_FEEDBACK_ENABLED === 'true') return {status:'failed',code:'public_feedback_must_remain_disabled'}
 let store
 try {
  store=createFeedbackStore({connectionString:env.FYTH_FEEDBACK_DB_URL,ca:env.FYTH_FEEDBACK_DB_CA_CERT,Pool})
  const result=await store.inspectConnection()
  return {...result,public_api_enabled:false,cron_verified:false,backup_verified:false}
 } catch {
  // Do not print URI, raw driver error, certificate content or input values.
  return {status:'failed',code:'feedback_connection_check_failed'}
 } finally {
  try {await store?.close()} catch { /* No sensitive close-error logging. */ }
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const result=await checkFeedbackConnection();console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1
}
