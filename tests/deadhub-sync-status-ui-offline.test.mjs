// JSDOM + synthetic responses; never authenticates or invokes real sync/cron.
import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {auditRun,auditSource,auditSnapshot,mixedAudit} from './fixtures/deadhub-sync-runs.mjs'
import {syncRunSnapshot,syncDate,syncReason} from '../public-app/frontend/src/pages/Deadhub/syncRunView.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react')
const {default:SyncRunDetails}=await import('../public-app/frontend/src/pages/Deadhub/SyncRunDetails.jsx')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const originalFetch=globalThis.fetch
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch outside fixture')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const toggle=view=>view.getByRole('button',{name:'同期の実行状況'})
const panel=view=>view.getByRole('region',{name:'同期の実行記録'})
const source=(view,index=0)=>panel(view).querySelectorAll('.dh-run-source')[index]
async function open(view){fireEvent.click(toggle(view));await waitFor(()=>assert.equal(panel(view).getAttribute('aria-busy'),'false'))}
function mockAudit(response=()=>Response.json(auditSnapshot())) {
  const calls=[];globalThis.fetch=(path,options)=>{calls.push({path,options});return response(path,options)};return calls
}

test('snapshot keeps zero, converts UTC across midnight to JST, and rejects missing evidence',()=>{
 const data=syncRunSnapshot(mixedAudit());assert.equal(data.sources.manual.latest.processed_count,0)
 assert.equal(syncDate('2026-10-18T21:00:00Z'),'2026/10/19 06:00 JST')
 for(const edit of [v=>v.available=false,v=>delete v.sources.manual,v=>v.cron_origin_verified=true,v=>v.evidence='other',v=>v.observed_at='invalid',v=>v.sources.manual.latest.outcome='unknown',v=>v.sources.manual.latest.outcome=['success'],v=>v.sources.manual.latest.processed_count=null,v=>v.sources.manual.unfinished_count=0,v=>v.sources.manual.oldest_unfinished_at=null,v=>v.sources.manual.last_success.outcome='failed',v=>v.sources.manual.latest=null]) {
  const bad=mixedAudit();edit(bad);assert.throws(()=>syncRunSnapshot(bad))
 }
 assert.equal(syncReason(auditRun('failed',{result_code:'<script>private-token</script>'})),'取得を完了できませんでした。')
})
test('closed by default; opening uses one authenticated same-origin GET with no owner selector',async()=>{
 const calls=mockAudit(),view=render(React.createElement(SyncRunDetails))
 assert.equal(calls.length,0);assert.equal(toggle(view).getAttribute('aria-expanded'),'false');assert.equal(view.queryByRole('region'),null)
 await open(view);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/deadhub/sync-runs')
 assert.deepEqual(Object.keys(calls[0].options).sort(),['cache','credentials','signal'])
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store')
 assert.equal(toggle(view).getAttribute('aria-controls'),panel(view).id)
 assert.equal(panel(view).querySelectorAll('.dh-run-empty').length,3)
 assert.match(panel(view).textContent,/実行されていないとは限りません/)
 assert.match(panel(view).textContent,/予定どおりの自動実行を証明するものではありません/)
 assert.match(panel(view).textContent,/2026\/10\/19 09:15 JST/)
})
for(const [outcome,label] of [['success','成功'],['failed','失敗'],['partial','一部取得'],['skipped','スキップ'],['started','未完了（終了記録なし）']])test(`renders ${outcome} as distinct recorded evidence`,async()=>{
 mockAudit(()=>Response.json(auditSnapshot({manual:auditSource(auditRun(outcome))})))
 const view=render(React.createElement(SyncRunDetails));await open(view)
 assert.equal(source(view).querySelector('.dh-run-outcome').textContent,label)
 assert.equal(source(view).querySelector('time').textContent,'2026/10/19 06:00 JST')
 if(outcome==='success')assert.match(source(view).textContent,/処理した記録0件/)
 if(outcome==='started')assert.match(source(view).textContent,/実行中・中断・記録の欠損を区別できません/)
})
test('newer success does not hide previous failure or unresolved start records',async()=>{
 mockAudit(()=>Response.json(mixedAudit()));const view=render(React.createElement(SyncRunDetails));await open(view)
 assert.match(source(view).textContent,/直近の失敗：2026\/10\/18 08:00 JST/)
 assert.match(source(view).textContent,/終了記録なし：2件/)
 assert.match(source(view).textContent,/最も古い開始：2026\/10\/16 09:00 JST/)
 assert.match(source(view,2).textContent,/前回の成功：2026\/10\/18 06:00 JST/)
 assert.match(panel(view).textContent,/新規の試合数ではありません/)
})
for(const [name,response] of [
 ['http',()=>Response.json({error:'PRIVATE_ERROR'},{status:500})],
 ['unauthorized',()=>Response.json({error:'PRIVATE_AUTH'},{status:401})],
 ['network',()=>Promise.reject(Error('PRIVATE_NETWORK'))],
 ['invalid JSON',()=>new Response('PRIVATE_JSON')],
 ['unavailable',()=>Response.json({available:false,sources:null})],
 ['malformed',()=>Response.json({...auditSnapshot(),sources:{}})],
])test(`${name} is unknown execution status, not empty history; retry recovers`,async()=>{
 let fail=true;const calls=mockAudit(()=>fail?response():Response.json(mixedAudit())),view=render(React.createElement(SyncRunDetails));await open(view)
 assert.match(panel(view).textContent,/実行の有無・結果は不明/);assert.doesNotMatch(panel(view).textContent,/PRIVATE_|実行記録なし/)
 assert.equal(panel(view).querySelectorAll('.dh-run-source').length,0)
 if(name==='unauthorized')assert.match(panel(view).textContent,/ログイン状態を確認できません/)
 fail=false;fireEvent.click(view.getByRole('button',{name:'状況を再確認'}))
 await waitFor(()=>assert.equal(panel(view).querySelectorAll('.dh-run-source').length,3));assert.equal(calls.length,2)
})
test('close cancels pending request; ignored abort and stale response cannot replace reopened data',async()=>{
 const old=deferred();const calls=mockAudit(()=>calls.length===1?old.promise:Response.json(mixedAudit())),view=render(React.createElement(SyncRunDetails))
 fireEvent.click(toggle(view));assert.ok(view.getByRole('button',{name:'状況を再確認'}).disabled)
 fireEvent.click(toggle(view));assert.equal(calls[0].options.signal.aborted,true)
 await open(view);await act(async()=>old.resolve(Response.json(auditSnapshot())))
 assert.equal(source(view).querySelector('.dh-run-outcome').textContent,'成功');assert.equal(calls.length,2)
})
test('timeout settles loading even when fetch ignores abort and late success is ignored',async t=>{
 const pending=deferred(),calls=mockAudit(()=>pending.promise),view=render(React.createElement(SyncRunDetails))
 t.mock.timers.enable({apis:['setTimeout']})
 fireEvent.click(toggle(view));await act(async()=>t.mock.timers.tick(8000))
 assert.equal(calls[0].options.signal.aborted,true);assert.match(panel(view).textContent,/時間内に読み込めません/)
 await act(async()=>pending.resolve(Response.json(mixedAudit())));assert.equal(panel(view).querySelectorAll('.dh-run-source').length,0)
 t.mock.timers.reset()
})
test('revision refreshes an open disclosure, clears old evidence on failure, but never fetches while closed',async()=>{
 let fail=false;const calls=mockAudit(()=>fail?Response.json({available:false}):Response.json(mixedAudit())),view=render(React.createElement(SyncRunDetails,{revision:0}))
 view.rerender(React.createElement(SyncRunDetails,{revision:1}));assert.equal(calls.length,0);await open(view)
 fail=true;view.rerender(React.createElement(SyncRunDetails,{revision:2}))
 await waitFor(()=>assert.match(panel(view).textContent,/実行の有無・結果は不明/));assert.equal(source(view),undefined)
 fireEvent.click(toggle(view));view.rerender(React.createElement(SyncRunDetails,{revision:3}));assert.equal(calls.length,2)
})

