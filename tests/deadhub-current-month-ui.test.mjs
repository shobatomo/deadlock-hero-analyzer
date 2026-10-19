// Synthetic monthly snapshots only. No network, authentication or synchronization.
import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const originalFetch=globalThis.fetch
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
async function page(t,stamp='2027-01-15T03:00:00Z'){
 const state={now:Date.parse(stamp),calls:[],pending:[],defer:false,fail:false}
 t.mock.method(Date,'now',()=>state.now)
 globalThis.fetch=async(input,options={})=>{
  const path=String(input);assert.equal(options.method??'GET','GET');state.calls.push(path)
  if(path==='/api/deadhub/config')return Response.json({enabled:true,auth:'steam'})
  if(path==='/api/deadhub/profile')return Response.json({profile:null})
  assert.match(path,/^\/api\/deadhub\/records\?month=/)
  const month=new URL(path,'https://local.test').searchParams.get('month')
  const matches=[15,4].map((hero_id,index)=>({match_id:month+'-'+hero_id,started_at:month+'-02T12:00:00+09:00',hero_id,won:true,kills:index,deaths:0,assists:null,final_items:[]}))
  const response=()=>state.fail?Response.json({error:'テスト用の月読取り失敗'},{status:503}):Response.json({identity:{steam_id:accountIdToSteamId('1')},month,account:{sync_status:'success',last_success_at:stamp},matches,observed:{count:2}})
  if(state.defer)return new Promise(resolve=>state.pending.push({month,signal:options.signal,release:(value=response())=>resolve(value)}))
  return response()
 }
 const view=render(React.createElement(Deadhub))
 await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 await waitFor(()=>assert.ok(state.calls.includes('/api/deadhub/profile')))
 const heading=()=>view.container.querySelector('.dh-month h3').textContent
 const current=()=>view.getByRole('button',{name:'今月へ',exact:true})
 const monthReads=()=>state.calls.filter(path=>path.startsWith('/api/deadhub/records?'))
 const selected=()=>view.container.querySelector('.dh-day[aria-pressed=true]')?.getAttribute('aria-label').slice(0,10)
 const go=async label=>{const n=monthReads().length;fireEvent.click(view.getByRole('button',{name:label,exact:true}));await waitFor(()=>assert.equal(monthReads().length,n+1));await waitFor(()=>assert.equal(view.getByRole('combobox',{name:'一覧のヒーロー',exact:true}).disabled,false))}
 return {...view,state,heading,current,monthReads,selected,go}
}

test('current month shortcut is disabled and does not change a chosen day or filter',async t=>{
 const view=await page(t),select=view.getByRole('combobox',{name:'一覧のヒーロー',exact:true})
 fireEvent.click(view.getByRole('button',{name:/^2027-01-02 /}));fireEvent.change(select,{target:{value:'15'}})
 const calls=view.state.calls.length
 assert.equal(view.current().disabled,true);assert.equal(view.current().title,'今月を表示中')
 fireEvent.click(view.current())
 assert.equal(view.selected(),'2027-01-02');assert.equal(select.value,'15');assert.equal(view.state.calls.length,calls)
})

test('one current-month action jumps across months and preserves independent hero filters',async t=>{
 const view=await page(t),list=view.getByRole('combobox',{name:'一覧のヒーロー',exact:true}),graph=view.getByRole('combobox',{name:'ヒーロー',exact:true})
 fireEvent.change(list,{target:{value:'15'}});fireEvent.change(graph,{target:{value:'4'}})
 fireEvent.click(view.getByRole('button',{name:'アシスト（A）',exact:true}))
 for(let i=0;i<3;i++)await view.go('前の月')
 assert.equal(view.heading(),'2026年10月');assert.equal(view.selected(),'2026-10-01');assert.equal(view.current().disabled,false)
 const before=view.monthReads().length;await view.go('今月へ')
 assert.equal(view.heading(),'2027年1月');assert.equal(view.selected(),'2027-01-15')
 assert.equal(view.monthReads().length,before+1);assert.equal(list.value,'15');assert.equal(graph.value,'4')
 assert.equal(view.getByRole('button',{name:'アシスト（A）',exact:true}).getAttribute('aria-pressed'),'true')
 assert.match(view.container.querySelector('.dh-day-summary').textContent,/未同期・未確認/)
 assert.doesNotMatch(view.container.querySelector('.dh-day-summary').textContent,/試合を取得/)
 assert.equal(view.current().disabled,true)
})

