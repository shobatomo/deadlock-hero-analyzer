import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {historyFixture,historyRows} from './fixtures/deadhub-trend-history.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react')
const {default:MatchTrends}=await import('../public-app/frontend/src/pages/Deadhub/MatchTrends.jsx')
const originalFetch=globalThis.fetch,rows=historyRows(),monthly=rows.slice(2,33),heroRows=[...rows,...historyRows(6).map((row,i)=>({...row,hero_id:4,match_id:String(1000+i),kills:1000}))]
const component=(props={})=>React.createElement(MatchTrends,{rows:monthly,month:'2026-01',onMove:()=>{},...props})
const enter=view=>fireEvent.click(view.getByRole('button',{name:'保存済み全期間',exact:true}))
const ready=view=>waitFor(()=>assert.equal(view.getByRole('region',{name:'ヒーロー別の推移'}).getAttribute('aria-busy'),'false'))
const value=view=>view.container.querySelector('[data-selected-value]')?.textContent
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
function mockReads(source=heroRows){const calls=[];globalThis.fetch=async(path,options)=>{calls.push({path,options});const q=new URL(path,'https://dummy.test').searchParams;return Response.json(historyFixture({rows:source,heroId:q.get('hero_id')??null,page:Number(q.get('page'))}))};return calls}

