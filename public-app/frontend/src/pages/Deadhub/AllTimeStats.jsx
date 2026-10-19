import {useEffect,useId,useState} from 'react'
import {recordStatistics,statisticNumber as number,statisticRatio,statisticDuration,statisticDay} from '../../../../shared/record-statistics.mjs'
import './AllTimeStats.css'

const labels=[['duration_s','プレイ時間'],['kills','キル'],['deaths','デス'],['assists','アシスト'],['hero_damage','与ダメージ（対プレイヤー）'],['player_healing','回復量（API提供値）']]
function Summary({data}){
  const {match_count:count,outcomes,metrics}=data,decided=BigInt(outcomes.wins)+BigInt(outcomes.losses)
  const winRate=statisticRatio(String(BigInt(outcomes.wins)*100n),String(decided))
  return <>
    <p className="dh-stats-range">{count==='0'?'試合開始日の範囲：保存済み記録なし':<>最古の試合開始日：<time dateTime={data.first_started_at}>{statisticDay(data.first_started_at)}</time><br/>最新の試合開始日：<time dateTime={data.last_started_at}>{statisticDay(data.last_started_at)}</time></>}</p>
    <dl className="dh-stats-overview">
      <div><dt>取得済み総試合数</dt><dd>{number(count)}試合</dd></div>
      <div><dt>勝敗</dt><dd>{number(outcomes.wins)}勝 / {number(outcomes.losses)}敗<small>勝敗不明：{number(outcomes.unknown)}試合</small></dd></div>
      <div><dt>勝率</dt><dd>{winRate===null?'未取得':winRate+'%'}<small>勝敗判明 {number(decided)}試合が分母</small></dd></div>
    </dl>
    {count==='0'&&<p className="dh-stats-hint">保存済みの試合はありません。プレイしていないことを示すものではありません。</p>}
    <p className="dh-stats-hint">合計・平均は各項目の取得済みの値だけを対象にします。未取得は0にせず、平均の分母からも除きます。</p>
    <dl className="dh-stats-metrics">{labels.map(([key,label])=>{
      const metric=metrics[key],known=metric.known,missing=metric.sum===null,partial=BigInt(known)<BigInt(count)
      const sum=missing?'未取得':key==='duration_s'?statisticDuration(metric.sum):number(metric.sum)
      const average=missing?'未取得':statisticRatio(metric.sum,known)+(key==='duration_s'?'秒':'')
      return <div key={key} data-metric={key}><dt>{label}</dt><dd><span>{partial&&known!=='0'?'部分合計':'合計'}：{sum}</span><span>1試合平均：{average}</span><small>値の取得済み：{number(known)} / {number(count)}試合</small></dd></div>
    })}</dl>
  </>
}

export default function AllTimeStats({revision=0}){
  const [open,setOpen]=useState(false),[reload,setReload]=useState(0),[state,setState]=useState({status:'idle'}),id=useId()
  useEffect(()=>{
    if(!open)return
    const control=new AbortController();let live=true
    setState({status:'loading'})
    const timer=setTimeout(()=>{if(live){live=false;control.abort();setState({status:'error'})}},8000)
    async function read(){
      try{
        const response=await fetch('/api/deadhub/statistics',{credentials:'same-origin',cache:'no-store',signal:control.signal})
        if(!response.ok)throw Error('Statistics unavailable')
        const data=recordStatistics(await response.json())
        if(live)setState({status:'ready',data})
      }catch{if(live)setState({status:'error'})}
      finally{clearTimeout(timer)}
    }
    read()
    return()=>{live=false;clearTimeout(timer);control.abort()}
  },[open,revision,reload])
  return <div className="dh-stats-disclosure">
    <button className="dh-stats-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><span aria-hidden="true">{open?'−':'＋'}</span> 全期間の統計</button>
    {open&&<section id={id} className="dh-stats-details" aria-label="保存済み全期間の統計" aria-busy={state.status==='loading'}>
      <div className="dh-stats-heading"><h3>全期間の統計</h3><button type="button" onClick={()=>{if(state.status!=='loading')setReload(value=>value+1)}} aria-disabled={state.status==='loading'}>統計を再確認</button></div>
      <p className="dh-stats-hint">本人の保存済み記録・全ヒーローが対象です。月・日付・ヒーローの選択には連動しません。生涯の全試合ではありません。</p>
      {state.status==='loading'&&<p role="status">保存済み全期間の統計を読み込んでいます…</p>}
      {state.status==='error'&&<p className="dh-stats-error" role="status">統計を読み込めませんでした。試合数や合計は不明です。時間をおいて再確認してください。</p>}
      {state.status==='ready'&&<Summary data={state.data}/>}
    </section>}
  </div>
}
