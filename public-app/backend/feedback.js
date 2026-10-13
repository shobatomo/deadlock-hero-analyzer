import {validFeedback} from '../shared/feedback.mjs'
// No environment credentials or production writer. Inject only a reviewed aggregate sink.
// stored: committed; not_stored: guaranteed no commit; throws/other: outcome unknown.
export function addFeedbackRoutes(app, {feedbackStore = null, feedbackTimeoutMs = 5000, feedbackLimits = {}} = {}) {
 const {maxRequests = 30, windowMs = 60000, maxConcurrent = 2, now = () => performance.now()} = feedbackLimits
 if (![maxRequests, windowMs, maxConcurrent].every(value => Number.isFinite(value) && value > 0) || typeof now !== 'function') throw new Error('Invalid feedback limits')
 let windowStart = now(), attempts = 0, inFlight = 0
 const enabled = typeof feedbackStore?.increment === 'function'
 app.get('/api/feedback', (req, res) => res.json({enabled}))
 app.post('/api/feedback', async (req, res) => {
  if (!req.is('application/json') || !validFeedback(req.body))
   return res.status(400).json({status:'not_stored', retryable:true})
  const origin = req.get('origin')
  let foreignOrigin = false
  if (origin) { try { foreignOrigin = new URL(origin).host !== req.get('host') } catch { foreignOrigin = true } }
  if (req.get('sec-fetch-site') === 'cross-site' || foreignOrigin)
   return res.status(403).json({status:'not_stored', retryable:false})
  if (!enabled) return res.status(503).json({status:'not_stored', retryable:true})
  const timestamp = now()
  if (timestamp - windowStart >= windowMs) { windowStart = timestamp; attempts = 0 }
  // Process-wide anonymous guard, no IP/account/cookie records. Not a distributed quota.
  if (attempts >= maxRequests || inFlight >= maxConcurrent) {
   res.set('Retry-After', String(Math.max(1, Math.ceil((windowMs - (timestamp - windowStart)) / 1000))))
   return res.status(429).json({status:'not_stored', retryable:true})
  }
  attempts++; inFlight++
  // Keep capacity reserved after timeout until the underlying write actually settles.
  const operation = Promise.resolve().then(() => feedbackStore.increment(req.body.choice))
  operation.then(() => { inFlight-- }, () => { inFlight-- })
  let timer
  try {
   const result = await Promise.race([
    operation,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), feedbackTimeoutMs) }),
   ])
   if (result?.status === 'stored') return res.json({status:'stored'})
   if (result?.status === 'not_stored') return res.status(503).json({status:'not_stored', retryable:true})
   throw new Error('unknown outcome')
  } catch {
   // A lost acknowledgement might follow a commit; automatic retries would double count.
   return res.status(502).json({status:'unknown', retryable:false})
  } finally { clearTimeout(timer) }
 })
}