test('all-period fetch is lazy, paginated with previous context, and metric/ calendar changes never refetch it',async()=>{
 const calls=mockReads(),view=render(component());assert.equal(calls.length,0)
 enter(view);await ready(view)
 assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.credentials,'same-origin')
 assert.match(view.container.textContent,/生涯の全履歴を保証するものではありません/);assert.match(view.container.textContent,/2025\/12\/30.*2027\/02\/07/)
 assert.equal(view.getByRole('slider').max,'200');assert.match(view.container.textContent,/描画：1–200 \/ 405試合/)
 assert.equal(view.getByRole('img').getAttribute('data-axis-maximum'),'1000')
 fireEvent.click(view.getByRole('button',{name:'次の200試合'}));await ready(view)
 assert.match(view.container.textContent,/描画：201–400 \/ 405試合/)
 fireEvent.change(view.getByRole('slider'),{target:{value:'1'}});assert.equal(view.container.querySelector('[data-selected-average]').textContent,'—')
 fireEvent.change(view.getByRole('slider'),{target:{value:'3'}});assert.equal(view.container.querySelector('[data-selected-average]').textContent,'201回')
 assert.match(view.getByRole('slider').getAttribute('aria-valuetext'),/^第203試合/)
 fireEvent.click(view.getByRole('button',{name:'デス（D）',exact:true}));assert.equal(value(view),'0回');assert.equal(view.container.querySelector('[data-selected-average]').textContent,'0回')
 fireEvent.click(view.getByRole('button',{name:'ダメージ/分',exact:true}));fireEvent.change(view.getByRole('slider'),{target:{value:'1'}});assert.equal(value(view),'未取得')
 view.rerender(component({month:'2025-12',rows:[],pending:true,readFailed:true}));assert.equal(calls.length,2);assert.ok(view.getByRole('img'));assert.equal(view.queryByRole('button',{name:'グラフの前の月'}),null)
 fireEvent.click(view.getByRole('button',{name:'次の200試合'}));await ready(view);assert.equal(view.getByRole('slider').max,'5')
 assert.equal(view.getByRole('button',{name:'次の200試合'}).getAttribute('aria-disabled'),'true')
 fireEvent.click(view.getByRole('button',{name:'次の200試合'}));assert.equal(calls.length,3)
})
test('hero change retains metric and shared all-period axis, resets page, and optional table stays bounded',async()=>{
 const calls=mockReads(),view=render(component());enter(view);await ready(view)
 fireEvent.click(view.getByRole('button',{name:'次の200試合'}));await ready(view)
 fireEvent.change(view.getByRole('combobox'),{target:{value:'4'}});await ready(view)
 assert.equal(value(view),'1,000回');assert.equal(view.getByRole('slider').max,'6');assert.equal(view.getByRole('img').getAttribute('data-axis-maximum'),'1000')
 assert.match(calls.at(-1).path,/page=1&hero_id=4/)
 fireEvent.change(view.getByRole('combobox'),{target:{value:'15'}});await ready(view)
 const details=view.container.querySelector('details');details.open=true;fireEvent(details,new window.Event('toggle'))
 await waitFor(()=>assert.equal(view.getAllByRole('row').length,201))
 fireEvent.click(view.getByRole('button',{name:'表示中の月',exact:true}));assert.equal(view.getByRole('slider').max,'31')
})
test('empty all-time data remains distinct from failure and malformed data never fabricates a zero graph',async()=>{
 let mode='empty';globalThis.fetch=async()=>mode==='error'?Response.json({}, {status:503}):Response.json(mode==='malformed'?{}:historyFixture({rows:[],heroId:'15'}))
 const view=render(component());enter(view);await ready(view)
 assert.equal(view.queryByRole('img'),null);assert.match(view.container.textContent,/保存済み全期間：0試合/)
 for(const state of ['error','malformed']){mode=state;fireEvent.click(view.getByRole('button',{name:'グラフを再確認'}));await ready(view);assert.match(view.container.textContent,/読み込めませんでした.*前回取得した範囲/);assert.equal(view.queryByRole('img'),null)}
})
test('failed refresh preserves successful graph and focus, retry and sync revision reread saved records',async()=>{
 let fail=false,reads=0;globalThis.fetch=async()=>{reads++;return fail?Response.json({}, {status:503}):Response.json(historyFixture())}
 const view=render(component());enter(view);await ready(view);const previous=value(view),refresh=view.getByRole('button',{name:'グラフを再確認'})
 refresh.focus();fail=true;fireEvent.click(refresh);await ready(view)
 assert.equal(value(view),previous);assert.match(view.container.textContent,/前回取得した範囲/);assert.equal(document.activeElement,refresh)
 fail=false;fireEvent.click(refresh);await ready(view);view.rerender(component({revision:1}));await ready(view);assert.equal(reads,4)
})
for(const fail of [false,true])test(`late ${fail?'failure':'success'} after scope or hero switch is ignored even when abort is ignored`,async()=>{
 const requests=[];globalThis.fetch=(path,options)=>new Promise(resolve=>requests.push({path,signal:options.signal,resolve}))
 const view=render(component());enter(view);assert.equal(requests.length,1)
 fireEvent.click(view.getByRole('button',{name:'表示中の月',exact:true}));assert.equal(requests[0].signal.aborted,true)
 enter(view);assert.equal(requests.length,2)
 await act(async()=>requests[1].resolve(Response.json(historyFixture({rows:heroRows}))))
 await ready(view);const before=value(view)
 await act(async()=>requests[0].resolve(fail?Response.json({}, {status:503}):Response.json(historyFixture({rows:[]}))))
 assert.equal(value(view),before);assert.doesNotMatch(view.container.textContent,/読み込めません/)
 fireEvent.change(view.getByRole('combobox'),{target:{value:'4'}})
 fireEvent.change(view.getByRole('combobox'),{target:{value:'15'}})
 assert.equal(requests[2].signal.aborted,true)
 await act(async()=>requests[3].resolve(Response.json(historyFixture({rows:heroRows}))))
 await act(async()=>requests[2].resolve(fail?Response.json({}, {status:503}):Response.json(historyFixture({rows:heroRows,heroId:'4'}))))
 assert.equal(view.getByRole('combobox').value,'15');assert.equal(value(view),before)
})
test('eight-second timeout settles even if transport ignores abort; late response cannot overwrite failure',async t=>{
 let resolve,signal;globalThis.fetch=(_path,options)=>{signal=options.signal;return new Promise(r=>resolve=r)}
 const view=render(component());t.mock.timers.enable({apis:['setTimeout']});enter(view)
 await act(async()=>t.mock.timers.tick(8001));assert.equal(signal.aborted,true);assert.match(view.container.textContent,/読み込めませんでした/)
 await act(async()=>resolve(Response.json(historyFixture())));assert.equal(view.queryByRole('img'),null)
 t.mock.timers.reset()
})
test('a mismatched hero/page response is not relabeled as the requested graph',async()=>{
 globalThis.fetch=async()=>Response.json(historyFixture({heroId:'4'}))
 const view=render(component());enter(view);await ready(view)
 assert.match(view.container.textContent,/読み込めませんでした/);assert.equal(view.queryByRole('img'),null)
})
test('leaving during a page request cancels it, including when account identity causes unmount',async()=>{
 let next,signal;globalThis.fetch=async path=>path.includes('page=1')?Response.json(historyFixture()):new Promise(resolve=>next=resolve)
 const initialFetch=globalThis.fetch;globalThis.fetch=(path,options)=>{signal=options.signal;return initialFetch(path)}
 const view=render(component());enter(view);await ready(view);fireEvent.click(view.getByRole('button',{name:'次の200試合'}))
 assert.equal(signal.aborted,false);view.unmount();assert.equal(signal.aborted,true)
 await act(async()=>next(Response.json(historyFixture({page:2}))));assert.equal(document.querySelector('.dh-trends'),null)
})
