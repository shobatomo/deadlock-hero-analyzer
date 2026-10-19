import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {manifest} from '../public-app/shared/heroes.mjs'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react')
const {default:MatchTrends}=await import('../public-app/frontend/src/pages/Deadhub/MatchTrends.jsx')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const month='2026-10',originalFetch=globalThis.fetch
const noFetch=()=>{throw Error('Trend controls must not fetch')}
globalThis.fetch=noFetch
afterEach(()=>{cleanup();globalThis.fetch=noFetch})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
const row=(n,extra={})=>({match_id:String(n),started_at:`2026-10-${String(n).padStart(2,'0')}T12:00:00+09:00`,hero_id:15,kills:n,deaths:0,assists:n+2,hero_damage:n*60,duration_s:60,...extra})
const component=(rows,extra={})=>React.createElement(MatchTrends,{rows,month,onMove:()=>{},observedCount:100,...extra})
test('zero matches and unknown-only heroes state their partial-month scope without fabricating a graph',()=>{
 const view=render(component([]))
 assert.equal(view.queryByRole('img'),null);assert.match(view.container.textContent,/この月の保存済み記録はありません/)
 assert.match(view.container.textContent,/全履歴ではなく/);assert.match(view.container.textContent,/この月：0試合 \/ 保存済み全期間：100試合/)
 view.rerender(component([row(1,{hero_id:null})]))
 assert.equal(view.queryByRole('combobox'),null);assert.match(view.container.textContent,/ヒーロー未取得の1試合/)
})
test('one match displays an actual point and disables the single-position slider; under five has no mean',()=>{
 const view=render(component([row(1)]))
 assert.equal(view.container.querySelectorAll('[data-point=value]').length,1);assert.equal(view.container.querySelectorAll('[data-point=average]').length,0)
 assert.equal(view.getByRole('slider').disabled,true);assert.match(view.container.textContent,/選択ヒーロー：1試合/)
 view.rerender(component([1,2,3,4].map(n=>row(n))))
 assert.equal(view.getByRole('slider').disabled,false);assert.equal(view.container.querySelectorAll('[data-point=average]').length,0)
})
test('missing values split paths and valid zero remains visible and inspectable',()=>{
 const view=render(component([row(1,{kills:0}),row(2),row(3,{kills:null}),row(4),row(5)]))
 assert.equal(view.container.querySelectorAll('[data-point=value]').length,4);assert.equal(view.container.querySelectorAll('[data-segment=value]').length,2)
 assert.equal(view.container.querySelectorAll('[data-point=average]').length,0)
 fireEvent.change(view.getByRole('slider'),{target:{value:'1'}})
 assert.equal(view.container.querySelector('[data-selected-value]').textContent,'0回')
 fireEvent.change(view.getByRole('slider'),{target:{value:'3'}})
 assert.equal(view.container.querySelector('[data-selected-value]').textContent,'未取得')
})
test('average point count differs from the five-match denominator and missing windows stay absent',()=>{
 const view=render(component([0,2,null,6,8,10,12,14].map((kills,i)=>row(i+1,{kills}))))
 assert.match(view.container.textContent,/8試合中、キルが未取得：1試合 ・ 5試合平均の表示点：1点/)
 assert.match(view.getByRole('img').querySelector('desc').textContent,/5試合平均の表示点は1点/)
 assert.equal(view.container.querySelectorAll('[data-point=average]').length,1)
 assert.equal(view.container.querySelector('[data-selected-average]').textContent,'10回')
 fireEvent.change(view.getByRole('slider'),{target:{value:'7'}})
 assert.equal(view.container.querySelector('[data-selected-average]').textContent,'—')
 assert.match(view.container.textContent,/対象の指標に1件でも欠損がある区間は表示せず/)
})

