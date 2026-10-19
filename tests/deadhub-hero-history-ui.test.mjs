// Synthetic monthly snapshots only; all fetches are intercepted in memory.
import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent','DOMParser'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act,within}=await import('@testing-library/react')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const originalFetch=globalThis.fetch,today=tokyoDay(Date.now()),month=today.slice(0,7),previous=shiftMonth(month,-1)
const other=month+(today.endsWith('-01')?'-02':'-01'),empty=month+'-'+['03','04'].find(day=>!today.endsWith('-'+day))
const item={id:987654,name:'テスト用アイテム',image:'https://assets-bucket.deadlock-api.com/assets-api-res/images/items/weapon/basic_magazine.webp'}
const record=(id,day,hero,extra={})=>({match_id:String(id),started_at:day+'T12:00:00+09:00',hero_id:hero,won:true,kills:0,deaths:0,assists:0,hero_damage:0,player_healing:0,duration_s:0,final_items:[],...extra})
const fixture=()=>[record(105,today,15,{final_items:[item]}),record(104,today,4),record(103,other,'15',{won:null,kills:null,player_healing:null,final_items:null}),record(102,other,15),record(101,other,null)]
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch outside fixture')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
async function page({rows=fixture()}={}){
 const state={rows,calls:[],pending:[],defer:false}
 globalThis.fetch=async(input,options={})=>{
  const path=String(input);state.calls.push({path,method:options.method??'GET'})
  if(path==='/api/deadhub/config')return Response.json({enabled:true,auth:'steam'})
  if(path==='/api/deadhub/profile')return Response.json({profile:null})
  if(path==='/api/deadhub/sync')return Response.json({status:'success'})
  if(path.startsWith('/api/deadhub/records?')){
   const requested=new URL(path,'https://local.test').searchParams.get('month')
   const body={identity:{steam_id:accountIdToSteamId('1')},month:requested,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},matches:requested===month?state.rows:requested===previous?[record(201,previous+'-01',4)]:[],observed:{count:999}}
   if(state.defer)return new Promise(resolve=>state.pending.push({month:requested,signal:options.signal,release:(response=Response.json(body))=>resolve(response)}))
   return Response.json(body)
  }
  if(path===`https://api.deadlock-api.com/v1/assets/items/${item.id}?language=japanese`)return Response.json({id:item.id,type:'upgrade',description:{desc:'合成データの効果'}})
  throw Error('Unmocked request: '+path)
 }
 const view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 // Settle the initial profile effect before measuring requests caused by filters.
 await waitFor(()=>assert.ok(state.calls.some(call=>call.path==='/api/deadhub/profile')))
 return {...view,state,list:()=>view.getByRole('region',{name:'試合一覧',exact:true}),select:()=>view.getByRole('combobox',{name:'一覧のヒーロー',exact:true})}
}
const ids=view=>[...view.list().querySelectorAll('.dh-match>small')].map(el=>el.textContent.replace('試合ID ',''))

test('hero list spans loaded days only, keeps daily summary, dates, zero/null and inventory states',async()=>{
 const view=await page(),summary=view.container.querySelector('.dh-day-summary').textContent,before=view.state.calls.length
 assert.deepEqual(ids(view),['105','104'])
 fireEvent.change(view.select(),{target:{value:'15'}})
 assert.deepEqual(ids(view),['105','103','102']);assert.equal(view.state.calls.length,before,'Filtering must not fetch')
 assert.equal(view.container.querySelector('.dh-day-summary').textContent,summary)
 assert.match(view.list().querySelector('.dh-list-scope').textContent,/保存済み記録（JST）。全履歴ではありません/)
 assert.match(view.list().querySelector('[role=status]').textContent,/3試合 \/ この月の保存済み記録 5試合/)
 assert.ok(!view.list().textContent.includes('999'))
 for(const time of view.list().querySelectorAll('time')){assert.match(time.textContent,/JST/);assert.match(time.textContent,/\d{4}/)}
 const matches=view.list().querySelectorAll('.dh-match')
 assert.match(matches[1].textContent,/未取得/);assert.match(matches[1].textContent,/アイテム情報は未取得/)
 assert.equal(matches[2].querySelector('dd').textContent,'0 / 0 / 0')
 assert.match(matches[2].textContent,/取得済みデータ上は所持アイテムなし/)
 assert.ok(within(matches[0]).getByRole('button',{name:item.name}))
 fireEvent.click(view.getByRole('button',{name:'絞り込みを解除'}))
 assert.equal(view.select().value,'');assert.deepEqual(ids(view),['105','104']);assert.equal(view.state.calls.length,before)
 assert.ok([...view.list().querySelectorAll('time')].every(el=>!el.textContent.includes('JST')))
})

