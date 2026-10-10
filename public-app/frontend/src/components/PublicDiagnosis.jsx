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
  {complete?<div className="result-content"><h2 ref={resultHeading} tabIndex="-1" className="result-focus-heading">{ready?'次に試してみるヒーロー':'プレイ記録の確認結果'}</h2>
   {(state.result.collection?.reference_stale||state.result.collection?.reference_source?.startsWith('local'))&&<p className="reference-status" role="status">{state.result.collection?.reference_source?.startsWith('local')?'保存済み基準を使った参考結果です。':'比較基準が古い参考結果です。'}最新のゲーム環境と異なる場合があります。</p>}
   {state.result.five_axis?<FiveAxisSummary result={state.result.five_axis} evidence={state.result} detailsContent={<>
    <p>直近30日 / 選んだ記録：{state.result.collection?.history_retained??0}試合</p>
    <p>診断に使用：{state.result.collection?.diagnosis_matches==null?'未報告':`${state.result.collection.diagnosis_matches}試合`}</p>
    {state.result.collection?.analyzed_matches!=null?<p>詳細確認を{state.result.collection.metadata_requests}試合に行い、照合できた{state.result.collection.analyzed_matches}試合を分析しました。取得失敗：{state.result.collection.metadata_failures}試合 / 照合できず除外：{state.result.collection.metadata_excluded}試合。</p>:<p>起動中のAPIは診断に使った件数を報告していません。新しい取得設定にはAPIの再起動が必要です。</p>}
    <p>使用件数は比較できる軸に寄与した試合数です。欠けた値は補わず、軸ごとの件数が異なる場合があります。</p>
    <h3>軸ごとの記録数</h3>{state.result.five_axis.axes.map(axis=><p key={axis.id}>{axis.label}：{axis.sample_count==null?'未報告':`${axis.sample_count}試合`}{!axis.measured&&'（必要な記録・比較基準が不足）'}</p>)}
    <p>候補一覧は現行ゲームの全ヒーローを保証しません。</p><p>基準：{state.result.collection?.reference_source??'不明'} / 取得：{state.result.collection?.observed_at??'不明'}</p>{oldest&&<p>比較基準の最古の更新：{oldest}（UTC）</p>}
   </>}/>:<div className="state-panel"><h3>候補をまだ選べません。</h3><p role="status">比較に使える記録がありません。最近のプレイ記録や公開状態を確認して、時間をおいて試してください。</p></div>}
  </div>:<div className="state-panel">
   {loading?<><div className="loading-symbol" aria-hidden="true"/><h2>ヒーロー候補を探しています…</h2><p role="status">取得・分析の結果を待っています。最大約1分かかる場合があります。</p><details className="data-details"><summary>待機中の処理について</summary><ol className="acquisition-steps" aria-label="確認する順序"><li>直近30日の履歴から最大10試合を選ぶ</li><li>最大5試合の詳細を確認する</li><li>比較できる記録で5軸を分析する</li></ol><p>途中の件数はまだ確認できません。結果が届いたら使用件数を確認できます。</p></details></>:<><h2>記録から、候補3体を探そう。</h2><p>直近30日のプレイ記録を使います。</p>
    <p className="consent-copy">取得すると入力IDを外部Deadlock APIへ送信します。履歴・結果はサーバーに保存しません。</p>
    <details className="data-details"><summary>取得範囲と注意</summary><p>候補最大10試合から、詳細を最大5試合確認します。記録不足時は候補を出せません。一部の取得失敗は、使える記録で分析します。</p></details>
   </>}
   {state.status==='cancelled'&&<p className="notice-text" role="status">取得を取り消しました。もう一度取得できます。</p>}
   {state.status==='error'&&<div className="error-panel" role="alert"><h3>記録を取得できませんでした。</h3><p>{state.error}</p><p>入力ID・公開記録の有無を確認してください。取得制限や通信エラーなら、時間をおいて再試行してください。</p><Link className="error-return" to="/">IDを確認する →</Link></div>}
  </div>}
  <div className={'acquisition-actions '+(complete?'after-result':'')}>{loading?<button className="secondary-button" onClick={()=>active.current?.abort()}>取り消す</button>:<button ref={action} className={complete?'secondary-button':'primary-button'} onClick={collect}>{state.status==='idle'?'プレイ記録を取得して候補を見る':'もう一度取得する'}{!complete&&<span aria-hidden="true">→</span>}</button>}{complete&&<Link to="/">別のIDで確認する</Link>}</div>
 </section>
}
