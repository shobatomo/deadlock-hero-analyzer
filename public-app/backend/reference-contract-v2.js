// Pure v2 metric contract plus full provenance validation; runtime uses explicit version dispatch.
import {validateGeneration as validateLegacy} from './reference-contract-legacy.js'
export const BASELINE_VERSION='observed-metrics-29-v2'
export const ROLE_FORMULA_VERSION='role-five-bounded-proxy-v3'
export const METRIC_UNITS=Object.freeze(Object.fromEntries([
 ['count_per_match',['kills','deaths','assists','denies','last_hits','kills_plus_assists']],
 ['provider_net_worth',['net_worth']],['per_min',['net_worth_per_min','player_damage_per_min','player_damage_taken_per_min','neutral_damage_per_min','boss_damage_per_min','self_healing_per_min','player_healing_per_min','healing_per_min']],
 ['ratio',['accuracy','crit_shot_rate','kd','kda','player_damage_per_health']],
 ['provider_counter',['player_damage','neutral_damage','boss_damage','self_healing','player_healing','healing','teammate_healing','teammate_barriering','heal_prevented']]
].flatMap(([unit,names])=>names.map(name=>[name,unit]))))
const finite=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k))
export function projectExpandedReference(raw,{heroId,cohort}={}){
 if(!/^\d+$/.test(heroId)||!['all','top'].includes(cohort))throw Error('invalid reference identity')
 const metrics={}
 for(const key of Object.keys(METRIC_UNITS)){
  const m=raw?.[key]
  if(!m||!finite(m.avg)){metrics[key]={status:'missing',value:null};continue}
  if(cohort==='top'){metrics[key]={status:'available',value:{avg:m.avg}};continue}
  const p=[m.percentile5,m.percentile50,m.percentile95]
  if(!p.every(finite)||p[0]>p[1]||p[1]>p[2]){metrics[key]={status:'missing',value:null};continue}
  metrics[key]={status:p[2]===p[0]?'degenerate':'available',value:{avg:m.avg,p5:p[0],p50:p[1],p95:p[2]}}
 }
 return {hero_id:heroId,cohort,metrics}
}
export function validateExpandedSnapshot(snapshot,{expectedFormula=ROLE_FORMULA_VERSION}={}){
 if(snapshot?.context?.baseline_version!==BASELINE_VERSION||snapshot.context.formula_version!==expectedFormula||snapshot.context.observation_unit!=='player-hero-match'||snapshot.context.aggregation!=='mean_per_match_observation'||!exact(snapshot.context.units,Object.keys(METRIC_UNITS))||Object.entries(METRIC_UNITS).some(([k,u])=>snapshot.context.units[k]!==u))throw Error('version or unit contract mismatch')
 if(!Array.isArray(snapshot.manifest)||!snapshot.manifest.length||snapshot.manifest.length>100||!Array.isArray(snapshot.groups))throw Error('invalid manifest')
 const ids=new Set();const supported=[]
 for(const h of snapshot.manifest){if(!/^\d+$/.test(h.hero_id)||ids.has(h.hero_id)||!['supported','unsupported'].includes(h.status))throw Error('invalid manifest');ids.add(h.hero_id);if(h.status==='supported')supported.push(h.hero_id);else if(typeof h.reason!=='string'||!h.reason.trim())throw Error('unsupported reason required')}
 if(!supported.length||snapshot.groups.length!==supported.length*2)throw Error('incomplete pairs')
 const pairs=new Set()
 for(const g of snapshot.groups){
  const pair=g.hero_id+':'+g.cohort
  if(!supported.includes(g.hero_id)||!['all','top'].includes(g.cohort)||pairs.has(pair)||!exact(g.metrics,Object.keys(METRIC_UNITS)))throw Error('invalid group');pairs.add(pair)
  for(const m of Object.values(g.metrics)){
   if(!exact(m,['status','value'])||!['missing','degenerate','available'].includes(m.status))throw Error('invalid availability')
   if(m.status==='missing'){if(m.value!==null)throw Error('missing is not zero');continue}
   const keys=g.cohort==='all'?['avg','p5','p50','p95']:['avg']
   if(!exact(m.value,keys)||!keys.every(k=>finite(m.value[k])))throw Error('invalid metric')
   if(g.cohort==='top'&&m.status!=='available')throw Error('top cannot assert population degeneration')
   if(g.cohort==='all'&&(m.value.p5>m.value.p50||m.value.p50>m.value.p95||(m.status==='degenerate')!==(m.value.p5===m.value.p95)))throw Error('invalid distribution')
  }
 }
 return snapshot
}
export function validateSnapshotVersion(snapshot){return snapshot?.context?.baseline_version===BASELINE_VERSION?validateExpandedGeneration(snapshot):validateLegacy(snapshot)}
export function assertStagingEdit(snapshot){if(snapshot?.status!=='staging')throw Error('published snapshot is immutable')}

// V2 reader projection; missing stays absent, degenerate intervals remain visible.
export function expandedGroupsForAnalysis(snapshot){
 validateExpandedSnapshot(snapshot)
 return snapshot.groups.map(row=>({hero_id:row.hero_id,group:row.cohort==='all'?'population':'top',http_status:200,
  source_context:{units:snapshot.context.units,observation_unit:snapshot.context.observation_unit,aggregation:snapshot.context.aggregation},
  metrics:Object.fromEntries(Object.entries(row.metrics).filter(([,m])=>m.status!=='missing').map(([key,m])=>[key,Object.fromEntries(Object.entries(m.value).map(([k,v])=>[k==='p5'?'percentile5':k==='p50'?'percentile50':k==='p95'?'percentile95':k,v]))]))}))
}

export function validateExpandedGeneration(snapshot){
 validateExpandedSnapshot(snapshot)
 const context={...snapshot.context};delete context.baseline_version;delete context.observation_unit
 context.units={player_damage_per_min:'per_min',player_damage_taken_per_min:'per_min',accuracy:'ratio',crit_shot_rate:'ratio'};context.aggregation='mean_per_match'
 const keys=Object.keys(context.units)
 const envelope={...snapshot,context,groups:snapshot.groups.map(g=>({...g,metrics:Object.fromEntries(keys.map(k=>[k,g.cohort==='all'?{avg:0,p5:0,p50:0,p95:1}:{avg:0}]))}))}
 validateLegacy(envelope)
 // Unlike legacy, v2 requires explicit source conditions for every row.
 if(snapshot.groups.some(g=>!g.source_context))throw Error('v2 source conditions required')
 return snapshot
}
