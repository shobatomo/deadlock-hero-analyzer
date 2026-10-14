import {USAGE_EVENTS} from '../shared/usage.mjs'
// Request-scoped booleans only. Never pass request, body, header or identity to sink.
export function beginUsage(res, {store, keepAlive = () => {}} = {}) {
 if (typeof store?.increment !== 'function') return {outcome:() => {}}
 let terminal = false, outcome = 'diagnosis_error'
 const emit = event => {
  if (!USAGE_EVENTS.includes(event)) return
  const operation = Promise.resolve().then(() => store.increment(event)).catch(() => {})
  try { keepAlive(operation) } catch { /* Metrics never changes diagnosis. */ }
 }
 let resolveTerminal
 const terminalEvent = new Promise(resolve => { resolveTerminal = resolve })
 const terminalWrite = terminalEvent.then(event => store.increment(event)).catch(() => {})
 try { keepAlive(terminalWrite) } catch { /* No lifecycle context in local harness. */ }
 const finish = () => end(outcome)
 const close = () => end(res.writableFinished ? outcome : 'diagnosis_disconnected')
 function end(event) {
  if (terminal) return
  terminal = true
  res.off('finish',finish); res.off('close',close)
  resolveTerminal(event)
 }
 res.once('finish',finish); res.once('close',close)
 emit('diagnosis_requested')
 return {outcome(value) { if (['diagnosis_ready','diagnosis_withheld','diagnosis_error'].includes(value)) outcome = value }}
}
