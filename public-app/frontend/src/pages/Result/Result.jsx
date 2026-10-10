import {Link} from 'react-router-dom'
import PublicDiagnosis from '../../components/PublicDiagnosis'
import {getAccount} from '../../lib/session-input'
export default function Result(){
 return <main><h1>診断結果</h1><PublicDiagnosis account={getAccount()}/><Link to="/">入力画面へ戻る</Link></main>
}