test('metric switches render only the chosen count or damage/min, with duration gaps and actual zero deaths',()=>{
 const records=[row(1),row(2,{duration_s:0}),row(3,{duration_s:null}),row(4),row(5,{hero_damage:0})]
 const view=render(component(records))
 assert.equal(view.container.querySelectorAll('[data-point=average]').length,1)
 fireEvent.click(view.getByRole('button',{name:'ダメージ/分',exact:true}))
 assert.equal(view.container.querySelectorAll('[data-point=value]').length,3);assert.equal(view.container.querySelectorAll('[data-point=average]').length,0)
 assert.equal(view.container.querySelector('[data-selected-value]').textContent,'0ダメージ/分')
 fireEvent.click(view.getByRole('button',{name:'デス（D）',exact:true}))
 assert.equal(view.container.querySelector('[data-selected-value]').textContent,'0回');assert.equal(view.container.querySelector('[data-selected-average]').textContent,'0回')
 assert.equal(view.container.querySelectorAll('.dh-trend-metrics [aria-pressed=true]').length,1)
})
test('hero switching resets inspection safely, preserves metric, and repeated controls never fetch',()=>{
 const view=render(component([...Array.from({length:6},(_,i)=>row(i+1)),row(7,{hero_id:4,kills:20,assists:99})]))
 fireEvent.click(view.getByRole('button',{name:'アシスト（A）',exact:true}))
 const scale=view.getByRole('img').getAttribute('data-axis-maximum')
 for(let i=0;i<8;i++){
  fireEvent.change(view.getByRole('combobox',{name:'ヒーロー',exact:true}),{target:{value:'4'}})
  assert.equal(view.getByRole('slider').max,'1');assert.equal(view.container.querySelector('[data-selected-value]').textContent,'99回')
  assert.equal(view.getByRole('img').getAttribute('data-axis-maximum'),scale)
  fireEvent.change(view.getByRole('combobox',{name:'ヒーロー',exact:true}),{target:{value:'15'}})
  assert.equal(view.getByRole('slider').max,'6');fireEvent.change(view.getByRole('slider'),{target:{value:'2'}})
  assert.equal(view.getByRole('img').getAttribute('data-axis-maximum'),scale)
 }
 assert.equal(view.getByRole('button',{name:'アシスト（A）',exact:true}).getAttribute('aria-pressed'),'true')
})
test('loading another month hides the old chart and returning uses current rows and valid hero selection',()=>{
 const view=render(component([row(1)]))
 view.rerender(component([],{month:'2026-09',pending:true}))
 assert.equal(view.queryByRole('img'),null);assert.match(view.getByRole('status').textContent,/読み込み中/)
 view.rerender(component([],{month:'2026-09',pending:false}));assert.equal(view.queryByRole('slider'),null)
 view.rerender(component([row(2,{hero_id:4})]));assert.equal(view.getByRole('combobox',{name:'ヒーロー',exact:true}).value,'4')
 assert.equal(view.container.querySelector('[data-selected-value]').textContent,'2回')
})
test('a saved-record refresh updates values while retaining a still-present inspected match',()=>{
 const records=Array.from({length:5},(_,i)=>row(i+1)),view=render(component(records))
 fireEvent.change(view.getByRole('slider'),{target:{value:'2'}})
 view.rerender(component([...records.map(r=>r.match_id==='2'?{...r,kills:0}:r),row(6)]))
 assert.equal(view.getByRole('slider').value,'2');assert.equal(view.container.querySelector('[data-selected-value]').textContent,'0回')
})
test('long hero names remain text, and the optional table gives every record, missing value and average',async()=>{
 const name='非常に長いヒーロー表示名'.repeat(9)+'<script>bad()</script>'
 manifest.heroes.push({id:'987654',name})
 try {
  const view=render(component(Array.from({length:6},(_,i)=>row(i+1,{hero_id:987654,kills:i===1?null:0}))))
  assert.ok(view.container.textContent.includes(name));assert.equal(view.container.querySelector('script'),null)
  assert.equal(view.queryByRole('table'),null)
  const details=view.container.querySelector('details');details.open=true;fireEvent(details,new window.Event('toggle'))
  await waitFor(()=>assert.ok(view.getByRole('table')))
  assert.equal(view.getAllByRole('row').length,7);assert.match(view.getByRole('table').textContent,/未取得/)
  assert.equal(view.getByRole('region',{name:/数値一覧/}).tabIndex,0)
  const select=view.getByRole('combobox',{name:'ヒーロー',exact:true});select.focus();assert.equal(document.activeElement,select)
 } finally {manifest.heroes.pop()}
})
test('month navigation delegates the same callbacks and honours both range boundaries',()=>{
 const calls=[],view=render(component([],{onMove:step=>calls.push(step),canPrevious:false,canNext:true}))
 assert.equal(view.getByRole('button',{name:'グラフの前の月'}).disabled,true)
 fireEvent.click(view.getByRole('button',{name:'グラフの次の月'}));assert.deepEqual(calls,[1])
 view.rerender(component([],{onMove:step=>calls.push(step),canNext:false}));fireEvent.click(view.getByRole('button',{name:'グラフの前の月'}));assert.deepEqual(calls,[1,-1])
})

