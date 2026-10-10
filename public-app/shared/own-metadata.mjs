import { normalizeAccountId } from './diagnosis.mjs'
const fields=['time_stamp_s','player_damage','player_damage_taken','player_healing','shots_hit','shots_missed','hero_bullets_hit','hero_bullets_hit_crit','net_worth','neutral_damage','boss_damage','max_health','self_healing','teammate_healing','teammate_barriering','heal_prevented']
const integer=v=>Number.isSafeInteger(v)&&v>=0
export function projectOwnMetadata(payload, input, expected) {
 const account=normalizeAccountId(input); const info=payload?.match_info
 if(!info || info.start_time!==expected.start_time || info.duration_s!==expected.match_duration_s || info.game_mode!==expected.game_mode || info.match_mode!==expected.match_mode) return {status:'unavailable',reason:'試合の時刻・期間・modeが保存済み戦績と一致しません'}
 const players=Array.isArray(info.players)?info.players.filter(p=>String(p.account_id)===account):[]
 if(players.length!==1 || players[0].hero_id!==expected.hero_id) return {status:'unavailable',reason:'本人の行を一意に照合できません'}
 const player=players[0]
 const stats=Array.isArray(player.stats)?player.stats:[]
 const snapshots=stats.map(row=>Object.fromEntries(fields.filter(k=>integer(row?.[k])).map(k=>[k,row[k]])))
 const maxima={}
 for(const name of fields.filter(k=>k!=='time_stamp_s')) {
  if(stats.length&&stats.every(row=>integer(row?.[name]))) maxima[name]=Math.max(...stats.map(row=>row[name]))
 }
 const final_counts=Object.fromEntries(['kills','deaths','assists','net_worth','last_hits','denies'].filter(k=>integer(player[k])).map(k=>[k,player[k]]))
 return {status:'available',final_counts,schema_reference:'https://github.com/deadlock-api/deadlock-api/blob/b2bc366eea058327d77414090ea004d2c96cce51/valveprotos/protos/deadlock/citadel_gcmessages_common.proto',
  snapshot_count:stats.length,snapshots,provider_snapshot_maxima:maxima,
  units:{time_stamp_s:'seconds',player_damage:'provider_damage_uint32',player_damage_taken:'provider_damage_uint32',player_healing:'provider_uint32',shots_hit:'provider_count_uint32',shots_missed:'provider_count_uint32',hero_bullets_hit:'provider_count_uint32',hero_bullets_hit_crit:'provider_count_uint32',net_worth:'provider_uint32',neutral_damage:'provider_damage_uint32',boss_damage:'provider_damage_uint32',max_health:'provider_health_uint32',self_healing:'provider_uint32',teammate_healing:'provider_uint32',teammate_barriering:'provider_uint32',heal_prevented:'provider_uint32'},
  meaning:'提供元スナップショットの最大値。試合最終値や推薦特徴量ではありません'}
}
