// A null list is unknown; an empty list is an explicitly observed empty inventory.
export const MAX_FINAL_ITEMS=32
export const itemId=value=>Number.isInteger(value)&&value>0&&value<=4294967295?value:null
export function itemName(value,id){
 if(typeof value!=='string')return 'アイテム '+id
 const name=value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim()
 return name?Array.from(name).slice(0,120).join(''):'アイテム '+id
}
export function itemImage(value){
 if(typeof value!=='string'||value.length>512)return null
 try{
  const url=new URL(value)
  return url.protocol==='https:'&&url.hostname==='assets-bucket.deadlock-api.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&
   /^\/assets-api-res\/images\/[a-zA-Z0-9_./-]+\.(?:webp|png|jpg|jpeg)$/.test(url.pathname)?url.href:null
 }catch{return null}
}
export function safeFinalItems(value){
 if(!Array.isArray(value)||value.length>MAX_FINAL_ITEMS)return null
 const seen=new Set(),items=[]
 for(const item of value){
  const id=itemId(item?.id)
  if(id===null||seen.has(id))return null
  seen.add(id);items.push({id,name:itemName(item.name,id),image:itemImage(item.image)})
 }
 return items
}
