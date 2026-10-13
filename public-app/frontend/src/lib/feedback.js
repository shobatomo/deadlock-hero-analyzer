import {validFeedback} from '../../../shared/feedback.mjs'
async function fetchWithTimeout(url, options = {}) {
 const controller = new AbortController()
 const timer = setTimeout(() => controller.abort(), 8000)
 try {
  const response = await fetch(url, {...options, signal:controller.signal, credentials:'omit', referrerPolicy:'no-referrer'})
  return {ok:response.ok, data:await response.json()}
 }
 finally { clearTimeout(timer) }
}
export async function feedbackAvailable() {
 try {
  const response = await fetchWithTimeout('/api/feedback', {cache:'no-store'})
  return response.ok && response.data.enabled === true
 } catch { return false }
}
export async function sendFeedback(choice) {
 if (!validFeedback({choice})) return {status:'not_stored', retryable:true}
 try {
  const response = await fetchWithTimeout('/api/feedback', {
   method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({choice}),
  })
  const data = response.data
  if (response.ok && data.status === 'stored') return {status:'stored'}
  if (!response.ok && data.status === 'not_stored') return {status:'not_stored', retryable:data.retryable === true}
 } catch { /* Transport failure does not prove the aggregate was not incremented. */ }
 return {status:'unknown', retryable:false}
}
