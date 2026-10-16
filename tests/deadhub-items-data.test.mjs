import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createItemCatalog,projectFinalItems,ITEM_ASSET_LIMITS} from '../public-app/backend/deadhub/item-assets.js'
import {createRecordProvider,projectRecord} from '../public-app/backend/deadhub/provider.js'
import {safeFinalItems,itemImage} from '../public-app/shared/final-items.mjs'
const image='https://assets-bucket.deadlock-api.com/assets-api-res/images/items/weapon/basic_magazine.webp'
const assets=[{id:1,type:'upgrade',name:'基礎装備',shop_image_webp:image},{id:2,type:'upgrade',name:'上位装備',image_webp:image},{id:3,type:'ability',name:'強化'},{id:4,type:'weapon',name:'武器'}]
const catalog=new Map(assets.map(a=>[a.id,{type:a.type,name:a.name,image:a.type==='upgrade'?image:null}]))
const held=id=>({item_id:id,sold_time_s:0})
const range={accountId:'1',from:'2026-10-01T00:00:00Z',until:'2026-11-01T00:00:00Z',cursor:null}
const raw=(items,others=[])=>({match_id:99,start_time:'2026-10-14 15:00:00',duration_s:600,match_outcome:'TeamWin',winning_team:'Team0',
 players:[{account_id:1,hero_id:15,team:'Team0',kills:4,deaths:0,assists:2,final_stats:{player_damage:6000},...(items===undefined?{}:{items})},...others]})
