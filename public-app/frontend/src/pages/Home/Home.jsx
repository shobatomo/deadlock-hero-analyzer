import {setAccount} from '../../lib/session-input'
import {eligibleHeroes,manifest} from '../../../../shared/heroes.mjs'
import {useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {parseProfileInput} from '../../lib/steam-input.mjs'
export default function Home(){
 const [input,setInput]=useState(''),[submitted,setSubmitted]=useState(false),field=useRef(null),navigate=useNavigate()
 const {accountId,error}=parseProfileInput(input),valid=accountId!==null,invalid=submitted&&!valid
 function submit(event){event.preventDefault();setSubmitted(true);if(!valid){field.current?.focus();return}setAccount(accountId);navigate('/result')}
 return <main id="main-content" tabIndex="-1" className="home-page">
  <div className="home-grid"><section className="home-intro">
   <p className="eyebrow">DEADLOCK</p>
   <h1>君にぴったりな<br/><em>ヒーローは誰？</em></h1>
   <p className="intro-copy">SteamのプロフィールURLやIDから、あなたにおすすめのヒーローを探します。</p>
   <p className="record-prerequisite">既にプレイ済みのユーザ向けです。記録が足りない場合は候補を表示できないことがあります。</p>
  </section>
  <section className="input-panel" aria-labelledby="input-heading">
   <h2 id="input-heading">プレイヤーID・<wbr/><span>SteamプロフィールURL</span></h2>
   <form onSubmit={submit} noValidate><label htmlFor="account-id">プレイヤーID<span>（account_id・SteamID64）</span>またはSteamプロフィールURL</label>
    <input ref={field} id="account-id" type="text" autoComplete="off" spellCheck="false" maxLength={2048} value={input} onChange={e=>setInput(e.target.value)} aria-invalid={invalid} aria-describedby={invalid?'account-error account-help':'account-help'} placeholder="数字のID または https://steamcommunity.com/profiles/…"/>
    {invalid&&<p id="account-error" className="form-error" role="alert">{error==='empty'?'プレイヤーIDまたはSteamプロフィールURLを入力してください。':error==='vanity'?"/id/ に名前が続くURLには対応していません。数字のSteamID64か、/profiles/ に数字が続くURLを入力してください。":"数字のaccount_id、17桁のSteamID64、または https://steamcommunity.com/profiles/数字 のURLを入力してください。"}</p>}
    <p id="account-help" className="field-help">/profiles/ に数字が続くSteamのURLは、そのまま貼り付けられます。URLから数字のIDだけを使います。</p>
    <button className="primary-button" type="submit">確認画面へ</button>
    <p className="field-help">次の画面で取得内容を確認してから、プレイ記録を取得します。</p>
   </form>
   <details className="id-help"><summary>IDがわからないとき</summary><p>SteamのプロフィールURLが <code>/profiles/数字</code> の形なら、その17桁の数字がSteamID64です。URLごとコピーして貼り付けられます。</p><p><code>/id/</code> に名前が続くURLには対応していません。数字のSteamID64か、Deadlock APIに表示されるaccount_idを確認してください。</p><a href="https://help.steampowered.com/ja/faqs/view/2816-BE67-5B69-0FEC" target="_blank" rel="noreferrer">Steam公式：Steam IDの確認方法</a></details>
   <p className="privacy-note">IDはURLに残りません。プレイ履歴や結果はサーバーに保存しません。</p>
  </section></div>
  <details className="beginner-note"><summary>使い方と注意</summary><p>IDを入力し、取得内容を確認してから記録を取得します。候補が出たら、気になる1体の試し方を見てください。直近30日から最大10試合を選び、そのうち最大5試合の詳細取得を試みます。</p><p>少数の記録をもとにした参考候補です。適性や勝率は保証しません。取得ボタンを押したときだけ、入力したIDを外部のDeadlock APIへ送信します。</p><p>まだ記録がない場合は、気になるヒーローでプレイしてからお試しください。保存済みの一覧は{eligibleHeroes.length}件です（{manifest.assets_observed_at}時点）。全ヒーローに対応しているとは限りません。</p></details>
 </main>
}
