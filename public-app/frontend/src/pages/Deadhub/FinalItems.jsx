import {useState} from 'react'
import {safeFinalItems} from '../../../../shared/final-items.mjs'
import './FinalItems.css'

function ItemIcon({item}){
  const [failed,setFailed]=useState(false)
  return item.image&&!failed?<img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:
    <span className="dh-item-fallback" aria-hidden="true">{item.name}</span>
}
export default function FinalItems({items}){
  const values=safeFinalItems(items),[selected,setSelected]=useState(null)
  const current=values?.find(item=>item.id===selected)??values?.[0]
  return <div className="dh-final-items">
    <h3>終了時の所持アイテム</h3>
    {values===null?<p className="dh-items-note">アイテム情報は未取得です。</p>:!values.length?
      <p className="dh-items-note">取得済みデータ上は所持アイテムなし</p>:<>
      <ul className="dh-items-list" aria-label="終了時の所持品一覧">
        {values.map(item=><li key={item.id}><button type="button" aria-label={item.name} title={item.name}
          aria-pressed={current.id===item.id} onFocus={()=>setSelected(item.id)} onClick={()=>setSelected(item.id)}>
          <ItemIcon key={item.image??'missing'} item={item}/>
        </button></li>)}
      </ul>
      <p className="dh-item-name" role="status">{current.name}</p>
      <p className="dh-items-note">選択すると名前を確認できます。ゲーム内のスロット順ではありません。</p>
    </>}
  </div>
}
