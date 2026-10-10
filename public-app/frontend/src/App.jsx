import './App.css'
import {BrowserRouter,Link,Route,Routes,useLocation} from 'react-router-dom'
import {useEffect} from 'react'
import Home from './pages/Home/Home'
import Result from './pages/Result/Result'
function Shell(){
 const {pathname}=useLocation()
 useEffect(()=>{window.scrollTo(0,0);document.getElementById('main-content')?.focus({preventScroll:true})},[pathname])
 return <><a className="skip-link" href="#main-content">本文へ移動</a>
  <header className="site-header"><Link to="/" className="brand" aria-label="FYTH トップへ"><span className="brand-mark" aria-hidden="true">F</span><span>FYTH<small>FIND YOUR TRUE HERO</small></span></Link><span className="header-note">DEADLOCK · 非公式ヒーロー診断</span></header>
  <Routes><Route path="/" element={<Home/>}/><Route path="/result" element={<Result/>}/><Route path="*" element={<Home/>}/></Routes>
  <footer className="site-footer"><span>FYTH — 次の一戦に、新しい選択を。</span><p>Valveの公式サービスではありません。ゲーム画像の権利はValve等の権利者に帰属します。</p><details><summary>データと素材について</summary><p>コミュニティのDeadlock APIを利用。素材一覧は2026年10月8日時点です。最新の全ヒーローやゲーム環境との一致は保証しません。</p><a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a><span> · </span><a href="/heroes/credits.json" target="_blank" rel="noreferrer">画像の出典</a></details></footer>
 </>
}
export default function App(){return <BrowserRouter><Shell/></BrowserRouter>}
