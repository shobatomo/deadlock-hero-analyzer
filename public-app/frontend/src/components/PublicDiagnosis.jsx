import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {requestDiagnosis} from '../lib/api'
import FiveAxisSummary from './FiveAxisSummary'
export default function PublicDiagnosis({account}){
 const [state,setState]=useState({status:'idle'}),active=useRef(null),mounted=useRef(true),resultHeading=useRef(null),action=useRef(null)
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;active.current?.abort()}},[])
 useEffect(()=>{if(state.status==='complete')resultHeading.current?.focus();else if(state.status==='cancelled'||state.status==='error')action.current?.focus()},[state.status])
 async function collect(){
  if(active.current)return
  const controller=new AbortController();active.current=controller;setState({status:'loading'})
  let timedOut=false
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},65000)
  try{const result=await Promise.race([requestDiagnosis(account,{signal:controller.signal,collect:true,refresh:true}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))]);if(mounted.current&&!controller.signal.aborted)setState({status:'complete',result})}
  catch(error){if(mounted.current)setState({status:controller.signal.aborted&&!timedOut?'cancelled':'error',error:timedOut?'取得に時間がかかっています。時間をおいて再試行してください。':error.message})}
  finally{clearTimeout(timer);active.current=null}
 }
 if(!account)return <section className="state-panel"><h2>もう一度、IDを入力してください。</h2><p>入力情報がありません。履歴を保存しないため、ページを再読み込みした時も入力からやり直します。</p><Link className="primary-button" to="/">入力画面へ戻る</Link></section>
 const complete=state.status==='complete',loading=state.status==='loading',ready=state.result?.five_axis?.status==='ready'
 const dates=(state.result?.candidate_coverage?.heroes??[]).map(h=>Date.parse(h.reference_updated_at)).filter(Number.isFinite)
 const oldest=dates.length?new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}).format(Math.min(...dates)):null
 return <section className="diagnosis-flow">
  {complete?<div className="result-content"><h2 ref={resultHeading} tabIndex="-1" className="result-focus-heading">{ready?'あなたへのヒーロー候補':'プレイ記録の確認結果'}</h2>
   <div className="evidence-strip"><span>直近30日</span><span>選んだ記録：{state.result.collection?.history_retained??0}試合</span><span>診断に使用：{state.result.collection?.diagnosis_matches==null?'未報告':`${state.result.collection.diagnosis_matches}試合`}</span><span>参考診断</span></div>
   {state.result.collection?.analyzed_matches!=null?<p className="sample-explainer">詳細確認を{state.result.collection.metadata_requests}試合に行い、照合できた{state.result.collection.analyzed_matches}試合を分析しました。取得失敗：{state.result.collection.metadata_failures}試合 / 照合できず除外：{state.result.collection.metadata_excluded}試合。</p>:<p className="sample-explainer">起動中のAPIは診断に使った件数を報告していません。新しい取得設定を使うには、APIの再起動が必要です。</p>}
   <p className="muted">診断に使用した件数は、比較できる軸に寄与した試合数です。欠けた値は補わず、軸ごとの件数が異なる場合があります。</p>
   {state.result.five_axis?.axes&&<details className="data-details"><summary>軸ごとの記録数</summary>{state.result.five_axis.axes.map(axis=><p key={axis.id}>{axis.label}：{axis.sample_count==null?'未報告':`${axis.sample_count}試合`}{!axis.measured&&'（必要な記録・比較基準が不足）'}</p>)}</details>}
   {(state.result.collection?.reference_stale||state.result.collection?.reference_source?.startsWith('local'))&&<div className="notice" role="status"><span aria-hidden="true">!</span><p>{state.result.collection?.reference_source?.startsWith('local')?'比較基準のDBを利用できず、保存済みの基準で確認しています。':'比較に使う基準が古くなっています。最新のゲーム環境と異なる可能性があります。'}{oldest&&<span className="reference-date">比較基準の最古の更新：{oldest}（UTC）</span>}</p></div>}
   {state.result.five_axis?<FiveAxisSummary result={state.result.five_axis} evidence={state.result}/>:<div className="state-panel"><h3>候補をまだ選べません。</h3><p role="status">比較に使える記録がありません。非公開や記録不足の可能性があります。</p><p>最近のプレイ記録や入力IDを確認して、時間をおいて試してください。</p></div>}
   <details className="data-details"><summary>今回のデータと診断の限界</summary><p>今回選んだ記録：{state.result.collection?.history_retained??0}試合 / 詳細確認のリクエスト：{state.result.collection?.metadata_requests??0}回</p><p>候補一覧は現行ゲームの全ヒーローを保証しません。取得元の人数・パッチ整合は未確認です。</p><p>基準：{state.result.collection?.reference_source??'不明'} / 取得：{state.result.collection?.observed_at??'不明'}</p></details>
  </div>:<div className="state-panel">
   {loading?<><div className="loading-symbol" aria-hidden="true"/><h2>プレイ記録を確認しています…</h2><p role="status">取得・分析の結果を待っています。最大約1分かかる場合があります。</p><ol className="acquisition-steps" aria-label="確認する順序"><li>直近30日の履歴から最大10試合を選ぶ</li><li>最大5試合の詳細を確認する</li><li>比較できる記録で5軸を分析する</li></ol><p className="muted">途中の件数はまだ確認できません。結果が届いたら、診断に使えた件数を表示します。取り消すこともできます。</p></>:<><p className="eyebrow">READY WHEN YOU ARE</p><h2>記録を取得して、候補を見よう。</h2><p>最近のプレイから、次に試してみるヒーローを探します。少ない試合からの参考候補です。</p><div className="evidence-strip"><span>直近30日</span><span>候補最大10試合・詳細最大5試合</span><span>個人履歴の保存なし</span></div>
    <p className="consent-copy">取得すると入力IDを外部Deadlock APIへ送信します。直近30日の最大10試合を選び、詳しい記録は最大5試合確認します。一部を取得できなくても、使える記録があれば分析します。個人の履歴・結果はサーバーに保存せず、毎回取得します。</p>
   </>}
   {state.status==='cancelled'&&<p className="notice-text" role="status">取得を取り消しました。もう一度取得できます。</p>}
   {state.status==='error'&&<div className="error-panel" role="alert"><h3>記録を取得できませんでした。</h3><p>{state.error}</p><p>入力ID・公開記録の有無を確認してください。取得制限や通信エラーなら、時間をおいて再試行してください。</p><Link className="error-return" to="/">IDを確認する →</Link></div>}
  </div>}
  <div className={'acquisition-actions '+(complete?'after-result':'')}>{loading?<button className="secondary-button" onClick={()=>active.current?.abort()}>取り消す</button>:<button ref={action} className={complete?'secondary-button':'primary-button'} onClick={collect}>{state.status==='idle'?'プレイ記録を取得して候補を見る':'もう一度取得する'}{!complete&&<span aria-hidden="true">→</span>}</button>}{complete&&<Link to="/">別のIDで確認する</Link>}</div>
 </section>
}
