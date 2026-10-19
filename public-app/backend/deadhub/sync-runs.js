import {randomUUID} from 'node:crypto'
import {RecordError} from './provider.js'

export const SYNC_SOURCES=Object.freeze(['manual','registration','cron_endpoint'])
const skipped=new Set(['not_registered','busy','cooldown','shared_busy'])
const failures=new Set(['already_registered','provider_paused','shared_unavailable','rate_limited',
  'provider_timeout','provider_failed','invalid_provider','response_too_large','sync_failed','lease_lost'])
const processed=value=>Number.isSafeInteger(value)&&value>=0&&value<=2147483647?value:null
function completed(value) {
  const count=processed(value?.processed)
  if(count!==null&&value?.status==='success')return {outcome:'success',result_code:'complete',processed_count:count}
  if(count!==null&&value?.status==='partial')return {outcome:'partial',result_code:'page_limit',processed_count:count}
  return {outcome:'failed',result_code:'unexpected_result',processed_count:null}
}
function failed(error) {
  const code=error instanceof RecordError?error.code:null
  return {outcome:skipped.has(code)?'skipped':'failed',
    result_code:skipped.has(code)||failures.has(code)?code:'sync_failed',processed_count:null}
}

// Await the entire operation, including lease release, before recording success.
// Audit failures never change the existing synchronization result or retry rules.
export function createSyncRunRecorder({store,logger=code=>console.warn(code)}) {
  const warn=code=>{try{logger(code)}catch{/* Diagnostics must not affect synchronization. */}}
  return {
    async run(owner,source,operation,report=()=>{}) {
      if(!SYNC_SOURCES.includes(source))throw new TypeError('Invalid server sync source')
      let runId=null,terminal,recording='unavailable'
      try {
        const id=randomUUID()
        await store.startSyncRun(owner,id,source)
        runId=id
      } catch {warn('DEADHUB_SYNC_AUDIT_START_FAILED')}
      try {
        const value=await operation()
        terminal=completed(value)
        return value
      } catch(error) {
        terminal=failed(error)
        throw error
      } finally {
        if(runId)try {
          await store.finishSyncRun(owner,runId,terminal)
          recording='recorded'
        } catch {warn('DEADHUB_SYNC_AUDIT_FINISH_FAILED')}
        try{report(recording)}catch{/* Reporting cannot override the sync result. */}
      }
    },
    async snapshot(owner) {
      try{return {available:true,evidence:'recorded_attempts_only',cron_origin_verified:false,...await store.syncRunSnapshot(owner)}}
      catch {warn('DEADHUB_SYNC_AUDIT_READ_FAILED');return {available:false,evidence:'unavailable',cron_origin_verified:false,sources:null}}
    }
  }
}
