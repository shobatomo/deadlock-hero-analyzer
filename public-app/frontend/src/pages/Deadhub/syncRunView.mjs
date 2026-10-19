export const syncSources=[['manual','手動更新'],['registration','初回登録時の取得'],['cron_endpoint','定期取得用の経路']]
export const syncOutcomes={success:'成功',failed:'失敗',partial:'一部取得',skipped:'スキップ',started:'未完了（終了記録なし）'}
const reasons={
  page_limit:'今回の取得上限に達しました。',not_registered:'記録対象が未登録でした。',
  busy:'別の取得が進行中でした。',cooldown:'次の取得までの待機時間中でした。',shared_busy:'提供元へのアクセス待ちでした。',
  already_registered:'登録済みのため初回取得を開始できませんでした。',provider_paused:'提供元の待機指示で更新が停止していました。',
  shared_unavailable:'提供元へのアクセスを調整できませんでした。',rate_limited:'提供元の利用制限に達しました。',
  provider_timeout:'提供元の応答を時間内に確認できませんでした。',provider_failed:'提供元から取得できませんでした。',
  invalid_provider:'提供元の応答を確認できませんでした。',response_too_large:'提供元の応答が取得上限を超えました。',
  sync_failed:'取得を完了できませんでした。',lease_lost:'取得処理の継続を確認できませんでした。',unexpected_result:'取得結果を確認できませんでした。',
}
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value))
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
function run(value) {
  if(value===null)return null
  if(!object(value)||typeof value.outcome!=='string'||!Object.hasOwn(syncOutcomes,value.outcome)||!iso(value.started_at))throw Error('Invalid run')
  const {started_at,finished_at,outcome,result_code,processed_count}=value
  if(outcome==='started') {
    if(finished_at!==null||result_code!==null||processed_count!==null)throw Error('Invalid unfinished run')
  } else {
    if(!iso(finished_at)||Date.parse(finished_at)<Date.parse(started_at)||typeof result_code!=='string')throw Error('Invalid completed run')
    if(outcome==='success'||outcome==='partial') {
      if(!Number.isSafeInteger(processed_count)||processed_count<0||processed_count>2147483647)throw Error('Invalid count')
    } else if(processed_count!==null)throw Error('Invalid count')
  }
  return {started_at,finished_at,outcome,result_code,processed_count}
}
// Accept the authenticated endpoint's fixed contract only. Unknown payloads are
// unavailable evidence, never empty history. Do not display raw server errors.
export function syncRunSnapshot(value) {
  if(!object(value)||value.available!==true||value.evidence!=='recorded_attempts_only'||value.cron_origin_verified!==false||!iso(value.observed_at)||!object(value.sources))throw Error('Unavailable snapshot')
  const sources={}
  for(const [key] of syncSources) {
    const source=value.sources[key]
    if(!object(source)||typeof source.unfinished_count!=='string'||!/^(0|[1-9]\d{0,18})$/.test(source.unfinished_count))throw Error('Invalid source')
    const latest=run(source.latest),last_success=run(source.last_success),last_failure=run(source.last_failure)
    if(last_success&&last_success.outcome!=='success'||last_failure&&last_failure.outcome!=='failed')throw Error('Invalid summary')
    if(source.unfinished_count==='0'?source.oldest_unfinished_at!==null:!iso(source.oldest_unfinished_at))throw Error('Invalid unfinished summary')
    if(!latest&&(last_success||last_failure||source.unfinished_count!=='0')||latest?.outcome==='started'&&source.unfinished_count==='0')throw Error('Inconsistent summary')
    sources[key]={latest,last_success,last_failure,unfinished_count:source.unfinished_count,oldest_unfinished_at:source.oldest_unfinished_at}
  }
  return {observed_at:value.observed_at,sources}
}
const dateFormat=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export const syncDate=value=>dateFormat.format(new Date(value))+' JST'
export const syncCount=value=>String(value).replace(/\B(?=(\d{3})+(?!\d))/g,',')
export function syncReason(value) {
  if(value.outcome==='success')return ''
  if(value.outcome==='started')return '実行中・中断・記録の欠損を区別できません。'
  return Object.hasOwn(reasons,value.result_code)?reasons[value.result_code]:value.outcome==='skipped'?'今回の取得は見送られました。':'取得を完了できませんでした。'
}
