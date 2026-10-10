import {heroName} from '../../../shared/heroes.mjs'
import guides from '../../../shared/hero-guides.json'
const simple={gank_pick:'敵を倒す場面への関わり方',farm_growth:'育ち方',damage_output:'ダメージの出し方',frontline:'前線での戦い方の目安',support_team:'味方との戦闘への関わり方'}
function nearReason(row){
 const gaps=row.axis_gaps.filter(g=>Number.isFinite(g.squared_gap)&&g.squared_gap>=0).slice().sort((a,b)=>a.squared_gap-b.squared_gap).slice(0,2)
 return gaps.length?`あなたの記録と、${gaps.map(g=>simple[g.axis]??g.label).join('・')}が近い参考候補です。`:row.reason
}
export default function FiveAxisSummary({result,evidence}){
 if(!result)return null
 const count=evidence?.collection?.metadata_requests??evidence?.local_history?.rows?.length??evidence?.collection?.history_retained
 return <section aria-label="5軸の独立試案" className="five-axis">
  <h2>次に試してみるヒーロー</h2>
  <p>少数の記録から選んだ参考候補です。強さや相性を保証するものではありません。</p>
  {evidence?.collection?.cache_status==='expired'&&<p>期限切れの保存データを使っています。</p>}
  {result.status==='ready'?<ol className="hero-candidates">{result.recommendations.map(row=>{const guide=guides.heroes[row.hero_id];return <li key={row.hero_id}>
   <h3>{heroName(row.hero_id)}</h3><p>{guide?.description??'このヒーローの紹介文は、出典の確認後に追加します。'}</p><p>{nearReason(row)}</p>
   <details><summary>詳しく見る：候補との比較</summary><p>距離：{row.distance.toFixed(3)}（小さいほど記録の傾向が近い）</p><ul>{row.axis_gaps.map(g=><li key={g.axis}>{g.label}：本人 {g.player_relative.toFixed(3)} / 比較対象 {g.top_relative.toFixed(3)}</li>)}</ul></details>
   {guide&&<details><summary>紹介文の出典・確認日</summary><p>ゲームassets保存日：{guide.assets_observed_at} / 公式更新確認日：{guide.reviewed_at}</p><a href={guide.source} target="_blank" rel="noreferrer">ゲームassets配信元</a> / <a href={guides.official_changelog} target="_blank" rel="noreferrer">Valve公式更新記録</a><p>{guides.source_note}</p></details>}
  </li>})}</ol>:<p role="status">比較に必要な記録が足りないため、候補をまだ選べません。</p>}
  <details><summary>詳しく見る：計算と比較の限界</summary>
   <p>共通に比較できる範囲：{Math.round(result.coverage*100)}%。欠けた記録をゼロとして補いません。記録：{count??'不明'}試合。</p><p>モデル：<code>{result.formula_version}</code></p>
   <ul>{result.axes.map(a=><li key={a.id}>{a.label}：{a.measured?`本人の相対値 ${a.player_relative.toFixed(3)}`:'未測定'}{a.reason&&` / ${a.reason}`}</li>)}</ul>
   <p>5軸を−1〜+1の尺度で比較します。極端値はクリップし、ダメージ参加の目安は中央値で飽和します。前線維持は被ダメージ・死亡・与ダメージからの推定で、位置や行動意図を直接観測しません。</p>
   <ul>{result.reasons.map(r=><li key={r}>{r}</li>)}{result.warnings?.map(r=><li key={r}>{r}</li>)}</ul><p>{guides.roster_notice}</p>
  </details>
 </section>
}
