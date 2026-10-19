import {useEffect,useId,useState} from 'react'
import {syncSources,syncOutcomes,syncRunSnapshot,syncDate,syncCount,syncReason} from './syncRunView.mjs'
import './SyncRunDetails.css'

function Timestamp({value}) {return <time dateTime={value}>{syncDate(value)}</time>}
function Source({name,source}) {
  const latest=source.latest
  return <li className="dh-run-source">
    <h3>{name}</h3>
    <p className={'dh-run-outcome dh-run-'+(latest?.outcome??'empty')}>{latest?syncOutcomes[latest.outcome]:'実行記録なし'}</p>
    {latest?<>
      <dl><div><dt>直近の開始</dt><dd><Timestamp value={latest.started_at}/></dd></div>
        <div><dt>終了</dt><dd>{latest.finished_at?<Timestamp value={latest.finished_at}/>:'終了記録なし'}</dd></div>
        {latest.processed_count!==null&&<div><dt>処理した記録</dt><dd>{syncCount(latest.processed_count)}件</dd></div>}</dl>
      {syncReason(latest)&&<p>{syncReason(latest)}</p>}
    </>:<p>実行されていないとは限りません。</p>}
    {source.last_success&&latest?.outcome!=='success'&&<p className="dh-run-history">前回の成功：<Timestamp value={source.last_success.finished_at}/></p>}
    {source.last_failure&&latest?.outcome!=='failed'&&<p className="dh-run-history">直近の失敗：<Timestamp value={source.last_failure.finished_at}/></p>}
    {source.unfinished_count!=='0'&&<p className="dh-run-unfinished">終了記録なし：{syncCount(source.unfinished_count)}件<br/>最も古い開始：<Timestamp value={source.oldest_unfinished_at}/></p>}
  </li>
}

export default function SyncRunDetails({revision=0}) {
  const [open,setOpen]=useState(false),[reload,setReload]=useState(0),[state,setState]=useState({status:'idle'}),id=useId()
  useEffect(()=>{
    if(!open)return
    const control=new AbortController();let live=true
    setState({status:'loading'})
    const timer=setTimeout(()=>{
      if(!live)return
      live=false;control.abort();setState({status:'error',reason:'timeout'})
    },8000)
    async function read() {
      try {
        const response=await fetch('/api/deadhub/sync-runs',{credentials:'same-origin',cache:'no-store',signal:control.signal})
        if(!response.ok)throw Object.assign(Error('Unavailable'),{reason:response.status===401?'auth':'read'})
        const data=syncRunSnapshot(await response.json())
        if(live)setState({status:'ready',data})
      } catch(error) {if(live)setState({status:'error',reason:error.reason})}
      finally {clearTimeout(timer)}
    }
    read()
    return()=>{live=false;clearTimeout(timer);control.abort()}
  },[open,revision,reload])
  return <div className="dh-run-disclosure">
    <button className="dh-run-toggle" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}>
      <span aria-hidden="true">{open?'−':'＋'}</span> 同期の実行状況
    </button>
    {open&&<section className="dh-run-details" id={id} aria-label="同期の実行記録" aria-busy={state.status==='loading'}>
      <div className="dh-run-heading"><h2>同期の実行記録</h2><button type="button" onClick={()=>setReload(value=>value+1)} disabled={state.status==='loading'}>状況を再確認</button></div>
      <p className="dh-run-hint">保存された実行記録だけを表示します。記録の欠損や読取り失敗から、未実行とは判断できません。</p>
      {state.status==='loading'&&<p role="status">実行記録を読み込んでいます…</p>}
      {state.status==='error'&&<p className="dh-run-error" role="status">{state.reason==='auth'?'実行記録の読取りに必要なログイン状態を確認できませんでした。':state.reason==='timeout'?'実行記録を時間内に読み込めませんでした。':'実行記録を読み込めませんでした。'}実行の有無・結果は不明です。時間をおいて再確認してください。</p>}
      {state.status==='ready'&&<>
        <p className="dh-run-observed">確認時点：<Timestamp value={state.data.observed_at}/></p>
        <ul className="dh-run-sources">{syncSources.map(([key,name])=><Source key={key} name={name} source={state.data.sources[key]}/>)}</ul>
        <p className="dh-run-hint">「定期取得用の経路」には手動で呼び出された場合も含まれます。予定どおりの自動実行を証明するものではありません。</p>
        <p className="dh-run-hint">処理件数には再取得を含み、新規の試合数ではありません。成功しても全試合・全項目の取得を保証するものではありません。終了記録なしの件数は、実行中の件数を意味しません。</p>
      </>}
    </section>}
  </div>
}
