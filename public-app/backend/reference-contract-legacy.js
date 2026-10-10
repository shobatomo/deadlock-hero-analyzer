const features=['player_damage_per_min','player_damage_taken_per_min','accuracy','crit_shot_rate']
const finite=v=>typeof v==='number' && Number.isFinite(v) && v>=0
const exact=(obj,keys)=>obj && typeof obj==='object' && !Array.isArray(obj) && Object.keys(obj).every(k=>keys.includes(k))
export function validateGeneration(value){
 if(!exact(value,['config_key','context','manifest','groups']) || typeof value.config_key!=='string' || !value.config_key || value.config_key.length>200)throw new Error('Invalid snapshot')
 // Deliberately explicit fields: personal identifiers/history cannot enter the DB bundle.
 if(!exact(value.context,['period_start','period_end','game_mode','match_mode','min_duration_s','max_duration_s','min_badge','max_matches','formula_version','assets_version','units','aggregation']) || !value.context.formula_version || !value.context.assets_version || !value.context.units || !value.context.aggregation)throw new Error('Invalid context')
 const c=value.context
 if(!exact(c.units,features)||Object.keys(c.units).length!==4||!features.every(k=>c.units[k]===(k.includes('per_min')?'per_min':'ratio')))throw new Error('Invalid units')
 if(!['mean_per_match'].includes(c.aggregation)||![c.formula_version,c.assets_version].every(v=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,100}$/.test(v)))throw new Error('Invalid versions')
 if(![c.period_start,c.period_end,c.min_duration_s,c.max_duration_s,c.max_matches].every(Number.isSafeInteger)||c.period_start<0||c.period_end<=c.period_start||c.min_duration_s<0||c.max_duration_s<c.min_duration_s||c.max_matches<1)throw new Error('Invalid bounds')
 if(c.game_mode!=='normal'||!['pooled_ranked_unranked','mixed_reference_modes'].includes(c.match_mode)||!Number.isSafeInteger(c.min_badge)||c.min_badge<0)throw new Error('Invalid conditions')
 if(!Array.isArray(value.manifest)||!value.manifest.length||value.manifest.length>100||!Array.isArray(value.groups))throw new Error('Invalid manifest')
 const ids=new Set(), supported=[]
 for(const item of value.manifest){
  if(!exact(item,['hero_id','status','reason']) || !/^\d+$/.test(item.hero_id)||ids.has(item.hero_id)||!['supported','unsupported'].includes(item.status))throw new Error('Invalid manifest')
  ids.add(item.hero_id)
  if(item.status==='unsupported' && (typeof item.reason!=='string'||!item.reason.trim()||item.reason.length>500))throw new Error('Missing unsupported reason')
  if(item.status==='supported')supported.push(item.hero_id)
 }
 if(!supported.length||value.groups.length!==supported.length*2)throw new Error('Incomplete snapshot')
 const pairs=new Map()
 for(const group of value.groups){
  if(!exact(group,['hero_id','cohort','metrics','observed_at','n_matches','n_players','source_context']) || !supported.includes(group.hero_id)||!['all','top'].includes(group.cohort))throw new Error('Invalid group')
  if(!Number.isFinite(Date.parse(group.observed_at)) || ![group.n_matches,group.n_players].every(n=>n===null||Number.isSafeInteger(n)&&n>=0))throw new Error('Invalid provenance')
  const source=group.source_context
  if(c.match_mode==='mixed_reference_modes' && !source)throw new Error('Source conditions required')
  if(source){
   const fields=['period_start','period_end','game_mode','match_mode','duration_band','max_matches','patch']
   if(!exact(source,fields)||Object.keys(source).length!==fields.length||source.period_start!==c.period_start||source.period_end!==c.period_end||source.game_mode!=='normal'||!['ranked','unranked','ranked,unranked'].includes(source.match_mode)||source.max_matches!==c.max_matches||source.patch!=='unverified'||!Array.isArray(source.duration_band)||source.duration_band.length!==2||source.duration_band[0]!==c.min_duration_s||source.duration_band[1]!==c.max_duration_s)throw new Error('Invalid source conditions')
   if(c.match_mode==='pooled_ranked_unranked' && source.match_mode!=='ranked,unranked')throw new Error('Source mode mismatch')
  }
  const key=group.hero_id+':'+group.cohort;if(pairs.has(key))throw new Error('Duplicate group');pairs.set(key,group)
  if(!exact(group.metrics,features)||Object.keys(group.metrics).length!==4)throw new Error('Invalid metrics')
  for(const metric of Object.values(group.metrics)){
   const required=group.cohort==='all'?['avg','p5','p50','p95']:['avg']
   if(!exact(metric,required)||!required.every(k=>finite(metric[k])))throw new Error('Invalid metrics')
   if(group.cohort==='all' && !(metric.p5<=metric.p50&&metric.p50<=metric.p95&&metric.p95>metric.p5))throw new Error('Degenerate population')
  }
 }
 for(const id of supported)if(!pairs.has(id+':all')||!pairs.has(id+':top'))throw new Error('Incomplete pair')
 return value
}
