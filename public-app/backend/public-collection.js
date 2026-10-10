// Public acquisition: request-scoped personal projection; no filesystem or subprocess.
import {createHash} from 'node:crypto'
import {createRuntimeReferences} from './reference-runtime.js'
import {eligibleHeroes} from '../shared/heroes.mjs'
import {normalizeAccountId,validateDiagnosis} from '../shared/diagnosis.mjs'
import {projectOwnMetadata} from '../shared/own-metadata.mjs'
import {nodeDiagnosis} from './five-axis.js'
export const PUBLIC_LIMITS=Object.freeze({history:10,metadata:5,request_timeout_ms:12000,body_bytes:2000000,reference_requests:0})
class AcquisitionError extends Error{constructor(code,status=502){super(code);this.code=code;this.status=status}}
const integer=v=>Number.isSafeInteger(v)&&v>=0
const ownHeroIds=eligibleHeroes.map(h=>h.id)
const keys=['hero_id','start_time','game_mode','match_mode','match_duration_s','player_kills','player_deaths','player_assists','net_worth']
export function createPublicCollector({fetchImpl=fetch,runAnalysis=nodeDiagnosis,now=()=>Date.now(),readReferences=createRuntimeReferences({baselineVersion:'v2'}),cooldownMs=30000,maxActive=8}={}){
 if(!Number.isSafeInteger(cooldownMs)||cooldownMs<0||!Number.isSafeInteger(maxActive)||maxActive<1||typeof readReferences!=='function')throw Error('Invalid acquisition configuration')
 const active=new Set(),recent=new Map()
 async function request(url,signal){
  signal?.throwIfAborted();const linked=signal?AbortSignal.any([signal,AbortSignal.timeout(PUBLIC_LIMITS.request_timeout_ms)]):AbortSignal.timeout(PUBLIC_LIMITS.request_timeout_ms)
  try{
   const response=await fetchImpl(url,{signal:linked,redirect:'error'})
   if(response.status===429)throw new AcquisitionError('rate_limited',429)
   if(response.status===401||response.status===403)throw new AcquisitionError('access_denied',422)
   if(response.status===404)throw new AcquisitionError('unavailable',422)
   if(!response.ok)throw new AcquisitionError('provider_failed')
   let size=0;const chunks=[]
   for await(const chunk of response.body){size+=chunk.length;if(size>PUBLIC_LIMITS.body_bytes)throw new AcquisitionError('response_too_large');chunks.push(chunk)}
   linked.throwIfAborted();return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }catch(error){if(error instanceof AcquisitionError)throw error;if(linked.aborted)throw new AcquisitionError(signal?.aborted?'cancelled':'timeout',504);throw new AcquisitionError('provider_failed')}
 }
 async function references(signal){
  signal?.throwIfAborted();const value=await readReferences();signal?.throwIfAborted()
  if(!value)throw new AcquisitionError('reference_unavailable',503)
  return value
 }
 async function catalog(){return (await references()).coverage}
 async function collect(input,{signal}={}){
  const account=normalizeAccountId(input),token=createHash('sha256').update(account).digest('hex')
  if(active.has(token))throw new AcquisitionError('busy',409)
  for(const [key,expires] of recent)if(expires<=now())recent.delete(key)
  if(recent.has(token))throw new AcquisitionError('cooldown',429)
  if(active.size>=maxActive||recent.size>=256)throw new AcquisitionError('capacity',429)
  recent.set(token,now()+cooldownMs);active.add(token)
  try{
   const raw=await request('https://api.deadlock-api.com/v1/players/'+encodeURIComponent(account)+'/match-history?force_refetch=false',signal)
   if(!Array.isArray(raw))throw new AcquisitionError('invalid_history')
   const end=Math.floor(now()/1000),playerContext={period_start:end-30*86400,period_end:end,game_mode:'normal',match_mode:'ranked,unranked',duration_band:[900,7000],patch:'unverified'}
   const eligible=raw.filter(row=>String(row?.account_id)===account&&ownHeroIds.includes(String(row.hero_id))&&row.game_mode===1&&[1,4].includes(row.match_mode)&&integer(row.match_id)&&integer(row.start_time)&&row.start_time>=playerContext.period_start&&row.start_time<end&&integer(row.match_duration_s)&&row.match_duration_s>=900&&row.match_duration_s<=7000)
   const selected=[...new Map(eligible.map(row=>[row.match_id,row])).values()].sort((a,b)=>b.start_time-a.start_time).slice(0,PUBLIC_LIMITS.history)
   const rows=selected.map(row=>Object.fromEntries(keys.filter(k=>integer(row[k])).map(k=>[k,row[k]])))
   let metadataRequests=0,metadataFailures=0,metadataExcluded=0
   for(let i=0;i<Math.min(rows.length,PUBLIC_LIMITS.metadata);i++){
    signal?.throwIfAborted();metadataRequests++
    try{
     const payload=await request('https://api.deadlock-api.com/v1/matches/'+encodeURIComponent(String(selected[i].match_id))+'/metadata?disable_steam=true',signal)
     rows[i].metadata=projectOwnMetadata(payload,account,rows[i])
     if(rows[i].metadata.status!=='available')metadataExcluded++
    }catch(error){
     signal?.throwIfAborted()
     if(!['unavailable','provider_failed'].includes(error.code))throw error
     metadataFailures++
    }
   }
   if(metadataRequests&&metadataFailures===metadataRequests)throw new AcquisitionError('metadata_unavailable')
   const observed=rows.filter(row=>row.metadata?.status==='available'),reference=await references(signal)
   if(!reference.candidate_hero_ids.length)throw new AcquisitionError('reference_unavailable',503)
   const diagnosis=observed.length?await runAnalysis({candidate_hero_ids:reference.candidate_hero_ids,context:reference.context,groups:reference.groups,rows:observed,player_context:playerContext,observed_at:new Date(now()).toISOString()},{signal}):{status:'withheld',recommendations:[],reasons:['公開データに比較できる記録がありません。未プレイ・非公開・記録不足を区別できません。'],input_state:'no_observations',future_inputs:['questionnaire']}
   if(!validateDiagnosis(diagnosis))throw new AcquisitionError('analysis_failed')
   signal?.throwIfAborted()
   return {...diagnosis,candidate_coverage:reference.coverage,collection:{cache_status:'none',storage:'request-only',observed_at:new Date(now()).toISOString(),expires_at:null,limits:PUBLIC_LIMITS,history_retained:rows.length,metadata_requests:metadataRequests,metadata_failures:metadataFailures,metadata_excluded:metadataExcluded,analyzed_matches:observed.length,diagnosis_matches:diagnosis.status==='ready'?diagnosis.five_axis?.used_matches??0:0,candidates:reference.candidate_hero_ids,reference_requests:0,reference_stopped:null,provider:'https://api.deadlock-api.com',reference_source:reference.source,reference_stale:reference.stale??false,snapshot_id:reference.snapshot_id??null}}
  }finally{active.delete(token)}
 }
 return {read:async input=>{normalizeAccountId(input);return null},collect,catalog}
}