// Deliberately ignore AbortSignal in these fake responses: the generation check
// must also reject responses that were already buffered when navigation occurs.
const today=tokyoDay(Date.now()),activeMonth=today.slice(0,7),previousMonth=shiftMonth(activeMonth,-1)
function snapshot(requested,revision=0){
 const day=requested===activeMonth?today:requested+'-01'
 return {identity:{steam_id:'76561197960265729'},month:requested,
  account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},
  matches:Array.from({length:6},(_,i)=>({match_id:requested.replace('-','')+String(i),started_at:day+`T0${i}:00:00+09:00`,
   hero_id:i===5?4:15,kills:(i===5?40:i+1)+revision,deaths:0,assists:(i===5?90:i+2)+revision,hero_damage:6000,duration_s:600})),
  observed:{count:100}}
}
async function racePage({remoteBusy=false}={}){
 const state={records:[],defer:false,sync:null}
 globalThis.fetch=async(input,options={})=>{
  if(input==='/api/deadhub/config')return Response.json({enabled:true})
  if(input==='/api/deadhub/profile')return Response.json({profile:null})
  if(input==='/api/deadhub/sync')return new Promise(resolve=>{state.sync=ok=>resolve(ok?Response.json({status:'success'}):Response.json({error:'DUMMY_SYNC_FAILURE'}, {status:503}))})
  if(input.startsWith('/api/deadhub/records?')){
   const requested=new URL(input,'https://dummy.example.test').searchParams.get('month')
   let release
   const first=state.records.length===0
   const result=new Promise(resolve=>{release=(revision=0,fail=false)=>{
    const body=snapshot(requested,revision)
    if(first&&remoteBusy)body.account.sync_status='running'
    resolve(fail?Response.json({code:'unauthorized',error:'DUMMY_OLD_FAILURE'},{status:401}):Response.json(body))
   }})
   state.records.push({month:requested,signal:options.signal,release})
   if(!state.defer)release()
   return result
  }
  throw Error('Unexpected mock route')
 }
 const view=render(React.createElement(Deadhub))
 await waitFor(()=>assert.ok(view.container.querySelector('.dh-trends svg')))
 return {...view,state}
}
const movePage=(view,step)=>fireEvent.click(view.getByRole('button',{name:step<0?'グラフの前の月':'グラフの次の月',exact:true}))
test('calendar and selected-day records precede trends, retaining header and shared month navigation',async()=>{
 const view=await racePage()
 const assertOrder=()=>{
  const panels=['登録と同期','プレイ記録カレンダー','日別サマリーと試合一覧','ヒーロー別の推移','照会範囲'].map(name=>view.getByRole('region',{name,exact:true}))
  for(let i=1;i<panels.length;i++)assert.ok(panels[i-1].compareDocumentPosition(panels[i])&Node.DOCUMENT_POSITION_FOLLOWING)
  assert.equal(view.container.querySelectorAll('.dh-trends').length,1)
  assert.ok(panels[0].contains(view.getByRole('button',{name:'最新の記録を取得',exact:true})))
  assert.ok(panels[0].contains(view.getByRole('button',{name:'ログアウト',exact:true})))
 }
 assertOrder()
 const otherDay=activeMonth+(today.endsWith('-01')?'-02':'-01')
 fireEvent.click(view.getByRole('button',{name:new RegExp('^'+otherDay+' ')}))
 assert.equal(view.container.querySelectorAll('.dh-match').length,0)
 assert.equal(view.container.querySelector('.dh-day[aria-pressed=true]').getAttribute('aria-label').startsWith(otherDay),true)
 assert.ok(view.container.querySelector('.dh-trends svg'))
 assertOrder()
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}))
 await waitFor(()=>assertMonth(view,previousMonth,'5回'))
 assertOrder()
 movePage(view,1)
 await waitFor(()=>assertMonth(view,activeMonth,'5回'))
 assertOrder()
})
function assertMonth(view,requested,value){
 const chart=view.getByRole('region',{name:'ヒーロー別の推移',exact:true}),[year,month]=requested.split('-').map(Number)
 assert.equal(chart.getAttribute('aria-busy'),'false')
 assert.equal(chart.querySelector('.dh-trend-month strong').textContent,`${year}年${month}月`)
 assert.ok(chart.querySelector('svg'))
 assert.equal(chart.querySelector('[data-selected-value]').textContent,value)
 assert.equal(view.container.querySelectorAll('.dh-match').length,6)
}
for(const ok of [true,false])test(`sync ${ok?'success':'failure'} refreshes the current month and preserves a hero/metric chosen during sync`,async()=>{
 const view=await racePage()
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 movePage(view,-1)
 await waitFor(()=>assertMonth(view,previousMonth,'5回'))
 fireEvent.change(view.getByRole('combobox',{name:'ヒーロー',exact:true}),{target:{value:'4'}})
 fireEvent.click(view.getByRole('button',{name:'アシスト（A）',exact:true}))
 await act(async()=>view.state.sync(ok))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false))
 assertMonth(view,previousMonth,'90回')
 assert.equal(view.getByRole('combobox',{name:'ヒーロー',exact:true}).value,'4')
 assert.equal(view.state.records.at(-1).month,previousMonth)
 if(!ok)assert.match(view.getByRole('alert').textContent,/DUMMY_SYNC_FAILURE/)
})
for(const fail of [false,true])test(`late old-month refresh ${fail?'failure':'success'} cannot replace the new month after sync`,async()=>{
 const view=await racePage()
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 view.state.defer=true
 await act(async()=>view.state.sync(true))
 await waitFor(()=>assert.equal(view.state.records.length,2))
 const old=view.state.records.at(-1)
 movePage(view,-1)
 await waitFor(()=>assert.equal(view.state.records.length,3))
 assert.equal(old.signal.aborted,true)
 await act(async()=>view.state.records.at(-1).release(7))
 await waitFor(()=>assertMonth(view,previousMonth,'12回'))
 await act(async()=>old.release(99,fail))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false))
 assertMonth(view,previousMonth,'12回')
 assert.equal(view.queryByRole('alert'),null)
})
for(const fail of [false,true])test(`repeated A-B-A navigation discards older same-month ${fail?'errors':'values'}`,async()=>{
 const view=await racePage()
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 view.state.defer=true
 for(const step of [-1,1,-1,1])movePage(view,step)
 await waitFor(()=>assert.equal(view.state.records.length,5))
 const pending=view.state.records.slice(1),latest=pending.pop()
 await act(async()=>latest.release(20))
 await waitFor(()=>assertMonth(view,activeMonth,'25回'))
 for(const old of pending.reverse()){
  assert.equal(old.signal.aborted,true)
  await act(async()=>old.release(99,fail))
  assertMonth(view,activeMonth,'25回')
 }
 fireEvent.change(view.getByRole('combobox',{name:'ヒーロー',exact:true}),{target:{value:'4'}})
 view.state.defer=false
 await act(async()=>view.state.sync(true))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false))
 assertMonth(view,activeMonth,'40回')
 assert.equal(view.queryByRole('alert'),null)
})
test('slow polling is not repeatedly aborted; sync refresh supersedes it and survives later ticks',async t=>{
 const intervals=[],original=globalThis.setInterval
 t.mock.method(globalThis,'setInterval',(callback,ms,...args)=>{
  if(ms===3000)intervals.push(callback)
  return original(callback,ms,...args)
 })
 const view=await racePage()
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 assert.equal(intervals.length,1)
 view.state.defer=true
 await act(async()=>{intervals[0]()})
 const oldPoll=view.state.records.at(-1)
 for(let i=0;i<3;i++)await act(async()=>{intervals[0]()})
 assert.equal(view.state.records.at(-1),oldPoll)
 assert.equal(oldPoll.signal.aborted,false)
 await act(async()=>view.state.sync(true))
 const finalRefresh=view.state.records.at(-1)
 assert.notEqual(finalRefresh,oldPoll)
 assert.equal(oldPoll.signal.aborted,true)
 await act(async()=>{intervals[0]()})
 assert.equal(view.state.records.at(-1),finalRefresh)
 assert.equal(finalRefresh.signal.aborted,false)
 await act(async()=>finalRefresh.release(15))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false))
 await waitFor(()=>assertMonth(view,activeMonth,'20回'))
 await act(async()=>oldPoll.release(99))
 assertMonth(view,activeMonth,'20回')
})
test('unmount cancels records and sync completion cannot start another month request',async()=>{
 const view=await racePage()
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}))
 view.state.defer=true;movePage(view,-1)
 const pending=view.state.records.at(-1),count=view.state.records.length
 view.unmount();assert.equal(pending.signal.aborted,true)
 await act(async()=>{pending.release(99);view.state.sync(true)})
 assert.equal(view.state.records.length,count)
})
test('remote sync finishes even when a records response spans several poll intervals',async t=>{
 const intervals=[],original=globalThis.setInterval
 t.mock.method(globalThis,'setInterval',(callback,ms,...args)=>{
  if(ms===3000)intervals.push(callback)
  return original(callback,ms,...args)
 })
 const view=await racePage({remoteBusy:true})
 assert.equal(view.getByRole('button',{name:'記録を取得中…',exact:true}).disabled,true)
 view.state.defer=true
 for(let i=0;i<5;i++)await act(async()=>{intervals[0]()})
 assert.equal(view.state.records.length,2)
 const pending=view.state.records.at(-1)
 assert.equal(pending.signal.aborted,false)
 await act(async()=>pending.release(30))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false))
 assertMonth(view,activeMonth,'35回')
 assert.equal(view.state.sync,null)
})