test('filter is available on empty dates; unknown heroes are explicit and calendar selection resets the list',async()=>{
 const view=await page(),before=view.state.calls.length
 fireEvent.click(view.getByRole('button',{name:new RegExp('^'+empty+' ')}))
 assert.equal(ids(view).length,0);assert.match(view.list().textContent,/選択日の保存済み記録はありません/)
 fireEvent.change(view.select(),{target:{value:'unknown'}})
 assert.deepEqual(ids(view),['101']);assert.match(view.list().querySelector('.dh-list-count').textContent,/ヒーロー未取得/)
 fireEvent.click(view.getByRole('button',{name:new RegExp('^'+other+' ')}))
 assert.equal(view.select().value,'');assert.deepEqual(ids(view),['103','102','101'])
 assert.equal(view.state.calls.length,before)
})

test('list hero does not alter the existing graph hero or metric, calendar or summary',async()=>{
 const view=await page(),graph=view.getByRole('combobox',{name:'ヒーロー',exact:true})
 fireEvent.change(graph,{target:{value:'4'}});fireEvent.click(view.getByRole('button',{name:'アシスト（A）',exact:true}))
 const calendar=view.container.querySelector('.dh-calendar').innerHTML,summary=view.container.querySelector('.dh-day-summary').innerHTML,before=view.state.calls.length
 fireEvent.change(view.select(),{target:{value:'15'}})
 assert.equal(graph.value,'4');assert.equal(view.getByRole('button',{name:'アシスト（A）',exact:true}).getAttribute('aria-pressed'),'true')
 assert.equal(view.container.querySelector('.dh-calendar').innerHTML,calendar);assert.equal(view.container.querySelector('.dh-day-summary').innerHTML,summary)
 assert.equal(view.container.querySelectorAll('.dh-trends').length,1);assert.equal(view.state.calls.length,before)
})

test('changing months retains explicit hero and an honest empty state without showing old rows while pending',async()=>{
 const view=await page();fireEvent.change(view.select(),{target:{value:'15'}})
 view.state.defer=true;fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}))
 await waitFor(()=>assert.equal(view.state.pending.length,1))
 assert.equal(ids(view).length,0);assert.equal(view.select().disabled,true);assert.match(view.list().textContent,/この月の記録を読み込み中/)
 await act(async()=>view.state.pending[0].release())
 assert.equal(view.select().value,'15');assert.equal(view.select().disabled,false);assert.equal(ids(view).length,0)
 assert.match(view.list().textContent,/この月の保存済み記録に、該当する試合はありません/)
 assert.match(view.list().querySelector('.dh-list-count').textContent,/0試合 \/ この月の保存済み記録 1試合/)
 view.state.defer=false;fireEvent.click(view.getByRole('button',{name:'次の月',exact:true}))
 await waitFor(()=>assert.deepEqual(ids(view),['105','103','102']))
 fireEvent.click(view.getByRole('button',{name:'絞り込みを解除'}));assert.deepEqual(ids(view),['105','104'])
})

