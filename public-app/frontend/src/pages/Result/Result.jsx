import {Link} from 'react-router-dom'
import PublicDiagnosis from '../../components/PublicDiagnosis'
import {getAccount} from '../../lib/session-input'
export default function Result(){return <main id="main-content" tabIndex="-1" className="result-page"><h1 className="visually-hidden">FYTH ヒーロー選び</h1><Link className="back-link" to="/">入力画面へ戻る</Link><PublicDiagnosis account={getAccount()}/></main>}
