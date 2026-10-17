import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://invite.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const savedFetch=globalThis.fetch,today=tokyoDay(Date.now())
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected request')}})
after(()=>{globalThis.fetch=savedFetch;dom.window.close()})
function setup({mode='manual',registered=true,signedIn=true,failFirst=false,paused=false}={}){
  const state={registers:0,syncs:0,registered,signedIn,mode,error:false}
  globalThis.fetch=async(path,options={})=>{
    assert.ok(String(path).startsWith('/api/deadhub/'))
    if(path==='/api/deadhub/config')return Response.json({enabled:true})
    if(path==='/api/deadhub/profile')return Response.json({profile:null})
    if(String(path).startsWith('/api/deadhub/records?')){
      if(!state.signedIn)return Response.json({code:'unauthorized',error:'Steamでログインしてください。'},{status:401})
      const month=new URL(path,'https://invite.example.test').searchParams.get('month')
      return Response.json({identity:{steam_id:accountIdToSteamId(mode==='daily'?'1':'2')},sync_mode:mode,month,
        account:state.registered?{sync_status:state.error?'error':'success',sync_paused:paused,last_success_at:state.error?null:today+'T06:00:00+09:00'}:null,
        matches:[],observed:{count:0}})
    }
    if(path==='/api/deadhub/register'||path==='/api/deadhub/sync'){
      assert.equal(options.body,'{}');assert.equal(options.method,'POST')
      if(path.endsWith('/register')){state.registers++;state.registered=true}else state.syncs++
      if(failFirst&&state.registers===1&&state.syncs===0){state.error=true;return Response.json({code:'rate_limited',error:'提供元の取得制限に達しました。時間をおいてお試しください。'},{status:502})}
      state.error=false;return Response.json({status:'success'})
    }
    throw Error('Unexpected fixture route')
  }
  return {state,...render(React.createElement(Deadhub))}
}
test('invited user sees manual-only guidance before registration and after initial registration',async()=>{
  const view=setup({registered:false})
  const button=await view.findByRole('button',{name:'このアカウントを登録して過去30日を取得'})
  assert.match(view.container.textContent,/記録は手動で更新します。自動取得はありません。/)
  assert.ok(!view.container.textContent.includes('毎朝'))
  fireEvent.click(button);await view.findByRole('button',{name:'最新の記録を取得'})
  assert.equal(view.state.registers,1);assert.match(view.container.textContent,/から手動で更新してください/)
})
test('owner retains daily schedule and manual refresh; missing mode never promises automation',async()=>{
  const daily=setup({mode:'daily'});await daily.findByRole('button',{name:'最新の記録を取得'})
  assert.match(daily.container.textContent,/毎朝6時台/);assert.match(daily.container.textContent,/毎朝の自動取得と手動更新/)
  daily.unmount()
  const unknown=setup({mode:null});await unknown.findByRole('button',{name:'最新の記録を取得'})
  assert.ok(!unknown.container.textContent.includes('毎朝'))
})
test('first acquisition failure preserves registration and offers a manual retry instead of re-registering',async()=>{
  const view=setup({registered:false,failFirst:true})
  fireEvent.click(await view.findByRole('button',{name:'このアカウントを登録して過去30日を取得'}))
  await view.findByRole('alert');const retry=await view.findByRole('button',{name:'最新の記録を取得'})
  assert.match(view.container.textContent,/前回の取得に失敗/);assert.equal(view.queryByRole('button',{name:'このアカウントを登録して過去30日を取得'}),null)
  fireEvent.click(retry);await waitFor(()=>assert.equal(view.state.syncs,1));await waitFor(()=>assert.equal(view.queryByRole('alert'),null))
  assert.equal(view.state.registers,1)
})
test('an indefinite provider pause remains visible after reload and disables manual refresh',async()=>{
  const view=setup({paused:true})
  const button=await view.findByRole('button',{name:'更新を停止中'})
  assert.equal(button.disabled,true);assert.match(view.container.textContent,/再開には管理者の確認が必要/)
  fireEvent.click(button);assert.equal(view.state.syncs,0)
})

test('session removal clears the private account view and shows invitation-only login guidance',async()=>{
  const view=setup();const button=await view.findByRole('button',{name:'最新の記録を取得'})
  view.state.signedIn=false;fireEvent.click(button)
  await view.findByRole('button',{name:'Steamでログインする'})
  assert.match(view.container.textContent,/招待されたアカウントだけ/);assert.match(view.container.textContent,/記録は本人だけ/)
  assert.equal(view.container.querySelector('.dh-account'),null)
})
