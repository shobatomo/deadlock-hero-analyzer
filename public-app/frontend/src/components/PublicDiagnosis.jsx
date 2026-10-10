import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {requestDiagnosis} from '../lib/api'
import FiveAxisSummary from './FiveAxisSummary'
export default function PublicDiagnosis({account}){
 const [state,setState]=useState({status:'idle'}),active=useRef(null),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;active.current?.abort()}},[])
 async function collect(){
  if(active.current)return
  const controller=new AbortController();active.current=controller
  setState({status:'loading'})
  let timedOut=false
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},65000)
  try{const result=await Promise.race([requestDiagnosis(account,{signal:controller.signal,collect:true,refresh:true}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))]);if(mounted.current&&!controller.signal.aborted)setState({status:'complete',result})}
  catch(error){if(mounted.current)setState({status:controller.signal.aborted&&!timedOut?'cancelled':'error',error:timedOut?'取得に時間がかかっています。時間をおいて再試行してください。':error.message})}
  finally{clearTimeout(timer);active.current=null}
 }
 if(!account)return <><p>入力情報がありません。入力画面から診断してください。</p><Link to="/">入力画面へ戻る</Link></>
 return <section aria-busy={state.status==='loading'}>
  <p>最近のプレイから、次に試してみるヒーローを探します。少ない試合からの参考候補です。</p>
  <p>取得すると入力IDを外部Deadlock APIへ送信します。直近30日の最大5試合を選び、詳しい記録は最大3試合取得します。個人の履歴・結果はサーバーに保存せず、毎回取得します。</p>
  {state.status==='loading'?<><p role="status">プレイ記録を確認しています…</p><button onClick={()=>active.current?.abort()}>取り消す</button></>:<button onClick={collect}>{state.status==='idle'?'プレイ記録を取得して候補を見る':'もう一度取得する'}</button>}
  {state.status==='cancelled'&&<p role="status">取得を取り消しました。</p>}
  {state.status==='error'&&<p role="alert">{state.error}</p>}
  {state.result&&<>
   {state.result.collection?.reference_source?.startsWith('local')&&<p>比較基準のDBを利用できず、保存済みの基準で確認しています。</p>}
   {state.result.collection?.reference_stale&&<p>比較に使う基準が古くなっています。最新のゲーム環境と異なる可能性があります。</p>}
   {state.result.five_axis?<FiveAxisSummary result={state.result.five_axis} evidence={state.result}/>:<p role="status">比較に使える記録がありません。非公開や記録不足の可能性があります。</p>}
   <details><summary>詳しく見る：データの範囲</summary><p>今回選んだ記録：{state.result.collection?.history_retained??0}試合 / 詳しい記録の取得：{state.result.collection?.metadata_requests??0}試合</p><p>候補一覧は現行ゲームの全ヒーローを保証しません。取得元の人数・パッチ整合は未確認です。</p><p>基準：{state.result.collection?.reference_source??'不明'} / 取得：{state.result.collection?.observed_at??'不明'}</p></details>
  </>}
 </section>
}
