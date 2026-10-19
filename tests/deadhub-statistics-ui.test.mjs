import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {statisticsFixture} from './fixtures/deadhub-statistics.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react')
const {default:AllTimeStats}=await import('../public-app/frontend/src/pages/Deadhub/AllTimeStats.jsx')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const originalFetch=globalThis.fetch
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
const toggle=view=>view.getByRole('button',{name:'全期間の統計',exact:true})
const panel=view=>view.getByRole('region',{name:'保存済み全期間の統計',exact:true})
const ready=async view=>waitFor(()=>assert.ok(view.container.querySelector('.dh-stats-overview')))

test('closed statistics make no request; opening labels saved scope, exact date range and partial averages',async()=>{
 const calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,options});return Response.json(statisticsFixture())}
 const view=render(React.createElement(AllTimeStats));assert.equal(calls.length,0);assert.equal(toggle(view).getAttribute('aria-expanded'),'false')
 fireEvent.click(toggle(view));await ready(view)
 assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/deadhub/statistics');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'same-origin')
 const text=panel(view).textContent
 for(const pattern of [/全ヒーロー/,/選択には連動しません/,/生涯の全試合ではありません/,/2025\/12\/31 JST/,/2026\/02\/02 JST/,/4試合/,/1勝 \/ 1敗/,/勝敗不明：2試合/,/50\.0%/,/勝敗判明 2試合が分母/])assert.match(text,pattern)
 const metric=key=>view.container.querySelector(`[data-metric=${key}]`).textContent
 assert.match(metric('kills'),/部分合計：6.*1試合平均：2\.0.*3 \/ 4試合/)
 assert.match(metric('duration_s'),/部分合計：1時間30分0秒.*1試合平均：2,700\.0秒/)
 assert.match(metric('assists'),/部分合計：0.*1試合平均：0\.0.*1 \/ 4試合/)
 assert.match(metric('player_healing'),/回復量（API提供値）/)
})
for(const mode of ['empty','missing','zero'])test(`statistics show ${mode} without turning missing values into zero`,async()=>{
 globalThis.fetch=async()=>Response.json(statisticsFixture(mode))
 const view=render(React.createElement(AllTimeStats));fireEvent.click(toggle(view));await ready(view)
 const metrics=view.container.querySelector('.dh-stats-metrics').textContent,overview=view.container.querySelector('.dh-stats-overview').textContent
 if(mode==='zero'){assert.match(metrics,/合計：0時間0分0秒/);assert.match(metrics,/1試合平均：0\.0/);assert.doesNotMatch(metrics,/未取得/)}
 else{assert.match(metrics,/合計：未取得.*1試合平均：未取得/);assert.doesNotMatch(metrics,/合計：0/)}
 assert.match(overview,/勝率未取得.*勝敗判明 0試合が分母/)
 if(mode==='empty'){assert.match(panel(view).textContent,/保存済みの試合はありません/);assert.equal(view.container.querySelectorAll('time').length,0)}
})
test('error and malformed responses hide totals; explicit retry and revision refresh recover',async()=>{
 let mode='error',reads=0
 globalThis.fetch=async()=>{reads++;return mode==='error'?Response.json({error:'PRIVATE_ERROR'},{status:503}):Response.json(mode==='malformed'?{}:statisticsFixture())}
 const view=render(React.createElement(AllTimeStats,{revision:0}));fireEvent.click(toggle(view))
 await waitFor(()=>assert.match(panel(view).textContent,/試合数や合計は不明/));assert.doesNotMatch(panel(view).textContent,/PRIVATE_|0試合/)
 mode='malformed';fireEvent.click(view.getByRole('button',{name:'統計を再確認'}));await waitFor(()=>assert.match(panel(view).textContent,/読み込めませんでした/))
 mode='success';fireEvent.click(view.getByRole('button',{name:'統計を再確認'}));await ready(view)
 view.rerender(React.createElement(AllTimeStats,{revision:1}));await ready(view);assert.equal(reads,4)
})
test('closing aborts pending reads and ignores late results on reopen',async()=>{
 const pending=[];globalThis.fetch=(_path,options)=>new Promise(resolve=>pending.push({signal:options.signal,resolve}))
 const view=render(React.createElement(AllTimeStats));fireEvent.click(toggle(view));assert.equal(pending.length,1)
 fireEvent.click(toggle(view));assert.equal(pending[0].signal.aborted,true);assert.equal(view.queryByRole('region'),null)
 fireEvent.click(toggle(view));assert.equal(pending.length,2)
 await act(async()=>pending[0].resolve(Response.json(statisticsFixture('zero'))))
 assert.match(panel(view).textContent,/読み込んでいます/);assert.equal(view.container.querySelector('.dh-stats-overview'),null)
 await act(async()=>pending[1].resolve(Response.json(statisticsFixture())));await ready(view)
 assert.match(panel(view).textContent,/50\.0%/)
})
test('refresh keeps keyboard focus and repeated activation during a read adds no request',async()=>{
 let reads=0,release
 globalThis.fetch=async()=>{reads++;return reads===1?Response.json(statisticsFixture()):new Promise(resolve=>{release=resolve})}
 const view=render(React.createElement(AllTimeStats));fireEvent.click(toggle(view));await ready(view)
 const refresh=view.getByRole('button',{name:'統計を再確認'});refresh.focus();fireEvent.click(refresh)
 assert.equal(refresh.getAttribute('aria-disabled'),'true');assert.equal(document.activeElement,refresh)
 fireEvent.click(refresh);assert.equal(reads,2)
 await act(async()=>release(Response.json(statisticsFixture())));await ready(view)
 assert.equal(refresh.getAttribute('aria-disabled'),'false');assert.equal(document.activeElement,refresh)
})
test('timeout ends loading and clears the request without leaking into the calendar',async t=>{
 let signal;globalThis.fetch=(_path,options)=>{signal=options.signal;return new Promise(()=>{})}
 const view=render(React.createElement(AllTimeStats));t.mock.timers.enable({apis:['setTimeout']})
 fireEvent.click(toggle(view));await act(async()=>t.mock.timers.tick(8000))
 assert.equal(signal.aborted,true);assert.equal(panel(view).getAttribute('aria-busy'),'false');assert.match(panel(view).textContent,/読み込めませんでした/)
 t.mock.timers.reset()
})
test('statistics remain independent of calendar, monthly hero filters and current-month navigation, including failures',async()=>{
 const today=tokyoDay(Date.now()),calls=[];let fail=false
 globalThis.fetch=async(path,options={})=>{
  calls.push(path);assert.equal(options.method??'GET','GET')
  if(path==='/api/deadhub/config')return Response.json({enabled:true,auth:'steam'})
  if(path==='/api/deadhub/profile')return Response.json({profile:null})
  if(path==='/api/deadhub/statistics')return fail?Response.json({error:'PRIVATE_STATS'},{status:401}):Response.json(statisticsFixture())
  assert.match(path,/^\/api\/deadhub\/records\?month=/)
  const month=new URL(path,'https://local.test').searchParams.get('month')
  return Response.json({identity:{steam_id:accountIdToSteamId('1')},month,account:{sync_status:'success'},observed:{count:1},matches:[{match_id:'1',started_at:month+'-01T12:00:00+09:00',hero_id:15,final_items:[]}]})
 }
 const view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 fireEvent.click(toggle(view));await ready(view)
 const statText=panel(view).textContent,list=view.getByRole('combobox',{name:'一覧のヒーロー',exact:true})
 fireEvent.change(list,{target:{value:'15'}})
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}));await waitFor(()=>assert.equal(list.disabled,false))
 fireEvent.click(view.getByRole('button',{name:'今月へ',exact:true}));await waitFor(()=>assert.equal(list.disabled,false))
 assert.equal(list.value,'15');assert.equal(panel(view).textContent,statText);assert.equal(calls.filter(p=>p==='/api/deadhub/statistics').length,1)
 assert.match(view.container.querySelector('.dh-day[aria-pressed=true]').getAttribute('aria-label'),new RegExp('^'+today))
 const grid=view.container.querySelector('.dh-grid').innerHTML,summary=view.container.querySelector('.dh-day-summary').textContent,matches=view.getByRole('region',{name:'試合一覧',exact:true}).textContent
 fail=true;fireEvent.click(view.getByRole('button',{name:'統計を再確認'}));await waitFor(()=>assert.match(panel(view).textContent,/読み込めませんでした/))
 assert.equal(view.container.querySelector('.dh-grid').innerHTML,grid);assert.equal(view.container.querySelector('.dh-day-summary').textContent,summary)
 assert.equal(view.getByRole('region',{name:'試合一覧',exact:true}).textContent,matches);assert.doesNotMatch(panel(view).textContent,/PRIVATE_STATS/)
 assert.equal(view.queryByRole('button',{name:'Steamでログインする'}),null)
})
