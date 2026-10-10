import {useState} from 'react'
import {heroName} from '../../../shared/heroes.mjs'
import guides from '../../../shared/hero-guides.json'
import HeroPortrait from './HeroPortrait'
const simple={gank_pick:'敵を倒す場面への関わり方',farm_growth:'育ち方',damage_output:'ダメージの出し方',frontline:'前線での戦い方の目安',support_team:'味方との戦闘への関わり方'}
const brief={gank_pick:'敵への関わり方',farm_growth:'育ち方',damage_output:'ダメージの出し方',frontline:'前線での戦い方',support_team:'味方との関わり方'}
function nearReason(row){
 const gaps=row.axis_gaps.filter(g=>Number.isFinite(g.squared_gap)&&g.squared_gap>=0).slice().sort((a,b)=>a.squared_gap-b.squared_gap).slice(0,2)
 return gaps.length?`あなたの記録と、${gaps.map(g=>simple[g.axis]??g.label).join('・')}が近い参考候補です。`:row.reason
}
function shortReason(row){
 const gaps=row.axis_gaps.filter(g=>Number.isFinite(g.squared_gap)&&g.squared_gap>=0).slice().sort((a,b)=>a.squared_gap-b.squared_gap).slice(0,1)
 return gaps.length?`${gaps.map(g=>brief[g.axis]??g.label).join('・')}が近い`:row.reason
}
export default function FiveAxisSummary({result,evidence,detailsContent}){
 const [chosen,setChosen]=useState(null)
 if(!result)return null
 const ready=result.status==='ready',commonReason=ready&&result.recommendations.length>1&&result.recommendations.every(r=>nearReason(r)===nearReason(result.recommendations[0]))?nearReason(result.recommendations[0]):null
 const count=evidence?.collection?.diagnosis_matches??evidence?.local_history?.rows?.length
 return <section aria-label="ヒーローの参考候補" className="five-axis">
  {!evidence&&<div className="candidates-heading"><h2>{ready?'次に試してみるヒーロー':'プレイ記録を確認しました'}</h2></div>}
  {ready?<p className="result-intro">少数の記録からの参考候補です。相性や勝率を保証しません。</p>:null}
  {evidence?.collection?.cache_status==='expired'&&<p className="notice-text">期限切れの保存データを使っています。</p>}
  {ready?<><ol className="hero-candidates">{result.recommendations.map(row=>{const guide=guides.heroes[row.hero_id],selected=chosen===row.hero_id;return <li key={row.hero_id} className={'hero-card '+(selected?'is-chosen':'')}>
   <div className="hero-art"><HeroPortrait id={row.hero_id}/></div>
   <div className="hero-card-body"><h3>{heroName(row.hero_id)}</h3><p className="hero-short-reason">{shortReason(row)}</p>
    <button className="choose-button" aria-pressed={selected} onClick={()=>setChosen(selected?null:row.hero_id)}>{selected?'試し方を表示中':'試し方を見る'}<span aria-hidden="true">{selected?'✓':'↗'}</span></button>
    {selected&&<div className="try-tip" role="status"><strong>{heroName(row.hero_id)}を試してみよう。</strong><p>{guide?.first_step??'まずは練習で、移動と通常攻撃、能力の使い方を確かめてみよう。'}</p><small>表示はこの画面だけ。ゲームやアカウントには反映されません。</small></div>}
   </div>
  </li>})}</ol></>:<div className="state-panel insufficient-panel"><h3>候補をまだ選べません。</h3><p role="status">比較に必要な記録が足りないため、今回は候補を出せません。最近のプレイ記録や公開状態を確認してください。</p></div>}
  <details className="data-details diagnosis-details"><summary>診断の根拠と注意</summary>
   {detailsContent}
   <p>候補の並びは記録の近さによるもので、強さの順位ではありません。「試し方を見る」で、この画面に練習のヒントを表示します。</p>
   {commonReason&&<><h3>{result.recommendations.length}体に共通する推薦理由</h3><p>{commonReason}</p></>}
   {result.recommendations.map(row=><section key={row.hero_id} className="candidate-evidence"><h3>{heroName(row.hero_id)}の紹介と記録</h3><p>{guides.heroes[row.hero_id]?.description??'紹介情報は未確認です。ゲーム内で能力を確かめてください。'}</p><p>{nearReason(row)}</p><p>距離：{row.distance.toFixed(3)}（小さいほど記録の傾向が近い）</p><ul>{row.axis_gaps.map(g=><li key={g.axis}>{simple[g.axis]??g.label}：本人 {g.player_relative.toFixed(3)} / 比較対象 {g.top_relative.toFixed(3)}</li>)}</ul></section>)}
   <p>共通に比較できる範囲：{Math.round(result.coverage*100)}%。欠けた記録をゼロとして補いません。記録：{count??'不明'}試合。</p><p>モデル：<code>{result.formula_version}</code></p>
   <ul>{result.axes.map(a=><li key={a.id}>{simple[a.id]??a.label}：{a.measured?`本人の相対値 ${a.player_relative.toFixed(3)}`:'未測定'}{a.reason&&` / ${a.reason}`}</li>)}</ul>
   <p>5軸を−1〜+1の尺度で比較します。極端値はクリップし、ダメージ参加の目安は中央値で飽和します。前線維持は被ダメージ・死亡・与ダメージからの推定で、位置や行動意図を直接観測しません。</p>
   <ul>{result.reasons.map(r=><li key={r}>{r}</li>)}{result.warnings?.map(r=><li key={r}>{r}</li>)}</ul><p>{guides.roster_notice}</p>
   <h3>ヒーロー紹介・画像の出典</h3><p>ゲームassets保存日：{guides.assets_observed_at} / 公式更新確認日：{guides.reviewed_at}</p><p>{guides.source_note}</p><p>紹介は保存資料の短い独自要約です。最新の能力値は保証しません。画像はDeadlock APIの取得済み一覧に記載された配信元から保存しています。</p><a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a><span> / </span><a href={guides.official_changelog} target="_blank" rel="noreferrer">Valve公式更新記録</a>
  </details>
 </section>
}
