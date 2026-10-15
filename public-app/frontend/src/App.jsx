import './App.css'
import './fonts.css'
import './print.css'
import {BrowserRouter,Link,Route,Routes,useLocation} from 'react-router-dom'
import {useEffect} from 'react'
import Home from './pages/Home/Home'
import Result from './pages/Result/Result'
import Deadhub from './pages/Deadhub/Deadhub'
function Shell(){
 const {pathname}=useLocation()
 const records=pathname==='/deadhub'
 useEffect(()=>{window.scrollTo(0,0);document.getElementById('main-content')?.focus({preventScroll:true})},[pathname])
 return <><a className="skip-link" href="#main-content">本文へ移動</a>
  <header className="site-header"><Link to={records?'/deadhub':'/'} className="brand" aria-label={records?'Deadhubのトップへ':'FYTHのトップへ'}><span className="brand-mark" aria-hidden="true">{records?'D':'F'}</span><span>{records?'Deadhub':'FYTH'}</span></Link></header>
  <Routes><Route path="/" element={<Home/>}/><Route path="/result" element={<Result/>}/><Route path="/deadhub" element={<Deadhub/>}/><Route path="*" element={<Home/>}/></Routes>
  <footer className="site-footer"><span>{records?'Deadlockを遊んだ日を、見返そう。':'FYTHで、次に試すヒーローを探そう。'}</span><p>Valveの公式サービスではありません。ゲーム画像の権利はValve等の権利者に帰属します。</p><details><summary>データと素材について</summary><p>コミュニティが提供するDeadlock APIを利用しています。素材一覧は2026年10月8日時点のものです。最新の全ヒーローやゲーム環境には対応していない場合があります。</p><a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a><span> · </span><a href="/heroes/credits.json" target="_blank" rel="noreferrer">画像の出典</a></details></footer>
 </>
}
export default function App(){return <BrowserRouter><Shell/></BrowserRouter>}
