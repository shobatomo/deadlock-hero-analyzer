import {useState} from 'react'
import visuals from '../../../shared/hero-visuals.json'
import {heroName} from '../../../shared/heroes.mjs'
export default function HeroPortrait({id,className='',eager=false}){
 const [failed,setFailed]=useState(false),image=visuals.heroes[id]?.image
 return <div className={'hero-portrait '+className}>
  {image&&!failed?<img src={image} alt="" loading={eager?'eager':'lazy'} decoding="async" onError={()=>setFailed(true)}/>:<div className="portrait-fallback"><span aria-hidden="true">{heroName(id).slice(0,1)}</span><small>画像を表示できません</small></div>}
 </div>
}