test('only explicitly held shop upgrades survive sales, consumed upgrades, abilities and flags',()=>{
 const list=projectFinalItems([{item_id:1,sold_time_s:120,flags:0},held(2),{item_id:3},{item_id:4,sold_time_s:0},{...held(2),flags:999}],catalog)
 assert.deepEqual(list,[{id:2,name:'上位装備',image}])
 assert.equal(projectFinalItems([{item_id:1,flags:0}],catalog),null)
})
test('missing, malformed, unknown ID and missing sale time never become empty',()=>{
 for(const items of [undefined,null,{},[null],[held(999)],[{item_id:1}],[{item_id:1,sold_time_s:null}],[{item_id:1,sold_time_s:'0'}],[{item_id:1,sold_time_s:-1}],[held(2),held(999)]]){
  assert.equal(projectFinalItems(items,catalog),null)
 }
 assert.equal(projectFinalItems([held(1)],null),null)
 assert.equal(projectFinalItems(Array.from({length:257},()=>held(1)),catalog),null)
})
test('explicit empty and fully excluded known history are empty; later repurchase remains held',()=>{
 assert.deepEqual(projectFinalItems([],null),[])
 assert.deepEqual(projectFinalItems([{item_id:1,sold_time_s:5},{item_id:3}],catalog),[])
 assert.deepEqual(projectFinalItems([{item_id:1,sold_time_s:5},held(1)],catalog),[{id:1,name:'基礎装備',image}])
 assert.deepEqual(projectFinalItems([{item_id:999,sold_time_s:1}],catalog),[])
})
test('stored item projection bounds data, keeps unknown distinct, and permits only official HTTPS images',()=>{
 for(const value of [null,{},[{id:-1}],[{id:1},{id:1}],Array.from({length:33},(_,id)=>({id:id+1}))])assert.equal(safeFinalItems(value),null)
 assert.deepEqual(safeFinalItems([]),[])
 assert.deepEqual(safeFinalItems([{id:1,name:'',image:'javascript:bad()',raw:'not returned'}]),[{id:1,name:'アイテム 1',image:null}])
 assert.equal(safeFinalItems([{id:1,name:'長'.repeat(300),image}])[0].name.length,120)
 for(const url of ['http://assets-bucket.deadlock-api.com/assets-api-res/images/a.png',image+'?secret=1',image+'#a',image.replace('.com','.com.evil.test'),image.replace('https://','https://user:pass@'),image.replace('.webp','.svg'),'data:image/png;base64,abc'])assert.equal(itemImage(url),null)
 assert.equal(itemImage(image),image)
})
test('catalog is lazy, coalesces concurrent loads, caches six hours, and selects the documented image priority',async()=>{
 let calls=0,time=0,release
 const get=createItemCatalog({now:()=>time,fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,'https://api.deadlock-api.com/v1/assets/items?language=japanese');assert.equal(opts.redirect,'error');assert.equal(opts.headers,undefined)
  await new Promise(r=>{release=r});return Response.json(assets)
 }})
 assert.equal(calls,0)
 const a=get(),b=get();await Promise.resolve();assert.equal(calls,1);release()
 const [one,two]=await Promise.all([a,b]);assert.equal(one,two);assert.equal(one.get(1).image,image)
 assert.equal(await get(),one);assert.equal(calls,1)
 time=ITEM_ASSET_LIMITS.ttlMs+1;const next=get();await Promise.resolve();release();await next;assert.equal(calls,2)
})
test('failed assets are negatively cached, can recover, and retain a previous usable catalog',async()=>{
 let calls=0,time=0,ok=false
 const get=createItemCatalog({now:()=>time,fetchImpl:async()=>{calls++;return ok?Response.json(assets):new Response('',{status:503})}})
 assert.equal(await get(),null);assert.equal(await get(),null);assert.equal(calls,1)
 time=60001;ok=true;const saved=await get();assert.ok(saved instanceof Map)
 time+=ITEM_ASSET_LIMITS.ttlMs+1;ok=false;assert.equal(await get(),saved);assert.equal(await get(),saved);assert.equal(calls,3)
})
test('bad catalog payloads and oversized bodies return unknown without leaking or retry loops',async()=>{
 for(const payload of [[],{},[assets[0],assets[0]],[{id:1,type:'unexpected'}]]){
  const get=createItemCatalog({fetchImpl:async()=>Response.json(payload)});assert.equal(await get(),null)
 }
 const get=createItemCatalog({fetchImpl:async()=>new Response('x'.repeat(ITEM_ASSET_LIMITS.bodyBytes+1))})
 assert.equal(await get(),null)
 const fallback=await createItemCatalog({fetchImpl:async()=>Response.json([{...assets[0],shop_image_webp:'https://evil.test/i.png',shop_image:image}])})()
 assert.equal(fallback.get(1).image,image)
})
test('metadata reuses one bulk request, scopes this account, requests items, and caches assets across pages',async()=>{
 const calls=[],provider=createRecordProvider({fetchImpl:async(url)=>{
  calls.push(String(url))
  if(String(url).includes('/assets/'))return Response.json(assets)
  assert.equal(url.searchParams.get('account_ids'),'1');assert.equal(url.searchParams.get('only_filtered_players'),'true')
  assert.equal(url.searchParams.get('include_player_items'),'true');assert.equal(url.searchParams.has('match_ids'),false)
  return Response.json([raw([held(2)],[{account_id:2,items:[held(1)]}])])
 }})
 const first=await provider.page(range),second=await provider.page(range)
 assert.deepEqual(first.records[0].final_items,[{id:2,name:'上位装備',image}])
 assert.deepEqual(second.records[0].final_items,first.records[0].final_items)
 assert.equal(first.records[0].kills,4);assert.equal(first.records[0].hero_damage,6000)
 assert.equal(calls.filter(u=>u.includes('/metadata')).length,2);assert.equal(calls.filter(u=>u.includes('/assets/')).length,1)
})
test('missing/empty item payloads skip assets and preserve all existing result fields',async()=>{
 for(const items of [undefined,[]]){
  let calls=0
  const provider=createRecordProvider({fetchImpl:async()=>{calls++;return Response.json([raw(items)])}})
  const record=(await provider.page(range)).records[0]
  assert.deepEqual(record.final_items,items===undefined?null:[])
  const previous=projectRecord(raw(items),'1',range.from,range.until);delete record.final_items;delete previous.final_items
  assert.deepEqual(record,previous);assert.equal(calls,1)
 }
})
test('assets failure or unresolved items cannot discard K/D/A or produce a known empty inventory',async()=>{
 for(const get of [async()=>null,async()=>{throw Error('dummy unavailable')},async()=>catalog]){
  const record=(await createRecordProvider({fetchImpl:async()=>Response.json([raw([held(999)])]),itemCatalog:get}).page(range)).records[0]
  assert.equal(record.final_items,null);assert.equal(record.kills,4)
 }
})
test('wrong or duplicate players fail before assets and never mix another account inventory',async()=>{
 for(const data of [{...raw([held(1)]),players:[{account_id:2,items:[held(2)]}]},raw([held(1)],[{account_id:1,items:[held(2)]}])]){
  let catalogs=0
  const provider=createRecordProvider({fetchImpl:async()=>Response.json([data]),itemCatalog:async()=>{catalogs++;return catalog}})
  await assert.rejects(provider.page(range),e=>e.code==='invalid_provider');assert.equal(catalogs,0)
 }
})
