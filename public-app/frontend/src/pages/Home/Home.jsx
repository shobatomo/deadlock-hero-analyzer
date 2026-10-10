import {setAccount} from '../../lib/session-input'
import {eligibleHeroes,manifest} from '../../../../shared/heroes.mjs'
import {useRef,useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {validateAccountId} from '../../../../shared/diagnosis.mjs'
import HeroPortrait from '../../components/HeroPortrait'
export default function Home(){
 const [input,setInput]=useState(''),[submitted,setSubmitted]=useState(false),field=useRef(null),navigate=useNavigate()
 const accountId=input.trim(),valid=validateAccountId(accountId),invalid=submitted&&!valid
 function submit(event){event.preventDefault();setSubmitted(true);if(!valid){field.current?.focus();return}setAccount(accountId);navigate('/result')}
 return <main id="main-content" tabIndex="-1" className="home-page">
  <div className="home-grid"><section className="home-intro">
   <p className="eyebrow"><span/>DEADLOCK / HERO FINDER</p>
   <h1>次に試す、<br/><em>あなたのヒーロー。</em></h1>
   <p className="intro-copy">最近のプレイ記録から、<br className="desktop-break"/>次の一戦で試したい候補を3体探します。</p>
   <p className="intro-caption">勝率ランキングではなく、あなたの記録の傾向を手がかりに。</p><p className="record-prerequisite">プレイ記録がある方向けです。記録が少ない場合は候補を出せません。</p>
   <div className="home-portraits" aria-hidden="true"><HeroPortrait id="7" eager/><HeroPortrait id="50" eager/><HeroPortrait id="58" eager/><span className="portrait-caption">次の相棒は、まだ知らないヒーローかもしれない。</span></div>
  </section>
  <section className="input-panel" aria-labelledby="input-heading">
   <p className="eyebrow">01 / プレイヤーIDを入力</p><h2 id="input-heading">自分のプレイを、<br/>次のヒントに。</h2>
   <p>まずはIDを入力。次の画面で記録を取得します。</p>
   <form onSubmit={submit} noValidate><label htmlFor="account-id">プレイヤーID <span>account_id / SteamID64</span></label>
    <input ref={field} id="account-id" type="text" inputMode="numeric" autoComplete="off" spellCheck="false" maxLength={17} value={input} onChange={e=>setInput(e.target.value)} aria-invalid={invalid} aria-describedby={invalid?'account-error account-help':'account-help'} placeholder="数字のIDを入力"/>
    {invalid&&<p id="account-error" className="form-error" role="alert">{accountId?'数字のaccount_idまたは17桁のSteamID64を入力してください。':'プレイヤーIDを入力してください。'}</p>}
    <p id="account-help" className="field-help">プロフィールの表示名やURLではなく、数字のIDを使います。</p>
    <button className="primary-button" type="submit">診断を確認 <span aria-hidden="true">→</span></button>
   </form>
   <details className="id-help"><summary>IDがわからないとき</summary><p>SteamのプロフィールURLが <code>/profiles/数字</code> なら、その17桁の数字がSteamID64です。</p><p><code>/id/好きな名前</code> の場合、その名前やURLは使えません。数字のSteamID64か、Deadlock APIで表示されるaccount_idを確認してください。</p><a href="https://help.steampowered.com/ja/faqs/view/2816-BE67-5B69-0FEC" target="_blank" rel="noreferrer">Steam公式：Steam IDの確認方法 ↗</a></details>
   <div className="privacy-note"><span aria-hidden="true">◇</span><p>IDはURLに残しません。次の画面の取得ボタンを押した時だけ外部APIへ送信します。個人の履歴・結果はサーバーに保存しません。</p></div>
  </section></div>
  <section className="how-it-works" aria-labelledby="how-heading"><div><p className="eyebrow">HOW IT WORKS</p><h2 id="how-heading">次に試すまで、3ステップ。</h2></div><ol><li><span>01</span><h3>IDを入力する</h3><p>SteamID64かaccount_idを用意。</p></li><li><span>02</span><h3>最近の記録を確認</h3><p>直近30日の最大5試合が手がかり。</p></li><li><span>03</span><h3>気になる1体を試す</h3><p>候補の特徴と理由を見て選ぶ。</p></li></ol></section>
  <details className="beginner-note"><summary>Deadlockを始めたばかりの方へ</summary><p>Deadlockは、特徴の違う「ヒーロー」を選んでチームで戦うゲームです。FYTHはプレイ記録から次に試す候補を探すツールです。</p><p>まだ記録がない、または比較できる記録が少ない場合は候補を出せません。まずは気になるヒーローでプレイしてから、また試してみてください。</p><p>保存された一覧は{eligibleHeroes.length}件です（{manifest.assets_observed_at}時点）。すべてのヒーローに対応する保証はありません。</p></details>
 </main>
}
