import {useState} from 'react'
import {heroName} from '../../../shared/heroes.mjs'
import guides from '../../../shared/hero-guides.json'
import HeroPortrait from './HeroPortrait'
const simple={gank_pick:"敵を倒す場面への関わり",farm_growth:'育ち方',damage_output:'ダメージの出し方',frontline:'前線での戦い方の目安',support_team:"味方との戦闘への関わり"}
const brief={gank_pick:'敵への関わり方',farm_growth:'育ち方',damage_output:'ダメージの出し方',frontline:"前線での戦い方の目安",support_team:'味方との関わり方'}
function nearReason(row){
 const gaps=row.axis_gaps.filter(g=>Number.isFinite(g.squared_gap)&&g.squared_gap>=0).slice().sort((a,b)=>a.squared_gap-b.squared_gap).slice(0,2)
 return gaps.length?`あなたの記録と、${gaps.map(g=>simple[g.axis]??g.label).join('・')}の傾向が近い候補です。`:row.reason
}
function shortReason(row){
 const gaps=row.axis_gaps.filter(g=>Number.isFinite(g.squared_gap)&&g.squared_gap>=0).slice().sort((a,b)=>a.squared_gap-b.squared_gap).slice(0,1)
 return gaps.length?`${gaps.map(g=>brief[g.axis]??g.label).join('・')}が近い`:row.reason
}
export default function FiveAxisSummary({result,evidence,detailsContent}){
 const [expanded,setExpanded]=useState(()=>new Set())
 function toggle(heroId){setExpanded(previous=>{const next=new Set(previous);if(next.has(heroId))next.delete(heroId);else next.add(heroId);return next})}
 if(!result)return null
 const ready=result.status==='ready',commonReason=ready&&result.recommendations.length>1&&result.recommendations.every(r=>nearReason(r)===nearReason(result.recommendations[0]))?nearReason(result.recommendations[0]):null
 const count=evidence?.collection?.diagnosis_matches??evidence?.local_history?.rows?.length
 return <section aria-label="ヒーロー候補" className="five-axis">
  {!evidence&&<div className="candidates-heading"><h2>{ready?"次に試すヒーロー候補":'プレイ記録を確認しました'}</h2></div>}
  {ready?<p className="result-intro">少数の記録をもとにした参考候補です。相性や勝率を保証するものではありません。</p>:null}
  {evidence?.collection?.cache_status==='expired'&&<p className="notice-text">有効期限が切れた保存データを使っています。</p>}
  {ready?<><ol className="hero-candidates">{result.recommendations.map(row=>{const guide=guides.heroes[row.hero_id],selected=expanded.has(row.hero_id),short=shortReason(row);return <li key={row.hero_id} className={'hero-card '+(selected?'is-chosen':'')}>
   <div className="hero-art"><HeroPortrait id={row.hero_id}/></div>
   <div className="hero-card-body"><h3>{heroName(row.hero_id)}</h3><p className="hero-short-reason">{short.endsWith("が近い")?<><span className="reason-phrase">{short.slice(0,-3)}</span><wbr/><span className="reason-phrase">が近い</span></>:short}</p>
    <button className="choose-button" aria-pressed={selected} aria-expanded={selected} onClick={()=>toggle(row.hero_id)}>{selected?'試し方を表示中':'試し方を見る'}<span aria-hidden="true">{selected?'−':'+'}</span></button>
    {selected&&<div className="try-tip" role="status"><strong>{guide?.first_step_title??`${heroName(row.hero_id)}でやってみよう`}</strong><p>{guide?.first_step??"まずは練習で、移動・通常攻撃・アビリティを試してみよう。"}</p><small>ヒントはこの画面にだけ表示されます。ゲームやアカウントには反映されません。</small></div>}
   </div>
  </li>})}</ol></>:<div className="state-panel insufficient-panel"><h3>今回は候補を出せませんでした</h3><p role="status">比較に使える記録が足りないため、今回は候補を表示できません。最近のプレイ記録や公開設定を確認してください。</p></div>}
  <details className="data-details diagnosis-details"><summary>候補の選び方と注意点</summary>
   {detailsContent}
   <p>3体は、いずれも次に試す候補です。記録の傾向が近い順に並び、強さの順位ではありません。「試し方を見る」を押すと、この画面に練習のヒントを表示します。</p>
   {commonReason&&<><h3>{result.recommendations.length}体に共通する理由</h3><p>{commonReason}</p></>}
   {result.recommendations.map(row=><section key={row.hero_id} className="candidate-evidence"><h3>{heroName(row.hero_id)}の紹介と記録</h3><p>{guides.heroes[row.hero_id]?.description??"紹介情報はまだ確認できていません。アビリティはゲーム内で確認してください。"}</p><p>{nearReason(row)}</p><p>記録との距離：{row.distance.toFixed(3)}（小さいほど傾向が近い）</p><ul>{row.axis_gaps.map(g=><li key={g.axis}>{simple[g.axis]??g.label}：あなたの記録 {g.player_relative.toFixed(3)} / 比較データ {g.top_relative.toFixed(3)}</li>)}</ul></section>)}
   <p>共通して比べられる範囲：{Math.round(result.coverage*100)}%。欠けた記録を0として補うことはありません。記録：{count??'不明'}試合。</p><p>計算方法のバージョン：<code>{result.formula_version}</code></p>
   <ul>{result.axes.map(a=><li key={a.id}>{simple[a.id]??a.label}：{a.measured?`あなたの相対値 ${a.player_relative.toFixed(3)}`:'未測定'}{a.reason&&` / ${a.reason}`}</li>)}</ul>
   <p>5項目を−1〜+1の尺度で比べます。範囲外の値は上下限に収め、ダメージ参加の目安は中央値で上限に達します。前線での戦い方は被ダメージ・死亡・与ダメージからの推定です。位置や行動の意図を直接測るものではありません。</p>
   <ul>{result.reasons.map(r=><li key={r}>{r}</li>)}{result.warnings?.map(r=><li key={r}>{r}</li>)}</ul><p>{guides.roster_notice}</p>
   <h3>ヒーロー紹介・画像の出典</h3><p>ゲーム素材の保存日：{guides.assets_observed_at} / 公式更新の確認日：{guides.reviewed_at}</p><p>{guides.source_note}</p><p>紹介文は、保存資料をもとに独自に短くまとめたものです。最新の能力値は保証しません。画像は、Deadlock APIの取得済み一覧に載っている配信元から保存しています。</p><a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a><span> / </span><a href={guides.official_changelog} target="_blank" rel="noreferrer">Valve公式更新記録</a>
  </details>
 </section>
}
