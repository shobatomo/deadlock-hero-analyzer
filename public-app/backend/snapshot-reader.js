import {readFile} from 'node:fs/promises'
import {validateSnapshotVersion,expandedGroupsForAnalysis,BASELINE_VERSION} from './reference-contract-v2.js'
import {heroName,manifest as assets} from '../shared/heroes.mjs'
import {REFERENCE_CONFIG} from '../shared/reference-config.mjs'
export {REFERENCE_CONFIG}
const fallbackUrl=new URL('../shared/reference-bootstrap.json',import.meta.url)
export async function readBootstrap(){return JSON.parse(await readFile(fallbackUrl,'utf8'))}
export function snapshotForAnalysis(snapshot,{source,now=Date.now()}={}){
 validateSnapshotVersion({config_key:snapshot.config_key,context:snapshot.context,manifest:snapshot.manifest,groups:snapshot.groups})
 const groups=snapshot.context.baseline_version===BASELINE_VERSION?expandedGroupsForAnalysis(snapshot).map((g,i)=>({...g,source_context:{...snapshot.groups[i].source_context,...g.source_context}})):snapshot.groups.map(row=>({...row,group:row.cohort==='all'?'population':'top',http_status:200,metrics:Object.fromEntries(Object.entries(row.metrics).map(([key,m])=>[key,Object.fromEntries(Object.entries(m).map(([k,v])=>[k.startsWith('p')?'percentile'+k.slice(1):k,v]))]))}))
 const latest=Math.max(...snapshot.groups.map(g=>Date.parse(g.observed_at))),stale=now-latest>=86400000||now<latest
 const coverage={assets_observed_at:assets.assets_observed_at,eligible_count:snapshot.manifest.length,supported_count:snapshot.manifest.filter(h=>h.status==='supported').length,reference_source:source,reference_stale:stale,snapshot_id:snapshot.id??'local-bootstrap',heroes:snapshot.manifest.map(h=>({id:h.hero_id,name:heroName(h.hero_id),status:h.status,reason:h.reason??null,reference_updated_at:snapshot.groups.find(g=>g.hero_id===h.hero_id)?.observed_at??null}))}
 const c=snapshot.context
 return {context:{period_start:c.period_start,period_end:c.period_end,game_mode:c.game_mode,match_mode:'ranked,unranked',duration_band:[c.min_duration_s,c.max_duration_s],max_matches:c.max_matches,patch:'unverified'},groups,candidate_hero_ids:snapshot.manifest.filter(h=>h.status==='supported').map(h=>h.hero_id),coverage,requests:0,stopped:null,source,stale,snapshot_id:coverage.snapshot_id}
}
export function createSnapshotReader({store,readFallback=readBootstrap,now=()=>Date.now(),configKey=REFERENCE_CONFIG}={}){
 return async()=>{
  if(store)try{const row=await store.readActiveSnapshot(configKey);if(row)return snapshotForAnalysis(row,{source:'database',now:now()})}catch{/* sanitized local fallback, no external API */}
  try{return snapshotForAnalysis(await readFallback(),{source:store?'local-fallback':'local-bootstrap',now:now()})}catch{return null}
 }
}