function mockPage({account=true,signedIn=true,syncFailure=false}={}) {
 const today=tokyoDay(Date.now()),month=today.slice(0,7),calls=[],state={id:'1',audit:()=>Response.json(mixedAudit()),signedIn}
 globalThis.fetch=async(path,options={})=>{
  calls.push({path,options});assert.ok(path.startsWith('/api/deadhub/'))
  if(path==='/api/deadhub/config')return Response.json({enabled:true,auth:'steam'})
  if(path==='/api/deadhub/profile')return Response.json({profile:null})
  if(path==='/api/deadhub/sync-runs')return state.audit()
  if(path.startsWith('/api/deadhub/records?')) {
   if(!state.signedIn)return Response.json({code:'unauthorized'},{status:401})
   const requested=new URL(path,'https://example.test').searchParams.get('month')
   return Response.json({identity:{steam_id:accountIdToSteamId(state.id)},sync_mode:'daily',month:requested,account:account?{sync_status:'success',last_success_at:today+'T06:00:00+09:00'}:null,matches:requested===month?[{match_id:'901',started_at:today+'T01:00:00+09:00',hero_id:15,won:true,kills:0,deaths:1,assists:2,final_items:[]}]:[],observed:{count:1}})
  }
  if(path==='/api/deadhub/sync'||path==='/api/deadhub/register')return syncFailure?Response.json({error:'模擬取得エラー'},{status:503}):Response.json({status:'success'})
  if(path==='/api/deadhub/auth/logout'){state.signedIn=false;return Response.json({ok:true})}
  throw Error('Unexpected route '+path)
 };return {calls,state}
}
test('audit-only read failure keeps calendar and saved matches; month/day/filter navigation does not reread audit',async()=>{
 const {calls,state}=mockPage();state.audit=()=>Response.json({available:false})
 const view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 const calendar=view.container.querySelector('.dh-calendar').innerHTML;await open(view)
 assert.match(panel(view).textContent,/実行の有無・結果は不明/)
 assert.equal(view.container.querySelector('.dh-calendar').innerHTML,calendar);assert.equal(view.container.querySelectorAll('.dh-match').length,1)
 fireEvent.change(view.getByRole('combobox',{name:'一覧のヒーロー'}),{target:{value:'15'}})
 fireEvent.click(view.container.querySelector('.dh-day'));fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}))
 await waitFor(()=>assert.equal(view.container.querySelectorAll('.dh-match').length,0))
 assert.equal(calls.filter(c=>c.path==='/api/deadhub/sync-runs').length,1)
})
for(const [name,options] of [['manual',{}],['failed manual',{syncFailure:true}],['registration',{account:false}]])test(`${name} attempt refreshes open audit independently`,async()=>{
 const {calls}=mockPage(options),view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.queryByRole('button',{name:'同期の実行状況'})))
 await open(view);fireEvent.click(view.getByRole('button',{name:options.account===false?'このアカウントを登録して過去30日を取得':'最新の記録を取得',exact:true}))
 await waitFor(()=>assert.equal(calls.filter(c=>c.path==='/api/deadhub/sync-runs').length,2))
 assert.ok(calls.some(c=>c.path===(options.account===false?'/api/deadhub/register':'/api/deadhub/sync')&&c.options.method==='POST'))
})
test('signed-out page does not mount or request audit',async()=>{
 const {calls}=mockPage({signedIn:false}),view=render(React.createElement(Deadhub))
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'Steamでログインする'}).disabled,false))
 assert.equal(view.queryByRole('button',{name:'同期の実行状況'}),null);assert.ok(!calls.some(c=>c.path==='/api/deadhub/sync-runs'))
})
test('logout aborts audit; late response cannot recreate private details',async()=>{
 const {calls,state}=mockPage(),pending=deferred();state.audit=()=>pending.promise
 const view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 fireEvent.click(toggle(view));fireEvent.click(view.getByRole('button',{name:'ログアウト'}))
 await waitFor(()=>assert.ok(view.queryByRole('button',{name:'Steamでログインする'})))
 assert.equal(calls.find(c=>c.path==='/api/deadhub/sync-runs').options.signal.aborted,true)
 await act(async()=>pending.resolve(Response.json(mixedAudit())));assert.equal(view.queryByRole('region',{name:'同期の実行記録'}),null)
})
test('identity change resets disclosure and cancels prior user request',async()=>{
 const {calls,state}=mockPage(),pending=deferred();state.audit=()=>pending.promise
 const view=render(React.createElement(Deadhub));await waitFor(()=>assert.ok(view.container.querySelector('.dh-calendar')))
 fireEvent.click(toggle(view));state.id='2';fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}))
 await waitFor(()=>assert.equal(toggle(view).getAttribute('aria-expanded'),'false'))
 assert.equal(calls.find(c=>c.path==='/api/deadhub/sync-runs').options.signal.aborted,true)
 await act(async()=>pending.resolve(Response.json(mixedAudit())));assert.equal(view.queryByRole('region',{name:'同期の実行記録'}),null)
 assert.equal(calls.filter(c=>c.path==='/api/deadhub/sync-runs').length,1)
})
