import {useEffect,useId,useMemo,useRef,useState} from 'react'
import {heroName} from '../../../../shared/heroes.mjs'
import {TREND_METRICS,buildHeroTrend,lineSegments,monthlyTrendCeiling,trendHeroes,trendHeroId} from '../../../../shared/record-trends.mjs'
import './MatchTrends.css'

const dates = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
const numbers = new Intl.NumberFormat('ja-JP',{maximumFractionDigits:1})
const axisNumbers = new Intl.NumberFormat('ja-JP',{notation:'compact',maximumFractionDigits:1})
const format = value => value === null ? '未取得' : value > 0 && value < .1 ? '0.1未満' : numbers.format(value)
const date = value => dates.format(new Date(value))

function TrendPlot({points,metric,hero,averageCount,ceiling,undated}) {
  const uid = useId(), frame = useRef(null), [width,setWidth] = useState(640)
  const [match,setMatch] = useState(null), [showTable,setShowTable] = useState(false)
  const found = points.findIndex(point => point.row.match_id === match)
  const selected = found < 0 ? points.length-1 : found, point = points[selected]
  useEffect(() => {
    const element = frame.current
    const resize = () => { const value = element?.getBoundingClientRect().width; if (value > 0) setWidth(Math.max(220,Math.round(value))) }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize); observer.observe(element)
    return () => observer.disconnect()
  },[])
  const height = 248, left = 48, right = width-18, top = 24, bottom = height-38
  const x = index => points.length === 1 ? (left+right)/2 : left+index/(points.length-1)*(right-left)
  const y = value => bottom-value/ceiling*(bottom-top)
  const ticks = [...new Set([0,Math.floor((points.length-1)/2),points.length-1])]
  const series = (key,className) => <g className={className}>
    {lineSegments(points.map(item => item[key])).map((segment,index) => <polyline key={index} data-segment={key} points={segment.map(item => `${x(item.index).toFixed(2)},${y(item.value).toFixed(2)}`).join(' ')}/>)}
    {points.map(item => item[key] === null ? null : <circle key={item.row.match_id} data-point={key} cx={x(item.index)} cy={y(item[key])} r={key === 'average'?3:3.5}/>)}
  </g>
  return <>
    <div className="dh-trend-legend"><span className="dh-trend-actual-key">各試合の値</span><span className="dh-trend-average-key">連続5試合の平均（破線）</span></div>
    <div className="dh-trend-plot" ref={frame}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-title ${uid}-desc`} data-axis-maximum={ceiling}>
        <title id={`${uid}-title`}>{hero}の{metric.label}、{points.length}試合</title>
        <desc id={`${uid}-desc`}>古い試合から等間隔。未取得の値は空白で、線をつなぎません。5試合平均の表示点は{averageCount}点です。下の試合選択と数値一覧で値を確認できます。</desc>
        {[0,ceiling/2,ceiling].map(value => <g key={value} className="dh-trend-gridline"><line x1={left} x2={right} y1={y(value)} y2={y(value)}/><text x={left-8} y={y(value)+4} textAnchor="end">{axisNumbers.format(value)}</text></g>)}
        <text className="dh-trend-unit" x={left} y={14}>{metric.unit}</text>
        <line className="dh-trend-cursor" x1={x(selected)} x2={x(selected)} y1={top} y2={bottom}/>
        {series('average','dh-trend-average')}{series('value','dh-trend-actual')}
        {point.value !== null && <circle className="dh-trend-selected" cx={x(selected)} cy={y(point.value)} r="6"/>}
        {ticks.map(index => <text className="dh-trend-tick" key={index} x={x(index)} y={bottom+24} textAnchor="middle">#{index+1}</text>)}
      </svg>
    </div>
    <div className="dh-trend-inspector">
      <label htmlFor={`${uid}-match`}>確認する試合 <strong>#{selected+1} / {points.length}</strong></label>
      <input id={`${uid}-match`} type="range" min="1" max={points.length} step="1" value={selected+1} disabled={points.length === 1}
        aria-label="確認する試合（古い順）" aria-valuetext={`第${selected+1}試合、${date(point.row.started_at)} JST、${metric.label} ${format(point.value)}`}
        onChange={event => setMatch(points[Number(event.target.value)-1].row.match_id)}/>
      <div className="dh-trend-readout" aria-live="polite" aria-atomic="true">
        <p><time dateTime={point.row.started_at}>{date(point.row.started_at)} JST</time><small>試合ID {point.row.match_id}</small></p>
        <dl><div><dt>{metric.label}</dt><dd data-selected-value>{format(point.value)}{point.value !== null && <small>{metric.unit}</small>}</dd></div>
          <div><dt>連続5試合の平均</dt><dd data-selected-average>{point.average === null ? '—' : format(point.average)}{point.average !== null && <small>{metric.unit}</small>}</dd></div></dl>
        {point.average === null && <p className="dh-trend-average-reason">{undated?'平均なし：開始日時不明の記録があり、連続した試合順を確定できません。':'平均なし：5試合未満、または連続5試合に未取得の値が含まれます。'}</p>}
      </div>
    </div>
    <details className="dh-trend-values" onToggle={event => setShowTable(event.currentTarget.open)}>
      <summary>数値一覧を見る（{points.length}試合）</summary>
      {showTable && <div className="dh-trend-table-scroll" tabIndex={0} role="region" aria-label="試合の数値一覧。狭い画面では横にスクロールできます">
        <table><caption>{hero}・{metric.label}。小数は1桁表示、計算には丸める前の値を使用。「—」は平均の算出条件を満たさない試合です。</caption>
          <thead><tr><th scope="col">試合順</th><th scope="col">開始日時（JST）</th><th scope="col">{metric.label}</th><th scope="col">5試合平均</th></tr></thead>
          <tbody>{points.map(item => <tr key={item.row.match_id}><th scope="row">#{item.index+1}<small>ID {item.row.match_id}</small></th><td>{date(item.row.started_at)}</td><td>{format(item.value)}</td><td>{item.average === null?'—':format(item.average)}</td></tr>)}</tbody>
        </table>
      </div>}
    </details>
  </>
}

export default function MatchTrends({rows,month,pending=false,readFailed=false,observedCount,onMove,canPrevious=true,canNext=true}) {
  const uid = useId(), [hero,setHero] = useState(null), [metricId,setMetricId] = useState('kills')
  const heroes = useMemo(() => trendHeroes(rows),[rows])
  const selected = heroes.find(item => item.id === hero) ?? heroes[0]
  const metric = TREND_METRICS.find(item => item.id === metricId)
  const result = useMemo(() => selected ? buildHeroTrend(rows,{month,heroId:selected.id,metric:metricId}) : null,[rows,month,selected,metricId])
  const ceiling = useMemo(() => monthlyTrendCeiling(rows,{month,metric:metricId}),[rows,month,metricId])
  const unknown = rows.filter(row => trendHeroId(row.hero_id) === null).length
  const [year,monthIndex] = month.split('-').map(Number), points = result?.points ?? []
  return <section className="dh-panel dh-trends" aria-labelledby={`${uid}-heading`} aria-busy={pending}>
    <header className="dh-trend-heading"><div><p className="dh-label">MATCH TRENDS</p><h2 id={`${uid}-heading`}>ヒーロー別の推移</h2></div>
      <div className="dh-trend-month"><button type="button" aria-label="グラフの前の月" onClick={() => onMove(-1)} disabled={!canPrevious}>‹</button><strong>{year}年{monthIndex}月</strong><button type="button" aria-label="グラフの次の月" onClick={() => onMove(1)} disabled={!canNext}>›</button></div>
    </header>
    <p className="dh-trend-scope">カレンダーと同じ月（JST）の保存済み試合が対象です。全履歴ではなく、取得できた記録だけを表示します。</p>
    {pending||readFailed ? <p role="status">{readFailed?'この月の保存済み記録を読み込めませんでした。記録がないことを示すものではありません。月を切り替えて再確認してください。':'この月の記録を読み込み中…'}</p> : <>
      <p className="dh-trend-count">この月：{rows.length}試合{Number.isInteger(observedCount)?` / 保存済み全期間：${observedCount}試合`:''}{selected?` ・ 選択ヒーロー：${points.length}試合`:''}</p>
      {unknown > 0 && <p className="dh-trend-note">ヒーロー未取得の{unknown}試合は、この比較の対象外です。日別記録には表示されます。</p>}
      {!selected ? <p className="dh-trend-empty">{rows.length === 0?'この月の保存済み記録はありません。月を切り替えると、その月の記録を確認できます。':'この月にはヒーローを判別できる記録がありません。'}</p> : <>
        <div className="dh-trend-controls"><label className="dh-trend-hero" htmlFor={`${uid}-hero`}>ヒーロー<select id={`${uid}-hero`} value={selected.id} onChange={event => setHero(event.target.value)}>
          {heroes.map(item => <option key={item.id} value={item.id}>{heroName(item.id)}（{item.count}試合）</option>)}
        </select></label>
          <div className="dh-trend-metrics" role="group" aria-label="表示する指標">{TREND_METRICS.map(item => <button type="button" key={item.id} aria-pressed={metricId===item.id} onClick={() => setMetricId(item.id)}>{item.short}</button>)}</div>
        </div>
        <h3 className="dh-trend-chart-title">{heroName(selected.id)} <span>／ {metric.label}</span></h3>
        {points.length > 0 ? <>
          <p className="dh-trend-range">表示範囲：{date(points[0].row.started_at)} ～ {date(points.at(-1).row.started_at)}（JST）</p>
          <p className="dh-trend-note">{points.length}試合中、{metric.label}が未取得：{result.missing}試合 ・ 5試合平均の表示点：{result.averages}点</p>
          {result.undated > 0 && <p className="dh-trend-note">開始日時不明の{result.undated}試合は描画できないため、平均も表示しません。</p>}
          {result.missing === points.length && <p className="dh-trend-empty">この指標はすべて未取得です。0として描画していません。</p>}
          <TrendPlot key={`${month}:${selected.id}`} points={points} metric={metric} hero={heroName(selected.id)} averageCount={result.averages} ceiling={ceiling} undated={result.undated}/>
        </> : <p className="dh-trend-empty">この月に開始日時を確認できる試合がありません。</p>}
      </>}
    </>}
    <div className="dh-trend-method">
      <p>横軸は選択ヒーローの試合開始が古い順の試合番号です。点の間隔は等しく、経過時間の長さは表しません。同時刻は試合ID順。日時は日本時間（JST）です。</p>
      <p>縦軸は0から始まります。同じ月・同じ指標ではヒーロー間で目盛りを揃え、切り替えて比較できます。</p>
      <p>K / D / A は比率ではなく、キル・デス・アシストの回数です。分間ダメージは保存済みの敵ヒーローへのダメージ ÷ 試合時間（秒）× 60。時間が0・未取得の場合も欠損とします。ダメージは最終スナップショットのため、試合終了時点まで揃わない場合があります。</p>
      <p>平均は選択ヒーローの、この月内の連続5試合の単純平均です。5試合未満、または対象の指標に1件でも欠損がある区間は表示せず、古い試合で補いません。分間ダメージも各試合の分間値を平均します。欠損は線を途切れさせ、実際の0は0として表示します。</p>
      <p>試合ごとの状況は異なります。数値の上下だけで、上達や実力は判断できません。</p>
    </div>
  </section>
}
