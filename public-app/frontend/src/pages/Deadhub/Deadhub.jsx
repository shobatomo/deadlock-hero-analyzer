import {useCallback,useEffect,useId,useRef,useState} from 'react'
import {heroName} from '../../../../shared/heroes.mjs'
import {tokyoDay,shiftMonth,dayState,daySummary} from '../../../../shared/deadhub.mjs'
import {trendHeroes,trendHeroId} from '../../../../shared/record-trends.mjs'
import HeroPortrait from '../../components/HeroPortrait'
import SteamProfile from './SteamProfile'
import MatchTrends from './MatchTrends'
import FinalItems from './FinalItems'
import SyncRunDetails from './SyncRunDetails'
import {safeSteamProfile} from '../../../../shared/steam-profile.mjs'
import './Deadhub.css'

const dateTime=value=>value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'未同期'
const clock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const number=value=>value==null?'未取得':value.toLocaleString('ja-JP')
const total=(value,partialLabel='取得')=>value.known===0?'未取得':`${number(value.value)}${value.known<value.total?`（${partialLabel} ${value.known}/${value.total} 試合分）`:''}`
const stateLabel={recorded:'記録あり',empty:'照会済み・記録なし',unsynced:'未同期・未確認',failed:'取得失敗・未確認',initial:'初回同期中',loading:'この月を読み込み中',read_failed:'記録の読取り失敗'}
const stateDescription={
  empty:'照会したデータには、この日の試合がありません。提供元に未収録の可能性があり、プレイしていないことを示すものではありません。',
  unsynced:'この日全体の照会はまだ終わっていません。記録の有無は未確認です。',
  failed:'取得に失敗したため、この日の記録の有無は未確認です。保存済みの記録は引き続き表示します。',
  initial:'初回同期中です。この日の記録の有無はまだ確認できていません。',
  loading:'この月の保存済み記録を読み込んでいます。',
  read_failed:'この月の保存済み記録を読み込めませんでした。記録がないことを示すものではありません。月を切り替えて再確認してください。'
}
async function request(path,{signal,...options}={}) {
  const response=await fetch('/api/deadhub/'+path,{credentials:'same-origin',cache:'no-store',signal,
    ...options,...(options.method?{headers:{'Content-Type':'application/json'},body:'{}'}:{})})
  let data;try{data=await response.json()}catch{throw Error('サーバーの応答を確認できませんでした。')}
  if(!response.ok){const error=Error(data.error??'取得に失敗しました。');error.code=data.code;throw error}
  return data
}
function Match({row,showDate=false}) {
  return <li className="dh-match">
    <div className="dh-match-head"><div aria-hidden="true"><HeroPortrait key={row.hero_id??'unknown'} id={row.hero_id} className="dh-hero-portrait"/></div>
      <div className="dh-match-heading"><time dateTime={row.started_at}>{showDate?`${dateTime(row.started_at)} JST`:clock(row.started_at)}</time><strong>{row.hero_id==null?'ヒーロー未取得':heroName(row.hero_id)}</strong></div>
      <span>{row.won==null?'勝敗未取得':row.won?'勝利':'敗北'}</span></div>
    <dl><div><dt>キル / デス / アシスト</dt><dd>{number(row.kills)} / {number(row.deaths)} / {number(row.assists)}</dd></div>
      <div><dt>与ダメージ<span className="dh-metric-detail">（対プレイヤー）</span></dt><dd>{number(row.hero_damage)}</dd></div>
      <div><dt>回復量 <small className="dh-metric-source">API提供値</small></dt><dd>{number(row.player_healing)}</dd></div>
      <div><dt>試合時間</dt><dd>{row.duration_s==null?'未取得':`${Math.floor(row.duration_s/60)}分${row.duration_s%60}秒`}</dd></div></dl>
    <small>試合ID {row.match_id}</small>
    <FinalItems items={row.final_items}/>
  </li>
}
export default function Deadhub() {
  const today=tokyoDay(Date.now()), currentMonth=today.slice(0,7)
  const [month,setMonth]=useState(currentMonth),[selected,setSelected]=useState(today)
  const [listHero,setListHero]=useState(''),listId=useId()
  const [config,setConfig]=useState(null),[view,setView]=useState(null),[authState,setAuthState]=useState('checking')
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[now,setNow]=useState(Date.now())
  const active=useRef(false)
  const [syncRevision,setSyncRevision]=useState(0)
  const [recordsError,setRecordsError]=useState(null)
  const records=useRef({month:currentMonth,request:0,controller:null,mounted:false})
  useEffect(()=>{
    records.current.mounted=true
    return()=>{records.current.mounted=false;records.current.request++;records.current.controller?.abort()}
  },[])
  const [profile,setProfile]=useState(null)
  const steamId=authState==='signed_in'?view?.identity?.steam_id:null
  useEffect(()=>{
    if(!steamId)return
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),3500)
    setProfile(null)
    request('profile',{signal:control.signal}).then(data=>{if(!control.signal.aborted)setProfile(safeSteamProfile(data.profile,steamId))}).catch(()=>{}).finally(()=>clearTimeout(timer))
    return()=>{clearTimeout(timer);control.abort()}
  },[steamId])
  // A stable callback reads the selected month at invocation, including after sync.
  const load=useCallback(async({poll=false}={})=>{
    const state=records.current
    if(!state.mounted||(poll&&state.controller))return
    state.controller?.abort()
    const control=new AbortController(),generation=++state.request,requestedMonth=state.month
    state.controller=control
    setRecordsError(null)
    const stale=()=>control.signal.aborted||!state.mounted||generation!==state.request
    try {const data=await request('records?month='+requestedMonth,{signal:control.signal});if(stale())return;setView(data);setAuthState('signed_in')}
    catch(e){if(stale())return;if(e.code==='unauthorized'){setView(null);setAuthState('signed_out')}else setRecordsError({month:requestedMonth,message:e.message})}
    finally{if(state.controller===control)state.controller=null}
  },[])
  useEffect(()=>{const control=new AbortController();request('config',{signal:control.signal}).then(setConfig).catch(e=>{if(!control.signal.aborted)setError(e.message)});return()=>control.abort()},[])
  useEffect(()=>{if(config?.enabled)load()},[config,month,load])
  const remoteBusy=view?.account?.sync_status==='running'
  useEffect(()=>{
    if(!busy&&!remoteBusy)return
    const timer=setInterval(()=>load({poll:true}),3000)
    // load owns cancellation; stopping polling must not abort a newer refresh.
    return()=>clearInterval(timer)
  },[busy,remoteBusy,load])
  const cooldown=Math.max(0,Math.ceil((new Date(view?.account?.retry_after??0).getTime()-now)/1000))
  useEffect(()=>{if(!cooldown)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[cooldown])
  async function login() {
    if(active.current)return;active.current=true;setBusy(true);setError('')
    try{const {url}=await request('auth/login',{method:'POST'});window.location.assign(url)}
    catch(e){setError(e.message);setBusy(false);active.current=false}
  }
  async function update(register=false) {
    if(active.current)return;active.current=true;setBusy(true);setError('');setMessage(register?'初回同期中です。過去30日の記録を確認しています。':'最新の記録を取得しています。')
    try{const result=await request(register?'register':'sync',{method:'POST'});setMessage(result.status==='partial'?'今回の取得上限に達しました。保存済みの記録を表示しています。続きは次の更新で照会します。':'提供元の保存済みデータを確認しました。未収録の試合や未取得の項目が残る場合があります。')}
    catch(e){setMessage('');setError(e.message)}
    finally{await load();setNow(Date.now());setBusy(false);active.current=false;if(records.current.mounted)setSyncRevision(value=>value+1)}
  }
  async function logout() {
    try{await request('auth/logout',{method:'POST'});setView(null);setAuthState('signed_out');setError('');setRecordsError(null);setMessage('')}
    catch(e){setError(e.message)}
  }
  function move(step) {
    const state=records.current,next=shiftMonth(state.month,step)
    if(next<'2020-01'||next>currentMonth)return
    // Invalidate immediately, including A -> B -> A and responses ignoring abort.
    state.month=next;state.request++;state.controller?.abort()
    setMonth(next);setSelected(next===currentMonth?today:next+'-01')
  }
  const account=view?.account, rows=view?.month===month?view.matches:[], daily=rows.filter(r=>tokyoDay(r.started_at)===selected),summary=daySummary(daily)
  // Only this month's snapshot is loaded. Reuse the graph's hero identity rules;
  // its hero/metric selection remains independent of the record list.
  const listHeroes=trendHeroes(rows),unknownHeroes=rows.filter(row=>trendHeroId(row.hero_id)===null).length
  const listRows=listHero?rows.filter(row=>listHero==='unknown'?trendHeroId(row.hero_id)===null:trendHeroId(row.hero_id)===listHero):daily
  const listHeroName=listHero==='unknown'?'ヒーロー未取得':heroName(listHero)
  const [year,index]=month.split('-').map(Number), days=new Date(Date.UTC(year,index,0)).getUTCDate()
  const offset=new Date(Date.UTC(year,index-1,1)).getUTCDay()
  const monthPending=view?.month!==month
  const monthReadFailed=monthPending&&recordsError?.month===month
  const pendingState=monthReadFailed?'read_failed':'loading'
  const selectedState=monthPending?pendingState:dayState(selected,rows,account)
  const displayError=recordsError?.message||error
  return <main className="deadhub" id="main-content" tabIndex={-1}>
    <div className="dh-title"><div><p className="eyebrow">DEADLOCK PLAY RECORDS</p><h1>遊んだ日を、見返そう。</h1><p>Deadlockの日々の試合記録。日付はすべて日本時間です。</p></div></div>
    {displayError&&<p className="dh-alert" role="alert">{displayError}</p>}
    {new URLSearchParams(window.location.search).get('login')==='failed'&&authState!=='signed_in'&&<p role="alert" className="dh-alert">Steamログインを確認できませんでした。許可されたアカウントで、もう一度お試しください。</p>}
    {config?.enabled===false ? <section className="dh-panel"><h2>接続準備中</h2><p>所有者ログインと記録用データベースの設定を待っています。</p></section> : authState!=='signed_in' ?
      <section className="dh-panel dh-signin"><h2>Steamでログイン</h2><p>本人確認後、このSteamアカウントを記録対象として登録できます。</p><p>招待されたアカウントだけが利用できます。記録は本人だけが閲覧できます。パスワードの入力はSteam公式画面で行います。</p>
        <button className="dh-primary" onClick={login} disabled={busy||!config?.enabled||authState==='checking'}>{busy?'Steamを開いています…':'Steamでログインする'}</button>
        {authState==='checking'&&config?.enabled&&<p role="status">ログイン状態を確認しています…</p>}
      </section> : <>
      <section className="dh-panel dh-account" aria-label="登録と同期">
        <div className="dh-account-main"><SteamProfile steamId={steamId} profile={profile}/>
          <p>最終照会成功：{dateTime(account?.last_success_at)}</p>
          <p>{view?.sync_mode==='daily'?'毎朝の自動取得と手動更新が利用できます。':'記録は手動で更新します。自動取得はありません。'}</p></div>
        <div className="dh-actions">{account?<button className="dh-primary" onClick={()=>update()} disabled={busy||remoteBusy||cooldown>0||account.sync_paused}>
          {account.sync_paused?'更新を停止中':busy||remoteBusy?'記録を取得中…':cooldown>0?`再取得まで ${cooldown} 秒`:'最新の記録を取得'}</button>:<button className="dh-primary" onClick={()=>update(true)} disabled={busy}>{busy?'初回同期中…':'このアカウントを登録して過去30日を取得'}</button>}
          <button className="dh-secondary" onClick={logout} disabled={busy}>ログアウト</button></div>
        {account?.sync_paused&&<p className="dh-muted">提供元の待機指定により更新を停止しています。再開には管理者の確認が必要です。</p>}
        <div className="dh-sync-note" role="status">{message||((busy||remoteBusy)?(!account?.last_success_at?'初回同期中です。':'記録を取得しています。'):account?.sync_status==='partial'?'未取得の続きがあります。次の更新で再開します。':account?.sync_status==='interrupted'?'前回の同期が中断されました。次の更新で再開します。':account?.sync_status==='error'?'前回の取得に失敗しました。保存済みの記録を表示しています。':account?'保存済みの記録を表示しています。':'登録すると初回同期を開始します。')}</div>
        <SyncRunDetails key={steamId} revision={syncRevision}/>
      </section>
      {account&&<>
      <div className="dh-layout">
        <section className="dh-panel dh-calendar" aria-label="プレイ記録カレンダー">
          <header className="dh-section-heading dh-calendar-heading"><div><p className="dh-label">PLAY CALENDAR</p><h2>プレイカレンダー</h2></div><p>日付から記録を確認</p></header>
          <div className="dh-month"><button aria-label="前の月" onClick={()=>move(-1)} disabled={month==='2020-01'}>‹</button><h3>{year}年{index}月</h3><button aria-label="次の月" onClick={()=>move(1)} disabled={month===currentMonth}>›</button></div>
          <div className="dh-grid"><div className="dh-week" aria-hidden="true">{['日','月','火','水','木','金','土'].map(d=><span key={d}>{d}</span>)}</div>
            {Array.from({length:offset},(_,i)=><span key={'blank'+i} aria-hidden="true"/>)}
            {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`,state=monthPending?pendingState:dayState(day,rows,account),count=rows.filter(r=>tokyoDay(r.started_at)===day).length
              return <button key={day} className={`dh-day dh-${state}`} aria-label={`${day} ${stateLabel[state]}${count?` ${count}試合`:''}`} aria-pressed={selected===day} onClick={()=>{setSelected(day);setListHero('')}}><span>{i+1}</span></button>})}
          </div>
          <div className="dh-legend"><span><i className="dh-dot recorded"/>記録あり</span><span><i className="dh-dot unsynced"/>記録の表示なし</span></div>
          <p className="dh-muted">色は保存済みの記録の有無を表します。記録が表示されない日は、プレイしていないとは限りません。日付を選ぶと取得状況を確認できます。勝敗や成績による色分けはありません。</p>
        </section>
        <section className="dh-detail" aria-label="日別サマリーと試合一覧">
          <div className="dh-panel dh-day-summary">
          <header className="dh-section-heading"><div><p className="dh-label">日別サマリー</p><h2>{Number(selected.slice(5,7))}月{Number(selected.slice(8))}日の記録</h2></div></header>
          {daily.length?<><p>{summary.count}試合を取得 · {summary.wins}勝 {summary.losses}敗{summary.unknown>0?` · 勝敗未取得 ${summary.unknown}試合`:''}</p>
            <dl className="dh-totals">{[['kills','キル'],['deaths','デス'],['assists','アシスト'],['hero_damage','与ダメージ（対プレイヤー）']].map(([key,label])=><div key={key} className={key==='hero_damage'?'dh-total-wide':undefined}><dt>{label}</dt><dd>{total(summary[key])}</dd></div>)}
              <div className="dh-total-wide"><dt>回復量 <small className="dh-metric-source">API提供値</small></dt><dd>{total(summary.player_healing,'部分合計 · 取得')}</dd></div></dl>
            </>:
            <div className="dh-empty"><strong>{stateLabel[selectedState]}</strong><p>{stateDescription[selectedState]}</p></div>}
          </div>
          <section className="dh-panel dh-match-section" aria-label="試合一覧" aria-busy={monthPending&&!monthReadFailed}>
            <header className="dh-section-heading"><div><p className="dh-label">MATCH LIST</p><h3>試合一覧</h3></div></header>
            <p id={listId+'-scope'} className="dh-list-scope">対象：{year}年{index}月の保存済み記録（JST）。全履歴ではありません。別の月はカレンダーで切り替えてください。</p>
            <div className="dh-list-controls">
              <label htmlFor={listId+'-hero'}>一覧のヒーロー<select id={listId+'-hero'} value={listHero} disabled={monthPending} aria-describedby={listId+'-scope'} onChange={event=>setListHero(event.target.value)}>
                <option value="">{Number(selected.slice(5,7))}月{Number(selected.slice(8))}日（絞り込みなし）</option>
                {listHeroes.map(hero=><option key={hero.id} value={hero.id}>{heroName(hero.id)}（月内{hero.count}試合）</option>)}
                {listHero&&listHero!=='unknown'&&!listHeroes.some(hero=>hero.id===listHero)&&<option value={listHero}>{listHeroName}（{monthReadFailed?'読取り失敗':monthPending?'読み込み中':'この月は0試合'}）</option>}
                {(unknownHeroes>0||listHero==='unknown')&&<option value="unknown">ヒーロー未取得{monthPending?'':`（月内${unknownHeroes}試合）`}</option>}
              </select></label>
              <button type="button" onClick={()=>setListHero('')} disabled={!listHero||monthPending}>絞り込みを解除</button>
            </div>
            <p className="dh-list-hint">ヒーローを選ぶと月内の日付をまたいで表示します。カレンダーの日付を選ぶと日別表示に戻ります。</p>
            <p className="dh-list-count" role="status">{monthReadFailed?stateDescription.read_failed:monthPending?'この月の記録を読み込み中…':`${listHero?`${listHeroName} · ${year}年${index}月`:`${Number(selected.slice(5,7))}月${Number(selected.slice(8))}日`}：${listRows.length}試合 / この月の保存済み記録 ${rows.length}試合`}</p>
            {!monthPending&&(listRows.length>0?<ul className="dh-matches">{listRows.map(row=><Match key={row.match_id} row={row} showDate={Boolean(listHero)}/>)}</ul>:<p className="dh-list-empty">{listHero?'この月の保存済み記録に、該当する試合はありません。絞り込みを解除するか、別の月を選んでください。':'選択日の保存済み記録はありません。ヒーローを選ぶと、この月の別の日も確認できます。'}</p>)}
          </section>
        </section>
      </div>
      <MatchTrends rows={rows} month={month} pending={monthPending&&!monthReadFailed} readFailed={monthReadFailed} observedCount={view.observed.count} onMove={move} canPrevious={month!=='2020-01'} canNext={month!==currentMonth}/>
      <section className="dh-panel dh-coverage" aria-label="照会範囲">
        <h2>照会した範囲</h2><p>照会した期間：{account.coverage_from?`${dateTime(account.coverage_from)} 〜 ${dateTime(account.coverage_until)}`:'まだ確定していません'}</p>
        <p>この範囲は提供元の保存済みデータを確認した期間です。全試合・全項目の取得完了を示すものではありません。</p>
        <p>保存済み：{view.observed.count}試合{view.observed.first?`（${dateTime(view.observed.first)} 〜 ${dateTime(view.observed.last)}）`:''}</p>
        <p>提供元に保存されたランク・通常マッチが対象です。全試合の取得は保証されません。未取得の項目は0として数えません。</p>
        <p>与ダメージはAPIの <code>final_stats.player_damage</code>（対プレイヤーの最終スナップショット）です。試合終了時点まで揃わない場合があります。</p>
        <p>回復量はAPI提供値です。提供元の最終スナップショットを表示し、試合終了時点まで揃わない場合があります。</p>
        <p>{view?.sync_mode==='daily'?'自動取得は毎朝6時台（JST）を予定。最終照会成功の時刻は上部に表示します。':'「最新の記録を取得」から手動で更新してください。'}直近7日を再照会し、途中の取得は次回に続けます。</p>
      </section>
      </>}
      </>}
  </main>
}
