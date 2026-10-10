import {Link} from 'react-router-dom'
import PublicDiagnosis from '../../components/PublicDiagnosis'
import {getAccount} from '../../lib/session-input'
export default function Result(){return <main id="main-content" tabIndex="-1" className="result-page"><Link className="back-link" to="/">← 入力画面へ戻る</Link><p className="eyebrow">02 / あなたのプレイから探す</p><h1>次のヒーローを見つけよう。</h1><PublicDiagnosis account={getAccount()}/></main>}
