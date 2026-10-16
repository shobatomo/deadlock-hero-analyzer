import {itemId,itemName,itemImage,MAX_FINAL_ITEMS} from '../../shared/final-items.mjs'
export const ITEM_ASSET_LIMITS=Object.freeze({ttlMs:6*3600000,retryMs:60000,timeoutMs:5000,bodyBytes:12*1024*1024,entries:5000})
export function projectFinalItems(items,catalog){
 if(!Array.isArray(items)||items.length>256)return null
 if(!items.length)return []
 if(!(catalog instanceof Map))return null
 const held=new Map()
 for(const item of items){
  const id=itemId(item?.item_id),asset=catalog.get(id)
  // Abilities and weapons can have no sale timestamp; they are not shop upgrades.
  if(asset&&asset.type!=='upgrade')continue
  // Explicit sales also exclude consumed lower-tier upgrades. Flags are not evidence.
  if(Number.isSafeInteger(item?.sold_time_s)&&item.sold_time_s>0)continue
  if(id===null||!asset||item.sold_time_s!==0)return null
  held.set(id,{id,name:asset.name,image:asset.image})
  if(held.size>MAX_FINAL_ITEMS)return null
 }
 return [...held.values()]
}
export function createItemCatalog({fetchImpl=fetch,now=Date.now}={}){
 let cached=null,expires=0,retryAt=0,pending=null
 async function load(){
  const signal=AbortSignal.timeout(ITEM_ASSET_LIMITS.timeoutMs)
  const response=await fetchImpl('https://api.deadlock-api.com/v1/assets/items?language=japanese',{signal,redirect:'error'})
  if(!response.ok)throw Error('assets_unavailable')
  const chunks=[];let bytes=0
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>ITEM_ASSET_LIMITS.bodyBytes)throw Error('assets_too_large');chunks.push(chunk)}
  signal.throwIfAborted()
  const raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(!Array.isArray(raw)||!raw.length||raw.length>ITEM_ASSET_LIMITS.entries)throw Error('invalid_assets')
  const catalog=new Map()
  for(const item of raw){
   const id=itemId(item?.id)
   if(id===null||catalog.has(id)||!['upgrade','ability','weapon'].includes(item.type))throw Error('invalid_assets')
   catalog.set(id,{type:item.type,name:itemName(item.name,id),
    image:[item.shop_image_webp,item.shop_image,item.image_webp,item.image].map(itemImage).find(Boolean)??null})
  }
  return catalog
 }
 return async function catalog(){
  if(now()<expires||now()<retryAt)return cached
  if(!pending)pending=load().then(value=>{cached=value;expires=now()+ITEM_ASSET_LIMITS.ttlMs;return value})
   .catch(()=>{retryAt=now()+ITEM_ASSET_LIMITS.retryMs;return cached}).finally(()=>{pending=null})
  return pending
 }
}
