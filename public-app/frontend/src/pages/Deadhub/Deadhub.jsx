import {useCallback,useEffect,useRef,useState} from 'react'
import {heroName} from '../../../../shared/heroes.mjs'
import {tokyoDay,shiftMonth,dayState,daySummary} from '../../../../shared/deadhub.mjs'
import HeroPortrait from '../../components/HeroPortrait'
import SteamProfile from './SteamProfile'
import MatchTrends from './MatchTrends'
import FinalItems from './FinalItems'
import {safeSteamProfile} from '../../../../shared/steam-profile.mjs'
import './Deadhub.css'

const dateTime=value=>value?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'未同期'
const clock=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(value))
const number=value=>value==null?'未取得':value.toLocaleString('ja-JP')
const total=value=>value.known===0?'未取得':`${number(value.value)}${value.known<value.total?`（取得 ${value.known}/${value.total} 試合分）`:''}`
const stateLabel={recorded:'記録あり',empty:'取得済みデータ上は記録なし',unsynced:'未同期・未確認',failed:'取得失敗・未確認',initial:'初回同期中',loading:'この月を読み込み中'}
async function request(path,{signal,...options}={}) {
  const response=await fetch('/api/deadhub/'+path,{credentials:'same-origin',cache:'no-store',signal,
    ...options,...(options.method?{headers:{'Content-Type':'application/json'},body:'{}'}:{})})
  let data;try{data=await response.json()}catch{throw Error('サーバーの応答を確認できませんでした。')}
  if(!response.ok){const error=Error(data.error??'取得に失敗しました。');error.code=data.code;throw error}
  return data
}
function Match({row}) {
  return <li className="dh-match">
    <div className="dh-match-head"><div aria-hidden="true"><HeroPortrait key={row.hero_id??'unknown'} id={row.hero_id} className="dh-hero-portrait"/></div>
      <div className="dh-match-heading"><time dateTime={row.started_at}>{clock(row.started_at)}</time><strong>{row.hero_id==null?'ヒーロー未取得':heroName(row.hero_id)}</strong></div>
      <span>{row.won==null?'勝敗未取得':row.won?'勝利':'敗北'}</span></div>
    <dl><div><dt>キル / デス / アシスト</dt><dd>{number(row.kills)} / {number(row.deaths)} / {number(row.assists)}</dd></div>
      <div><dt>与ダメージ（対プレイヤー）</dt><dd>{number(row.hero_damage)}</dd></div>
      <div><dt>試合時間</dt><dd>{row.duration_s==null?'未取得':`${Math.floor(row.duration_s/60)}分${row.duration_s%60}秒`}</dd></div></dl>
    <small>試合ID {row.match_id}</small>
    <FinalItems items={row.final_items}/>
  </li>
}
export default function Deadhub() {
  const today=tokyoDay(Date.now()), currentMonth=today.slice(0,7)
  const [month,setMonth]=useState(currentMonth),[selected,setSelected]=useState(today)
  const [config,setConfig]=useState(null),[view,setView]=useState(null),[authState,setAuthState]=useState('checking')
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[now,setNow]=useState(Date.now())
  const active=useRef(false)
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
    const stale=()=>control.signal.aborted||!state.mounted||generation!==state.request
    try {const data=await request('records?month='+requestedMonth,{signal:control.signal});if(stale())return;setView(data);setAuthState('signed_in')}
    catch(e){if(stale())return;if(e.code==='unauthorized'){setView(null);setAuthState('signed_out')}else setError(e.message)}
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
    try{const result=await request(register?'register':'sync',{method:'POST'});setMessage(result.status==='partial'?'今回の取得上限に達しました。保存済みの記録を表示しています。残りは次の更新で取得します。':'更新が完了しました。')}
    catch(e){setMessage('');setError(e.message)}
    finally{await load();setNow(Date.now());setBusy(false);active.current=false}
  }
  async function logout() {
    try{await request('auth/logout',{method:'POST'});setView(null);setAuthState('signed_out');setError('');setMessage('')}
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
  const [year,index]=month.split('-').map(Number), days=new Date(Date.UTC(year,index,0)).getUTCDate()
  const offset=new Date(Date.UTC(year,index-1,1)).getUTCDay()
  const monthPending=view?.month!==month
  const selectedState=monthPending?'loading':dayState(selected,rows,account)
  return <main className="deadhub" id="main-content" tabIndex={-1}>
    <div className="dh-title"><div><p className="eyebrow">DEADLOCK PLAY RECORDS</p><h1>遊んだ日を、見返そう。</h1><p>Deadlockの日々の試合記録。日付はすべて日本時間です。</p></div></div>
    {error&&<p className="dh-alert" role="alert">{error}</p>}
    {new URLSearchParams(window.location.search).get('login')==='failed'&&authState!=='signed_in'&&<p role="alert" className="dh-alert">Steamログインを確認できませんでした。許可されたアカウントで、もう一度お試しください。</p>}
    {config?.enabled===false ? <section className="dh-panel"><h2>接続準備中</h2><p>所有者ログインと記録用データベースの設定を待っています。</p></section> : authState!=='signed_in' ?
      <section className="dh-panel dh-signin"><h2>Steamでログイン</h2><p>本人確認後、このSteamアカウントを記録対象として登録できます。</p><p>招待されたアカウントだけが利用できます。記録は本人だけが閲覧できます。パスワードの入力はSteam公式画面で行います。</p>
        <button className="dh-primary" onClick={login} disabled={busy||!config?.enabled||authState==='checking'}>{busy?'Steamを開いています…':'Steamでログインする'}</button>
        {authState==='checking'&&config?.enabled&&<p role="status">ログイン状態を確認しています…</p>}
      </section> : <>
      <section className="dh-panel dh-account" aria-label="登録と同期">
        <div className="dh-account-main"><SteamProfile steamId={steamId} profile={profile}/>
          <p>最終同期：{dateTime(account?.last_success_at)}</p>
          <p>{view?.sync_mode==='daily'?'毎朝の自動取得と手動更新が利用できます。':'記録は手動で更新します。自動取得はありません。'}</p></div>
        <div className="dh-actions">{account?<button className="dh-primary" onClick={()=>update()} disabled={busy||remoteBusy||cooldown>0||account.sync_paused}>
          {account.sync_paused?'更新を停止中':busy||remoteBusy?'記録を取得中…':cooldown>0?`再取得まで ${cooldown} 秒`:'最新の記録を取得'}</button>:<button className="dh-primary" onClick={()=>update(true)} disabled={busy}>{busy?'初回同期中…':'このアカウントを登録して過去30日を取得'}</button>}
          <button className="dh-secondary" onClick={logout} disabled={busy}>ログアウト</button></div>
        {account?.sync_paused&&<p className="dh-muted">提供元の待機指定により更新を停止しています。再開には管理者の確認が必要です。</p>}
        <div className="dh-sync-note" role="status">{message||((busy||remoteBusy)?(!account?.last_success_at?'初回同期中です。':'記録を取得しています。'):account?.sync_status==='partial'?'未取得の続きがあります。次の更新で再開します。':account?.sync_status==='interrupted'?'前回の同期が中断されました。次の更新で再開します。':account?.sync_status==='error'?'前回の取得に失敗しました。保存済みの記録を表示しています。':account?'保存済みの記録を表示しています。':'登録すると初回同期を開始します。')}</div>
      </section>
      {account&&<>
      <div className="dh-layout">
        <section className="dh-panel dh-calendar" aria-label="プレイ記録カレンダー">
          <div className="dh-month"><button aria-label="前の月" onClick={()=>move(-1)} disabled={month==='2020-01'}>‹</button><h2>{year}年{index}月</h2><button aria-label="次の月" onClick={()=>move(1)} disabled={month===currentMonth}>›</button></div>
          <div className="dh-grid"><div className="dh-week" aria-hidden="true">{['日','月','火','水','木','金','土'].map(d=><span key={d}>{d}</span>)}</div>
            {Array.from({length:offset},(_,i)=><span key={'blank'+i} aria-hidden="true"/>)}
            {Array.from({length:days},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`,state=monthPending?'loading':dayState(day,rows,account),count=rows.filter(r=>tokyoDay(r.started_at)===day).length
              return <button key={day} className={`dh-day dh-${state}`} aria-label={`${day} ${stateLabel[state]}${count?` ${count}試合`:''}`} aria-pressed={selected===day} onClick={()=>setSelected(day)}><span>{i+1}</span></button>})}
          </div>
          <div className="dh-legend"><span><i className="dh-dot recorded"/>記録あり</span><span><i className="dh-dot unsynced"/>記録の表示なし</span></div>
          <p className="dh-muted">色は記録の有無を表します。日付を選ぶと取得状況を確認できます。勝敗や成績による色分けはありません。</p>
        </section>
        <section className="dh-panel dh-detail" aria-label="選択日の記録">
          <p className="dh-label">DAY RECORD</p><h2>{Number(selected.slice(5,7))}月{Number(selected.slice(8))}日の記録</h2>
          {daily.length?<><p>{summary.count}試合を取得 · {summary.wins}勝 {summary.losses}敗{summary.unknown>0?` · 勝敗未取得 ${summary.unknown}試合`:''}</p>
            <dl className="dh-totals">{[['kills','キル'],['deaths','デス'],['assists','アシスト'],['hero_damage','与ダメージ（対プレイヤー）']].map(([key,label])=><div key={key}><dt>{label}</dt><dd>{total(summary[key])}</dd></div>)}</dl>
            <ul className="dh-matches">{daily.map(row=><Match key={row.match_id} row={row}/>)}</ul></>:
            <div className="dh-empty"><strong>{stateLabel[selectedState]}</strong><p>{selectedState==='empty'?'取得済みのデータには、この日の試合がありません。外部データに取得漏れがある可能性があります。':'この日の記録の有無を、まだ確認できていません。'}</p></div>}
        </section>
      </div>
      <MatchTrends rows={rows} month={month} pending={monthPending} observedCount={view.observed.count} onMove={move} canPrevious={month!=='2020-01'} canNext={month!==currentMonth}/>
      <section className="dh-panel dh-coverage" aria-label="取得範囲">
        <h2>取得できた範囲</h2><p>照会完了：{account.coverage_from?`${dateTime(account.coverage_from)} 〜 ${dateTime(account.coverage_until)}`:'まだ完了していません'}</p>
        <p>保存済み：{view.observed.count}試合{view.observed.first?`（${dateTime(view.observed.first)} 〜 ${dateTime(view.observed.last)}）`:''}</p>
        <p>提供元に保存されたランク・通常マッチが対象です。全試合の取得は保証されません。未取得の項目は0として数えません。</p>
        <p>与ダメージはAPIの <code>final_stats.player_damage</code>（対プレイヤーの最終スナップショット）です。試合終了時点まで揃わない場合があります。</p>
        <p>{view?.sync_mode==='daily'?'自動取得は毎朝6時台（JST）を予定。最新の完了時刻は上部に表示します。':'「最新の記録を取得」から手動で更新してください。'}直近7日を再照会し、途中の取得は次回に続けます。</p>
      </section>
      </>}
      </>}
  </main>
}
