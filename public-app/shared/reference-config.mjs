// Anonymous collection conditions only; daily UTC window is computed by the runner.
export const REFERENCE_CONFIG='four-axis-bootstrap-2026-10-08'
export const REFERENCE_CONTEXT=Object.freeze({
  "game_mode": "normal",
  "match_mode": "pooled_ranked_unranked",
  "min_duration_s": 900,
  "max_duration_s": 7000,
  "min_badge": 111,
  "max_matches": 1000,
  "formula_version": "four_axis_mean_per_match_v1",
  "assets_version": "2026-10-08",
  "units": {
    "player_damage_per_min": "per_min",
    "player_damage_taken_per_min": "per_min",
    "accuracy": "ratio",
    "crit_shot_rate": "ratio"
  },
  "aggregation": "mean_per_match"
})

export const REFERENCE_CONFIG_V2='observed-metrics-29-v2-2026-10-09'
export function referenceSelection(version){
 if(version===undefined||version===''||version==='legacy')return {configKey:REFERENCE_CONFIG,context:REFERENCE_CONTEXT}
 if(version!=='v2')throw Error('Unsupported reference version')
 return {configKey:REFERENCE_CONFIG_V2,context:REFERENCE_CONTEXT_V2}
}
export const REFERENCE_CONTEXT_V2=Object.freeze({...REFERENCE_CONTEXT,baseline_version:'observed-metrics-29-v2',formula_version:'role-five-bounded-proxy-v3',observation_unit:'player-hero-match',aggregation:'mean_per_match_observation',units:Object.freeze(Object.fromEntries([
 ['count_per_match',['kills','deaths','assists','denies','last_hits','kills_plus_assists']],
 ['provider_net_worth',['net_worth']],['per_min',['net_worth_per_min','player_damage_per_min','player_damage_taken_per_min','neutral_damage_per_min','boss_damage_per_min','self_healing_per_min','player_healing_per_min','healing_per_min']],
 ['ratio',['accuracy','crit_shot_rate','kd','kda','player_damage_per_health']],
 ['provider_counter',['player_damage','neutral_damage','boss_damage','self_healing','player_healing','healing','teammate_healing','teammate_barriering','heal_prevented']]
].flatMap(([unit,names])=>names.map(name=>[name,unit]))))})