for(const lateFailure of [false,true])test(`late old-month ${lateFailure?'failure':'success'} never replaces a newer selected-month hero list`,async()=>{
 const view=await page();fireEvent.change(view.select(),{target:{value:'15'}});view.state.defer=true
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}));await waitFor(()=>assert.equal(view.state.pending.length,1))
 fireEvent.click(view.getByRole('button',{name:'次の月',exact:true}));await waitFor(()=>assert.equal(view.state.pending.length,2))
 assert.equal(view.state.pending[0].signal.aborted,true)
 await act(async()=>view.state.pending[1].release());assert.deepEqual(ids(view),['105','103','102'])
 await act(async()=>view.state.pending[0].release(lateFailure?Response.json({error:'古い月の読取り失敗'},{status:503}):undefined));assert.deepEqual(ids(view),['105','103','102'])
 assert.equal(view.queryByRole('alert'),null)
})

test('failed month read stops loading without claiming empty records; returning to a saved month recovers',async()=>{
 const view=await page();fireEvent.change(view.select(),{target:{value:'15'}})
 fireEvent.change(view.getByRole('combobox',{name:'ヒーロー',exact:true}),{target:{value:'4'}})
 view.state.defer=true
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}));await waitFor(()=>assert.equal(view.state.pending.length,1))
 await act(async()=>view.state.pending[0].release(Response.json({error:'テスト用：月別記録の読取り失敗'},{status:503})))
 assert.match(view.getByRole('alert').textContent,/月別記録の読取り失敗/)
 assert.equal(view.list().getAttribute('aria-busy'),'false')
 assert.doesNotMatch(view.list().textContent,/読み込み中|0試合|該当する試合はありません/)
 assert.match(view.list().textContent,/読み込めませんでした/)
 assert.equal(ids(view).length,0,'Do not show a different month as the failed month')
 assert.match(view.container.querySelector('.dh-day-summary').textContent,/読取り失敗/)
 assert.match(view.container.querySelector('.dh-day').getAttribute('aria-label'),/読取り失敗/)
 assert.equal(view.container.querySelector('.dh-trends').getAttribute('aria-busy'),'false')
 assert.doesNotMatch(view.container.querySelector('.dh-trends').textContent,/読み込んでいます|読み込み中|記録がありません/)
 assert.match(view.container.querySelector('.dh-trends').textContent,/読み込めませんでした/)
 view.state.defer=false;fireEvent.click(view.getByRole('button',{name:'次の月',exact:true}))
 await waitFor(()=>assert.deepEqual(ids(view),['105','103','102']))
 await waitFor(()=>assert.equal(view.queryByRole('alert'),null))
 assert.equal(view.select().disabled,false)
 assert.equal(view.select().value,'15');assert.equal(view.getByRole('combobox',{name:'ヒーロー',exact:true}).value,'4')
})

test('filtered matches reuse the item dialog and filtering alone never loads item details',async()=>{
 const view=await page();fireEvent.change(view.select(),{target:{value:'15'}})
 assert.equal(view.state.calls.filter(c=>c.path.startsWith('https:')).length,0)
 const opener=view.getByRole('button',{name:item.name});opener.focus();fireEvent.click(opener)
 await waitFor(()=>assert.match(view.getByRole('dialog').textContent,/合成データの効果/))
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}));assert.equal(document.activeElement,opener)
 assert.deepEqual(ids(view),['105','103','102'])
})

test('a removed hero after an ordinary refresh stays selected and reports zero rather than switching hero',async()=>{
 const view=await page();fireEvent.change(view.select(),{target:{value:'15'}})
 view.state.rows=[record(104,today,4)]
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 await waitFor(()=>assert.match(view.list().querySelector('.dh-list-count').textContent,/0試合 \/ この月の保存済み記録 1試合/))
 assert.equal(view.select().value,'15');assert.equal(ids(view).length,0)
 fireEvent.click(view.getByRole('button',{name:'絞り込みを解除'}));assert.deepEqual(ids(view),['104'])
})
