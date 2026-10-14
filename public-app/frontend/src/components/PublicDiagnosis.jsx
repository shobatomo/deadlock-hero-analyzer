import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {requestDiagnosis} from '../lib/api'
import FiveAxisSummary from './FiveAxisSummary'
import RecommendationFeedback from './RecommendationFeedback'
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
  catch(error){if(mounted.current)setState({status:controller.signal.aborted&&!timedOut?'cancelled':'error',error:timedOut?"取得に時間がかかっています。時間をおいて、もう一度お試しください。":error.message})}
  finally{clearTimeout(timer);active.current=null}
 }
 if(!account)return <section className="state-panel"><h2>もう一度IDを入力してください</h2><p>入力情報がありません。履歴を保存しないため、ページを再読み込みした場合もIDの入力からやり直してください。</p><Link className="primary-button" to="/">入力画面へ戻る</Link></section>
 const complete=state.status==='complete',loading=state.status==='loading',ready=state.result?.five_axis?.status==='ready'
 const dates=(state.result?.candidate_coverage?.heroes??[]).map(h=>Date.parse(h.reference_updated_at)).filter(Number.isFinite)
 const oldest=dates.length?new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'UTC'}).format(Math.min(...dates)):null
 return <section className="diagnosis-flow">
  {complete?<div className="result-content"><h2 ref={resultHeading} tabIndex="-1" className="result-focus-heading">{ready?"次に試すヒーロー候補":'プレイ記録の確認結果'}</h2>
   {(state.result.collection?.reference_stale||state.result.collection?.reference_source?.startsWith('local'))&&<p className="reference-status" role="status">{state.result.collection?.reference_source?.startsWith('local')?"保存済みの比較データを使った参考結果です。":"古い比較データを使った参考結果です。"}最新のゲーム環境と異なる場合があります。</p>}
   {state.result.five_axis?<FiveAxisSummary result={state.result.five_axis} evidence={state.result} detailsContent={<>
    <p>直近30日から選んだ記録：{state.result.collection?.history_retained??0}試合</p>
    <p>候補選びに使った記録：{state.result.collection?.diagnosis_matches==null?'未報告':`${state.result.collection.diagnosis_matches}試合`}</p>
    {state.result.collection?.analyzed_matches!=null?<p>{state.result.collection.metadata_requests}試合の詳細取得を試み、照合できた{state.result.collection.analyzed_matches}試合を分析しました。取得失敗：{state.result.collection.metadata_failures}試合。照合できず除外：{state.result.collection.metadata_excluded}試合。</p>:<p>APIから使用件数が報告されていません。新しい取得設定を使うには、APIの再起動が必要です。</p>}
    <p>使用件数は、比較できる項目の計算に使った試合数です。欠けた値は補いません。項目によって件数が異なる場合があります。</p>
    <h3>項目ごとの記録数</h3>{state.result.five_axis.axes.map(axis=><p key={axis.id}>{axis.label}：{axis.sample_count==null?'未報告':`${axis.sample_count}試合`}{!axis.measured&&'（必要な記録・比較基準が不足）'}</p>)}
    <p>候補に使う一覧には、現在の全ヒーローが含まれているとは限りません。</p><p>比較データ：{state.result.collection?.reference_source??'不明'} / 取得日時：{state.result.collection?.observed_at??'不明'}</p>{oldest&&<p>比較データの最も古い更新日時：{oldest}（UTC）</p>}
   </>}/>:<div className="state-panel"><h3>今回は候補を出せませんでした</h3><p role="status">比較に使える記録がありません。最近のプレイ記録や公開設定を確認し、時間をおいてお試しください。</p></div>}
   {ready&&<RecommendationFeedback/>}
  </div>:<div className="state-panel">
   {loading?<><div className="loading-symbol" aria-hidden="true"/><h2>プレイ記録からおすすめを探しています…</h2><p role="status">記録の取得と分析を待っています。最大約1分かかる場合があります。</p><details className="data-details"><summary>処理の流れ</summary><ol className="acquisition-steps" aria-label="処理の順序"><li>直近30日の履歴から、最大10試合を選びます</li><li>最大5試合の詳細取得を試みます</li><li>比較できる記録を、5つの項目で分析します</li></ol><p>途中の件数は表示できません。使用件数は結果画面で確認できます。</p></details></>:<><h2>プレイ記録からおすすめを探す</h2><p>直近30日のプレイ記録を使います。</p>
    <p className="consent-copy">取得ボタンを押すと、入力したIDを外部のDeadlock APIへ送信します。プレイ履歴や結果はサーバーに保存しません。</p>
    <details className="data-details"><summary>取得する記録と注意点</summary><p>候補の最大10試合から、最大5試合の詳細取得を試みます。記録が足りない場合は候補を表示できません。一部の取得に失敗しても、使える記録があれば分析します。</p></details>
   </>}
   {state.status==='cancelled'&&<p className="notice-text" role="status">取得を中止しました。もう一度取得できます。</p>}
   {state.status==='error'&&<div className="error-panel" role="alert"><h3>記録を取得できませんでした。</h3><p>{state.error}</p><p>入力したIDと、公開された記録があるかを確認してください。取得制限や通信エラーの場合は、時間をおいてもう一度お試しください。</p><Link className="error-return" to="/">IDを確認する</Link></div>}
  </div>}
  <details className="data-details"><summary>匿名の利用計測について</summary><p>利用計測を有効にした場合、診断の要求・推薦あり・推薦なし・エラー・接続切断を、日付・種類・件数だけで集計します。無効時にはこの集計を行いません。</p><p>個人のID・IPアドレス・Cookie・セッションID・入力URL・プレイ履歴・エラー本文は、この集計に保存しません。通常の集計は当日と過去29日分を保持し、バックアップには別途残る可能性があります。</p><p>再試行は別の要求として数えます。応答完了は画面表示を確認するものではなく、実人数や個人ごとの離脱率は測りません。通信障害などで集計できないことがあります。任意の3択回答は、別の回答集計です。</p></details>
  <div className={'acquisition-actions '+(complete?'after-result':'')}>{loading?<button className="secondary-button" onClick={()=>active.current?.abort()}>中止する</button>:<button ref={action} className={complete?'secondary-button':'primary-button'} onClick={collect}>{state.status==='idle'?"プレイ記録を取得しておすすめを見る":'もう一度取得する'}{!complete&&<span aria-hidden="true">→</span>}</button>}{complete&&<Link className="secondary-button alternate-id" to="/">別のIDを入力する</Link>}</div>
 </section>
}
