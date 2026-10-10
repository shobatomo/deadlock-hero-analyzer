import {setAccount} from '../../lib/session-input'
import guides from '../../../../shared/hero-guides.json'
import {eligibleHeroes,manifest} from '../../../../shared/heroes.mjs'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { validateAccountId } from '../../../../shared/diagnosis.mjs'

function Home() {
    const [inputValue, setInputValue] = useState('')
    const navigate = useNavigate()
    const accountId = inputValue.trim()
    const validId = validateAccountId(accountId)
    function handleSubmit(event) {
        event.preventDefault()
        if (validId) {setAccount(accountId);navigate('/result')}
    }
    return (
        <main>
            <h1>Find Your True Hero</h1>
            <p>最近のプレイ記録から、次に試してみるヒーローを探します。</p>
            <p>少ない試合からの参考候補です。記録が足りないと、候補を選べないことがあります。</p>
            <form onSubmit={handleSubmit}>
                <label htmlFor="account-id">Deadlock account_id または SteamID64</label>
                <input id="account-id" type="text" inputMode="numeric" maxLength={17}
                    value={inputValue} onChange={event => setInputValue(event.target.value)}
                    aria-describedby="account-help" placeholder="数値の ID を入力してください" />
                <p id="account-help">入力IDはURLに残しません。結果画面で取得ボタンを押したときに、外部サービスへ送信します。</p>
                <details><summary>詳しく見る：対応ヒーロー</summary><p>保存された一覧は{eligibleHeroes.length}件です（{manifest.assets_observed_at}時点）。{guides.roster_notice}</p></details>
                {accountId && !validId && <p role="alert">有効な数値IDを入力してください。</p>}
                <button type="submit" disabled={!validId}>診断を確認</button>
            </form>
        </main>
    )
}
export default Home