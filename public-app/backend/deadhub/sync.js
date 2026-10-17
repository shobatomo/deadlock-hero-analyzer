import {RecordError,PROVIDER_LIMITS} from './provider.js'
// Every page is committed with its cursor. Timeout, restart or overlap is safe.
export function createRecordSync({store,provider,gate=null,delay=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now()}) {
  return async function sync(owner) {
    const started=now(),signal=AbortSignal.timeout(45000)
    const shared=gate?await gate.acquire():null
    let lease,count=0,failure
    const checkTime=()=>{signal.throwIfAborted();if(now()-started>=45000)throw new RecordError('provider_timeout')}
    try {
      checkTime()
      lease=await store.acquire(owner)
      for(let i=0;i<PROVIDER_LIMITS.pages;i++) {
        checkTime()
        if(i) await delay(2100) // Bulk API: 30 requests/min/IP; never parallel.
        checkTime()
        const page=await provider.page(lease,signal)
        await store.savePage(owner,lease,page);count+=page.records.length
        if (page.done) return {status:'success',processed:count}
        lease.cursor=page.cursor
      }
      await store.finishPartial(owner,lease.token)
      return {status:'partial',processed:count}
    } catch (error) {
      const safe=error instanceof RecordError?error:new RecordError(signal.aborted?'provider_timeout':'sync_failed')
      failure=safe
      if(lease)await store.fail(owner,lease.token,safe.code,safe.retryAfter)
      throw safe
    } finally {
      if(shared)await gate.release(shared,failure)
    }
  }
}
