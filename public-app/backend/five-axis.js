// Pure Node implementation of role-five-bounded-proxy-v3. No I/O or identity.
export const AXES={gank_pick:["敵を倒す場面への関わり",'kills','count_per_match'],farm_growth:["育ち方",'net_worth_per_min','per_min'],damage_output:["ダメージの出し方",'player_damage_per_min','per_min'],frontline:["前線での戦い方の目安",'frontline_proxy','proxy'],support_team:["味方との戦闘への関わり",'assists','count_per_match']}
const units={kills:'count_per_match',net_worth_per_min:'per_min',player_damage_per_min:'per_min',player_damage_taken_per_min:'per_min',deaths:'count_per_match',assists:'count_per_match'}
const front=['player_damage_taken_per_min','deaths','player_damage_per_min']
const number=v=>typeof v==='number'&&Number.isFinite(v)
const count=v=>Number.isSafeInteger(v)&&v>=0
const clip=v=>Math.max(0,Math.min(1,v))
export function anchored(v,lo,mid,hi){return [v,lo,mid,hi].every(number)&&lo<mid&&mid<hi?Math.max(-1,Math.min(1,v>=mid?(v-mid)/(hi-mid):(v-mid)/(mid-lo))):null}
export function relative(v,m){return number(v)&&v>=0&&m&&number(m.percentile5)&&m.percentile5>=0?anchored(v,m.percentile5,m.percentile50,m.percentile95):null}
export function frontline(values,metrics){
 if(front.some(f=>relative(values[f],metrics[f])===null)||metrics.player_damage_per_min.percentile50<=0)return null
 const base=v=>clip((v.player_damage_taken_per_min-metrics.player_damage_taken_per_min.percentile5)/(metrics.player_damage_taken_per_min.percentile95-metrics.player_damage_taken_per_min.percentile5))*(1-clip((v.deaths-metrics.deaths.percentile5)/(metrics.deaths.percentile95-metrics.deaths.percentile5)))*clip(v.player_damage_per_min/metrics.player_damage_per_min.percentile50)
 return anchored(base(values),0,base(Object.fromEntries(front.map(f=>[f,metrics[f].percentile50]))),1)
}
export function recommendRoles(players,populations,tops,{axes=AXES,minimumAxes=5,includeEvidence=false}={}){
 const result={formula_version:'role-five-bounded-proxy-v3',status:'withheld',recommendations:[],axes:[],coverage:0,reasons:[],excluded_heroes:{},experimental:true}
 if(!Array.isArray(players)||!players.length||!axes||!Object.keys(axes).length||!Number.isSafeInteger(minimumAxes)||minimumAxes<1){result.reasons=["プレイ記録か、比較項目の設定がありません。"];return result}
 const compatible=(r,f,u)=>r?.observation_unit==='player-hero-match'&&r?.aggregation==='mean_per_match_observation'&&r?.units?.[f]===u
 const value=(r,p,f,u)=>f==='frontline_proxy'?(front.every(k=>compatible(r,k,units[k])&&compatible(p,k,units[k]))?frontline(r.values??{},p.metrics??{}):null):(compatible(r,f,u)&&compatible(p,f,u)?relative(r.values?.[f],p.metrics?.[f]):null)
 const profile={}
 for(const [axis,[label,feature,unit]] of Object.entries(axes)){
  const samples=players.flatMap(p=>{if(!Number.isSafeInteger(p.n_matches)||p.n_matches<1)return [];const v=value(p,populations[p.hero_id],feature,unit);return v===null?[]:[[p.n_matches,v]]})
  profile[axis]=samples.length?samples.reduce((s,[n,v])=>s+n*v,0)/samples.reduce((s,[n])=>s+n,0):null
  result.axes.push({id:axis,label,player_relative:profile[axis],measured:!!samples.length,...(includeEvidence?{sample_count:samples.reduce((s,[n])=>s+n,0)}:{}),reason:samples.length?null:"同じ条件で比べられるプレイ記録と、全体の比較データが足りません。"})
 }
 const candidates={}
 for(const [hero,top] of Object.entries(tops)){
  const v={}
  for(const [axis,[,feature,unit]] of Object.entries(axes)){if(feature&&profile[axis]!==null){const r=value(top,populations[hero],feature,unit);if(r!==null&&number((r-profile[axis])**2))v[axis]=r}}
  if(Object.keys(v).length)candidates[hero]=v;else result.excluded_heroes[hero]="あなたの記録と、ALL・TOPの両方で比べられる項目がありません。"
 }
 const common=Object.keys(axes).filter(a=>Object.keys(candidates).length&&Object.values(candidates).every(v=>Object.hasOwn(v,a)))
 result.common_axes=common;result.coverage=common.length/Object.keys(axes).length
 if(common.length<minimumAxes){result.reasons=["共通して比べられる項目が足りません。測れない項目を0として扱うことはありません。"];return result}
 if(includeEvidence)result.used_matches=players.filter(p=>common.some(a=>value(p,populations[p.hero_id],axes[a][1],axes[a][2])!==null)).reduce((s,p)=>s+p.n_matches,0)
 for(const [hero,v] of Object.entries(candidates)){
  const gaps=common.map(a=>({axis:a,label:axes[a][0],player_relative:profile[a],top_relative:v[a],squared_gap:(profile[a]-v[a])**2}))
  result.recommendations.push({hero_id:hero,distance:Math.sqrt(gaps.reduce((s,g)=>s+g.squared_gap,0)/gaps.length),axis_gaps:gaps,coverage:result.coverage,reason:"同じヒーローの全体データで補正すると、あなたの記録と傾向が近い候補です。"})
 }
 result.recommendations.sort((a,b)=>a.distance-b.distance||(a.hero_id<b.hero_id?-1:a.hero_id>b.hero_id?1:0));result.recommendations=result.recommendations.slice(0,3);result.status='ready';return result
}
export function matchFeatures(row){
 const out=Object.fromEntries(Object.keys(units).map(f=>[f,null])),m=row.metadata?.provider_snapshot_maxima??{},final=row.metadata?.final_counts??{}
 if(row.metadata?.status!=='available')return out
 for(const [f,h] of [['kills','player_kills'],['deaths','player_deaths'],['assists','player_assists']]){const v=Object.hasOwn(final,f)?final[f]:row[h];if(count(v))out[f]=v}
 const duration=row.match_duration_s
 if(count(duration)&&duration>0){const mins=duration/60;const worth=Object.hasOwn(final,'net_worth')?final.net_worth:row.net_worth;if(count(worth))out.net_worth_per_min=worth/mins;for(const f of ['player_damage','player_damage_taken'])if(count(m[f]))out[f+'_per_min']=m[f]/mins}
 return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v===null||number(v)?v:null]))
}
export function roleDiagnosis(payload,{includeEvidence=false}={}){
 const contract={units,observation_unit:'player-hero-match',aggregation:'mean_per_match_observation'},players=[],populations={},tops={}
 for(const hero of [...new Set(payload.rows.map(r=>String(r.hero_id)))].sort()){
  const samples=payload.rows.filter(r=>String(r.hero_id)===hero&&r.metadata?.status==='available'&&r.game_mode===1&&[1,4].includes(r.match_mode)).map(matchFeatures),values={}
  for(const f of Object.keys(units))if(samples.length&&samples.every(s=>s[f]!==null))values[f]=samples.reduce((s,r)=>s+r[f],0)/samples.length
  if(samples.length)players.push({...contract,hero_id:hero,n_matches:samples.length,values})
 }
 for(const row of payload.groups){if(row.http_status!==200)continue;const hero=String(row.hero_id),declared=Object.fromEntries(['observation_unit','aggregation','units'].filter(k=>Object.hasOwn(row.source_context??{},k)).map(k=>[k,row.source_context[k]]));if(row.group==='population')populations[hero]={...contract,...declared,metrics:row.metrics??{}};else if(row.group==='top')tops[hero]={...contract,...declared,values:Object.fromEntries(Object.entries(row.metrics??{}).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>[k,v.avg]))}}
 const result=recommendRoles(players,populations,tops,{includeEvidence})
 result.warnings=["少数の試合をもとにした参考候補です。適性や勝率を保証するものではありません。","あなたの記録と比較データでは、対象期間や試合の区分が異なります。","前線での戦い方は、被ダメージ・死亡・与ダメージから推定しています。実際の位置や行動の意図は測っていません。"]
 return result
}
export function nodeDiagnosis(payload,{signal}={}){
 signal?.throwIfAborted()
 const five_axis=roleDiagnosis(payload,{includeEvidence:true})
 return {status:five_axis.status,recommendations:five_axis.recommendations,reasons:five_axis.reasons,experimental:true,input_state:payload.rows.length?'observed':'no_observations',future_inputs:['questionnaire'],five_axis}
}
