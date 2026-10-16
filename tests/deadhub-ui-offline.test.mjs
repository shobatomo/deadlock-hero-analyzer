// JSDOM only: synthetic records/profile; no HTTP server, real browser, or images fetched.
import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {JSDOM} from 'jsdom'
import React from 'react'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,waitFor,cleanup}=await import('@testing-library/react')
const {default:Deadhub}=await import('../public-app/frontend/src/pages/Deadhub/Deadhub.jsx')
const {default:SteamProfile}=await import('../public-app/frontend/src/pages/Deadhub/SteamProfile.jsx')
const {default:FiveAxisSummary}=await import('../public-app/frontend/src/components/FiveAxisSummary.jsx')
const id=accountIdToSteamId('1'),today=tokyoDay(Date.now()),month=today.slice(0,7),avatar='https://avatars.steamstatic.com/'+'b'.repeat(40)+'_medium.jpg'
const fixture=()=>[{match_id:'101',started_at:today+'T01:00:00+09:00',hero_id:15,won:false,kills:0,deaths:2,assists:4,hero_damage:0,duration_s:1200},{match_id:'102',started_at:today+'T00:00:00+09:00',hero_id:null,won:null,kills:null,deaths:null,assists:0,hero_damage:null,duration_s:null}]
let originalFetch=globalThis.fetch
afterEach(()=>{cleanup();globalThis.fetch=()=>{throw Error('Unexpected fetch outside fixture')}})
after(()=>{globalThis.fetch=originalFetch;dom.window.close()})
function mockApi({profile={profile:null},profileFail=false}={}){
 const state={rows:fixture(),calls:[],syncs:0,profileSignal:null,release:null}
 globalThis.fetch=async(input,options={})=>{
  state.calls.push(String(input));assert.ok(String(input).startsWith('/api/deadhub/'),'No external fetch allowed')
  if(input==='/api/deadhub/config')return Response.json({enabled:true,auth:'steam',time_zone:'Asia/Tokyo'})
  if(input==='/api/deadhub/profile'){state.profileSignal=options.signal;if(profileFail)throw Error('DUMMY_PROFILE_FAILURE');return profile instanceof Promise?profile:Response.json(profile)}
  if(String(input).startsWith('/api/deadhub/records?')){const requested=new URL(input,'https://dummy.example.test').searchParams.get('month');return Response.json({identity:{steam_id:id},month:requested,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00',coverage_from:month+'-01T00:00:00+09:00',coverage_until:today+'T06:00:00+09:00'},matches:requested===month?state.rows:[],observed:{count:state.rows.length}})}
  if(input==='/api/deadhub/sync'){state.syncs++;if(state.release===null)return new Promise(resolve=>{state.release=()=>resolve(Response.json({status:'success'}))});return Response.json({status:'success'})}
  throw Error('Unexpected local route')
 }
 return state
}
async function page(options){const state=mockApi(options),view=render(React.createElement(Deadhub));await waitFor(()=>assert.equal(view.container.querySelectorAll('.dh-match').length,2));return {state,...view}}
test('each match reuses the local hero portrait; missing and broken images retain the record text',async()=>{
 const view=await page(),portraits=view.container.querySelectorAll('.dh-hero-portrait')
 assert.equal(portraits.length,2);assert.equal(portraits[0].querySelector('img').getAttribute('src'),'/heroes/15.webp');assert.ok(portraits[1].querySelector('.portrait-fallback'))
 fireEvent.error(portraits[0].querySelector('img'));assert.ok(portraits[0].querySelector('.portrait-fallback'));assert.equal(view.container.querySelectorAll('.dh-match').length,2)
 assert.match(view.container.textContent,/ヒーロー未取得/)
})
test('all day cells contain just the date; accessible count, selection, and month navigation remain',async()=>{
 const view=await page(),buttons=[...view.container.querySelectorAll('.dh-day')],recorded=buttons.find(b=>b.getAttribute('aria-label').startsWith(today+' '))
 assert.ok(buttons.length>=28);for(const button of buttons){assert.equal(button.children.length,1);assert.equal(button.firstElementChild.tagName,'SPAN');assert.match(button.textContent,/^\d{1,2}$/);assert.equal(button.querySelector('small'),null)}
 assert.match(recorded.getAttribute('aria-label'),/2試合/);assert.equal(recorded.getAttribute('aria-pressed'),'true')
 const other=buttons.find(b=>b!==recorded);fireEvent.click(other);assert.equal(other.getAttribute('aria-pressed'),'true');assert.equal(recorded.getAttribute('aria-pressed'),'false')
 other.focus();assert.equal(document.activeElement,other)
 fireEvent.click(view.getByRole('button',{name:'前の月',exact:true}));await waitFor(()=>assert.equal(view.container.querySelectorAll('.dh-match').length,0))
 fireEvent.click(view.getByRole('button',{name:'次の月',exact:true}));await waitFor(()=>assert.equal(view.container.querySelectorAll('.dh-match').length,2))
})
test('CSS fixes every date row height; presence styling changes only colors, selection and focus differ',async()=>{
 const css=await readFile(new URL('../public-app/frontend/src/pages/Deadhub/Deadhub.css',import.meta.url),'utf8')
 assert.match(css,/grid-auto-rows:var\(--dh-day-size\)/);assert.match(css,/height:var\(--dh-day-size\);min-height:var\(--dh-day-size\)/)
 const recorded=css.match(/\.dh-day\.dh-recorded\{([^}]+)\}/)[1];assert.ok(recorded.split(';').filter(Boolean).every(p=>/^(background|color|border-color):/.test(p)))
 assert.match(css,/\.dh-day\[aria-pressed=true\]\{box-shadow:inset/);assert.match(css,/\.dh-day:focus-visible\{outline:3px dashed/)
 const selected=css.match(/\.dh-day\.dh-recorded\[aria-pressed=true\]\{box-shadow:inset 0 0 0 2px (#[a-f0-9]{6})\}/)[1],background=recorded.match(/background:(#[a-f0-9]{6})/)[1]
 const luminance=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0)
 const light=luminance(background),dark=luminance(selected);assert.ok((Math.max(light,dark)+.05)/(Math.min(light,dark)+.05)>=3,'Selected recorded day must remain visibly distinct')
 assert.ok(!/\.dh-day\.dh-(won|lost|win|loss)/.test(css));assert.ok(!/\.dh-day\{min-height:\d/.test(css))
 const style=document.createElement('style');style.textContent=css;document.head.append(style)
 try {
  const view=render(React.createElement('section',{className:'deadhub'},
   ...['recorded','empty','unsynced','failed','loading'].map(state=>React.createElement('button',{key:state,className:'dh-day dh-'+state},'1')),
   React.createElement('div',{className:'dh-detail'},React.createElement('div',{className:'dh-empty'},'Empty detail'))))
  for(const button of view.container.querySelectorAll('.dh-day')){
   const computed=window.getComputedStyle(button)
   assert.equal(computed.paddingTop,'0px',button.className);assert.equal(computed.paddingBottom,'0px',button.className)
  }
  assert.equal(window.getComputedStyle(view.container.querySelector('.dh-detail .dh-empty')).paddingTop,'30px')
 } finally {style.remove()}
})
test('profile text is escaped; invalid or mismatched avatar data never becomes an image',()=>{
 const name='<img src=x onerror=alert(1)>',view=render(React.createElement(SteamProfile,{steamId:id,profile:{steam_id:id,display_name:name,avatar_url:'javascript:alert(1)'}}))
 assert.ok(view.container.textContent.includes(name));assert.equal(view.container.querySelector('img'),null);assert.ok(view.container.querySelector('svg'))
 view.rerender(React.createElement(SteamProfile,{steamId:id,profile:{steam_id:accountIdToSteamId('2'),display_name:'WRONG PERSON',avatar_url:avatar}}))
 assert.ok(!view.container.textContent.includes('WRONG PERSON'));assert.equal(view.container.querySelector('img'),null)
})
test('profile image error falls back without losing the display name, and a new avatar can load',()=>{
 const p={steam_id:id,display_name:'ダミープレイヤー',avatar_url:avatar},view=render(React.createElement(SteamProfile,{steamId:id,profile:p}))
 const img=view.container.querySelector('img');assert.equal(img.getAttribute('src'),'/api/deadhub/profile/avatar');assert.equal(img.getAttribute('referrerpolicy'),'no-referrer');fireEvent.error(img)
 assert.equal(view.container.querySelector('img'),null);assert.ok(view.container.textContent.includes(p.display_name))
 view.rerender(React.createElement(SteamProfile,{steamId:id,profile:{...p,avatar_url:avatar.replaceAll('b'.repeat(40),'c'.repeat(40))}}));assert.ok(view.container.querySelector('img'))
})
test('profile failure leaves records, partial totals and synchronization usable',async()=>{
 const view=await page({profileFail:true});assert.equal(view.container.querySelector('[role=alert]'),null)
 assert.ok(view.container.textContent.includes('0（取得 1/2 試合分）'))
 const update=view.getByRole('button',{name:'最新の記録を取得',exact:true});fireEvent.click(update);fireEvent.click(update)
 await waitFor(()=>assert.equal(view.state.syncs,1));assert.equal(update.disabled,true);view.state.release()
 await waitFor(()=>assert.equal(view.getByRole('button',{name:'最新の記録を取得',exact:true}).disabled,false));assert.equal(view.container.querySelectorAll('.dh-match').length,2)
 assert.equal(view.state.calls.filter(p=>p==='/api/deadhub/profile').length,1)
})
test('a stalled profile does not block records and is cancelled on unmount',async()=>{
 const view=await page({profile:new Promise(()=>{})});assert.equal(view.container.querySelectorAll('.dh-match').length,2)
 assert.equal(view.state.profileSignal.aborted,false);view.unmount();assert.equal(view.state.profileSignal.aborted,true)
})
test('a corrected hero after synchronization gets a fresh portrait despite an earlier load failure',async()=>{
 const view=await page(),image=view.container.querySelector('.dh-hero-portrait img');fireEvent.error(image)
 view.state.rows[0].hero_id=4;view.state.rows[1].hero_id=999999
 fireEvent.click(view.getByRole('button',{name:'最新の記録を取得',exact:true}));await waitFor(()=>assert.equal(view.state.syncs,1));view.state.release()
 await waitFor(()=>assert.equal(view.container.querySelector('.dh-hero-portrait img')?.getAttribute('src'),'/heroes/4.webp'))
 assert.match(view.container.textContent,/Hero 999999/);assert.equal(view.container.querySelectorAll('.dh-hero-portrait .portrait-fallback').length,1)
})
test('existing FYTH hero recommendations retain portraits and independently expandable guidance',()=>{
 const result={status:'ready',recommendations:['1','3','15'].map(hero_id=>({hero_id,distance:.1,axis_gaps:[],reason:'ダミー比較'})),coverage:1,formula_version:'dummy',axes:[],reasons:[]}
 const view=render(React.createElement(FiveAxisSummary,{result}));assert.equal(view.container.querySelectorAll('.hero-card').length,3);assert.equal(view.container.querySelectorAll('.hero-portrait img').length,3)
 const buttons=view.container.querySelectorAll('.choose-button');fireEvent.click(buttons[0]);fireEvent.click(buttons[1]);assert.equal(view.container.querySelectorAll('.try-tip').length,2);fireEvent.click(buttons[0]);assert.equal(view.container.querySelectorAll('.try-tip').length,1)
})
