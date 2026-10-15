import {RecordError,PROVIDER_LIMITS} from './provider.js'
// Every page is committed with its cursor. Timeout, restart or overlap is safe.
export function createRecordSync({store,provider,delay=ms=>new Promise(r=>setTimeout(r,ms))}) {
  return async function sync(owner) {
    const lease=await store.acquire(owner), signal=AbortSignal.timeout(45000)
    let count=0
    try {
      for(let i=0;i<PROVIDER_LIMITS.pages;i++) {
        signal.throwIfAborted()
        if(i) await delay(2100) // Bulk API: 30 requests/min/IP; never parallel.
        const page=await provider.page(lease,signal)
        await store.savePage(owner,lease,page);count+=page.records.length
        if (page.done) return {status:'success',processed:count}
        lease.cursor=page.cursor
      }
      await store.finishPartial(owner,lease.token)
      return {status:'partial',processed:count}
    } catch (error) {
      const safe=error instanceof RecordError?error:new RecordError(signal.aborted?'provider_timeout':'sync_failed')
      await store.fail(owner,lease.token,safe.code,safe.retryAfter)
      throw safe
    }
  }
}
