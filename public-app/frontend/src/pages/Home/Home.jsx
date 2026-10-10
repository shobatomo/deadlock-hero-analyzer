import {setAccount} from '../../lib/session-input'
import {eligibleHeroes,manifest} from '../../../../shared/heroes.mjs'
import {useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {parseProfileInput} from '../../lib/steam-input.mjs'
import HeroPortrait from '../../components/HeroPortrait'
export default function Home(){
 const [input,setInput]=useState(''),[submitted,setSubmitted]=useState(false),field=useRef(null),navigate=useNavigate()
 const {accountId,error}=parseProfileInput(input),valid=accountId!==null,invalid=submitted&&!valid
 function submit(event){event.preventDefault();setSubmitted(true);if(!valid){field.current?.focus();return}setAccount(accountId);navigate('/result')}
 return <main id="main-content" tabIndex="-1" className="home-page">
  <div className="home-grid"><section className="home-intro">
   <p className="eyebrow"><span/>DEADLOCK / HERO FINDER</p>
   <h1>次に試す、<br/><em>あなたのヒーロー。</em></h1>
   <p className="intro-copy">IDを入力して、次に試すヒーロー候補3体を見つけよう。</p>
   <p className="record-prerequisite">プレイ記録がある方向けです。記録不足時は候補を出せません。</p>
   <div className="home-portraits" aria-hidden="true"><HeroPortrait id="7" eager/><HeroPortrait id="50" eager/><HeroPortrait id="58" eager/></div>
  </section>
  <section className="input-panel" aria-labelledby="input-heading">
   <h2 id="input-heading">IDまたはプロフィールURLを入力</h2>
   <form onSubmit={submit} noValidate><label htmlFor="account-id">プレイヤーID / SteamプロフィールURL <span>account_id / SteamID64</span></label>
    <input ref={field} id="account-id" type="text" autoComplete="off" spellCheck="false" maxLength={2048} value={input} onChange={e=>setInput(e.target.value)} aria-invalid={invalid} aria-describedby={invalid?'account-error account-help':'account-help'} placeholder="数字のID または https://steamcommunity.com/profiles/…"/>
    {invalid&&<p id="account-error" className="form-error" role="alert">{error==='empty'?'プレイヤーIDまたはSteamプロフィールURLを入力してください。':error==='vanity'?'名前付きの /id/ URLは未対応です。数字のSteamID64または /profiles/ URLを確認してください。':'数字のaccount_id・17桁のSteamID64、または https://steamcommunity.com/profiles/数字 のURLを入力してください。'}</p>}
    <p id="account-help" className="field-help">Steamの /profiles/ URLをそのまま貼り付けられます。数字のIDだけを取り出して使います。</p>
    <button className="primary-button" type="submit">診断を確認 <span aria-hidden="true">→</span></button>
    <p className="field-help">次の画面で記録を取得すると、候補を表示します。</p>
   </form>
   <details className="id-help"><summary>IDがわからないとき</summary><p>SteamのプロフィールURLが <code>/profiles/数字</code> なら、その17桁の数字がSteamID64です。URL全体をコピーして貼り付けてください。</p><p><code>/id/好きな名前</code> は未対応です。数字のSteamID64か、Deadlock APIで表示されるaccount_idを確認してください。</p><a href="https://help.steampowered.com/ja/faqs/view/2816-BE67-5B69-0FEC" target="_blank" rel="noreferrer">Steam公式：Steam IDの確認方法 ↗</a></details>
   <p className="privacy-note">IDはURLに残さず、履歴・結果はサーバーに保存しません。</p>
  </section></div>
  <details className="beginner-note"><summary>使い方と注意</summary><p>IDを入力 → 記録を取得 → 気になる1体の試し方を見る、の順で使えます。直近30日の候補最大10試合から、詳細を最大5試合確認します。</p><p>少数の記録からの参考候補です。適性や勝率を保証しません。取得ボタンを押した時だけ入力IDを外部Deadlock APIへ送信します。</p><p>まだ記録がない場合は、気になるヒーローでプレイしてから試してください。保存された一覧は{eligibleHeroes.length}件です（{manifest.assets_observed_at}時点）。全ヒーローへの対応は保証しません。</p></details>
 </main>
}