for(const [stamp,expected] of [
 ['2026-01-31T14:59:59Z','2026-01-31'],['2026-01-31T15:00:00Z','2026-02-01'],
 ['2028-02-29T14:59:59Z','2028-02-29'],['2028-02-29T15:00:00Z','2028-03-01'],
 ['2026-12-31T14:59:59Z','2026-12-31'],['2026-12-31T15:00:00Z','2027-01-01']
])test(`current month and selected day follow JST at ${stamp}`,async t=>{
 const view=await page(t,stamp);await view.go('前の月');await view.go('今月へ')
 assert.equal(view.selected(),expected);assert.equal(view.monthReads().at(-1),'/api/deadhub/records?month='+expected.slice(0,7))
 assert.equal(view.container.querySelectorAll('.dh-day').length,new Date(Date.UTC(+expected.slice(0,4),+expected.slice(5,7),0)).getUTCDate())
})

test('resuming across a JST year boundary updates the shortcut without reading or moving automatically',async t=>{
 const view=await page(t,'2026-12-31T14:59:59Z'),before=view.state.calls.length
 view.state.now=Date.parse('2026-12-31T15:00:01Z')
 fireEvent(document,new Event('visibilitychange'))
 assert.equal(view.heading(),'2026年12月');assert.equal(view.selected(),'2026-12-31')
 assert.equal(view.current().disabled,false);assert.equal(view.state.calls.length,before)
 await view.go('今月へ');assert.equal(view.selected(),'2027-01-01');assert.equal(view.current().disabled,true)
})

for(const failed of [false,true])test(`jump aborts the pending old month and ignores its late ${failed?'error':'success'}`,async t=>{
 const view=await page(t);view.state.defer=true
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}));await waitFor(()=>assert.equal(view.state.pending.length,1))
 fireEvent.click(view.current());await waitFor(()=>assert.equal(view.state.pending.length,2))
 assert.equal(view.state.pending[0].signal.aborted,true)
 await act(async()=>view.state.pending[1].release())
 await act(async()=>view.state.pending[0].release(failed?Response.json({error:'古い月の失敗'},{status:503}):undefined))
 assert.equal(view.heading(),'2027年1月');assert.equal(view.selected(),'2027-01-15');assert.equal(view.queryByRole('alert'),null)
})

test('failed current-month read retains failure semantics and recovers using existing month navigation',async t=>{
 const view=await page(t);await view.go('前の月');view.state.fail=true
 fireEvent.click(view.current());await waitFor(()=>assert.ok(view.queryByRole('alert')))
 assert.equal(view.current().disabled,true);assert.equal(view.heading(),'2027年1月')
 const list=view.getByRole('region',{name:'試合一覧',exact:true})
 assert.equal(list.getAttribute('aria-busy'),'false');assert.match(list.textContent,/読み込めませんでした/)
 assert.doesNotMatch(list.textContent,/読み込み中|0試合|該当する試合はありません/)
 assert.match(view.container.querySelector('.dh-day-summary').textContent,/読取り失敗/)
 view.state.fail=false;await view.go('前の月');await view.go('今月へ')
 assert.equal(view.queryByRole('alert'),null);assert.equal(view.selected(),'2027-01-15')
 assert.ok(view.state.calls.every(path=>path==='/api/deadhub/config'||path==='/api/deadhub/profile'||path.startsWith('/api/deadhub/records?')))
})
