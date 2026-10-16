import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
import {setTimeout as delay} from 'node:timers/promises'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent','DOMParser'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
globalThis.fetch=async()=>Response.json({id:1,type:'upgrade',description:{desc:'テスト用の効果'}})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,cleanup,act,within}=await import('@testing-library/react')
const {default:FinalItems}=await import('../public-app/frontend/src/pages/Deadhub/FinalItems.jsx')
afterEach(cleanup);after(()=>dom.window.close())
const image='https://assets-bucket.deadlock-api.com/assets-api-res/images/items/weapon/basic_magazine.webp'
const items=[{id:1,name:'基礎拡張マガジン',image},{id:2,name:'モンスターラウンド',image:image.replace('basic_magazine','monster_rounds')}]
const component=items=>React.createElement(FinalItems,{items})
test('unknown and observed-empty inventories have distinct text and no fabricated icons',()=>{
 const view=render(component(null));assert.match(view.container.textContent,/未取得/);assert.equal(view.queryAllByRole('button').length,0)
 view.rerender(component([]));assert.match(view.container.textContent,/取得済みデータ上は所持アイテムなし/);assert.ok(!view.container.textContent.includes('未取得'))
})
test('click opens a named dialog; focus exposes names and obsolete instructions are removed',()=>{
 const view=render(component(items)),second=view.getByRole('button',{name:items[1].name})
 assert.equal(view.getByRole('status').textContent,items[0].name)
 fireEvent.click(second);assert.equal(within(view.container).getByRole('status').textContent,items[1].name);assert.equal(second.getAttribute('aria-pressed'),'true')
 assert.ok(view.getByRole('dialog',{name:items[1].name}));fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 fireEvent.focus(view.getByRole('button',{name:items[0].name}));assert.equal(view.getByRole('status').textContent,items[0].name)
 assert.equal(view.container.querySelector('img').getAttribute('referrerpolicy'),'no-referrer')
 assert.match(view.container.textContent,/スロット順ではありません/)
 assert.ok(!view.container.textContent.includes('選択すると名前を確認できます'))
})
test('missing and broken images show the full name, and a replacement URL can load',()=>{
 const view=render(component(items));fireEvent.error(view.container.querySelector('img'))
 assert.equal(view.getByRole('button',{name:items[0].name}).textContent,items[0].name)
 view.rerender(component([{...items[0],image:items[1].image},{...items[1],image:null}]))
 assert.ok(view.getByRole('button',{name:items[0].name}).querySelector('img'))
 assert.equal(view.getByRole('button',{name:items[1].name}).textContent,items[1].name)
})
test('long names and markup stay plain bounded text; forbidden images never load',()=>{
 const name='<script>bad()</script>'+('長い名称'.repeat(100)),view=render(component([{id:1,name,image:'https://evil.test/item.png'}]))
 assert.equal(view.container.querySelector('script'),null);assert.equal(view.container.querySelector('img'),null)
 assert.equal(view.getByRole('status').textContent.length,120)
})
test('resync preserves a still-present selection and safely replaces removed selections',()=>{
 const view=render(component(items));fireEvent.click(view.getByRole('button',{name:items[1].name}))
 view.rerender(component([...items,{id:3,name:'追加装備',image:null}]))
 assert.equal(within(view.container).getByRole('status').textContent,items[1].name)
 view.rerender(component([items[0]]));assert.equal(view.getByRole('status').textContent,items[0].name)
 view.rerender(component(null));assert.match(view.container.textContent,/未取得/)
})

function pointer(target,type,props={}) {
 const event=new dom.window.Event(type,{bubbles:true,cancelable:true})
 for(const [key,value] of Object.entries({pointerType:'touch',pointerId:1,isPrimary:true,button:0,clientX:10,clientY:10,...props}))Object.defineProperty(event,key,{value})
 fireEvent(target,event)
}
test('touch requires a full hold and suppresses its compatibility click',async()=>{
 const view=render(component(items)),button=view.getByRole('button',{name:items[0].name})
 pointer(button,'pointerdown');await act(()=>delay(50));pointer(button,'pointerup');fireEvent.click(button,{detail:1})
 assert.equal(view.queryByRole('dialog'),null)
 pointer(button,'pointerdown');await act(()=>delay(600))
 assert.ok(view.getByRole('dialog'));pointer(button,'pointerup')
 const close=view.getByRole('button',{name:'アイテム説明を閉じる'})
 fireEvent.click(close,{detail:1});assert.ok(view.getByRole('dialog'),'The release click must not close the newly opened modal')
 pointer(close,'pointerdown',{pointerType:'mouse'});fireEvent.click(close)
 pointer(button,'pointerdown');pointer(button,'pointerup');fireEvent.click(button,{detail:1})
 assert.equal(view.queryByRole('dialog'),null)
 fireEvent.keyDown(button,{key:'Enter'});await act(async()=>fireEvent.click(button));assert.ok(view.getByRole('dialog'))
})
test('movement, cancellation, leaving, scrolling, multi-touch and unmount cancel a hold',async()=>{
 for(const cancel of [b=>pointer(b,'pointermove',{clientY:30}),b=>pointer(b,'pointercancel'),b=>pointer(b,'pointerout'),
   ()=>fireEvent.scroll(window),b=>pointer(b,'pointerdown',{pointerId:2,isPrimary:false}),
   ()=>pointer(document.body,'pointerdown',{pointerId:2,isPrimary:false}),()=>fireEvent.blur(window)]) {
   const view=render(component(items)),button=view.getByRole('button',{name:items[0].name})
   pointer(button,'pointerdown');cancel(button);await act(()=>delay(600))
   assert.ok(view.queryByRole('dialog')===null,'Cancelled touch must not open a dialog');view.unmount()
 }
 const view=render(component(items));pointer(view.getByRole('button',{name:items[0].name}),'pointerdown');view.unmount()
 await act(()=>delay(600));assert.equal(document.querySelector('dialog'),null)
})
test('focus is trapped in both directions and restored after Escape, close, and outside click',()=>{
 const view=render(component(items)),button=view.getByRole('button',{name:items[0].name})
 for(const close of [d=>fireEvent(d,new dom.window.Event('cancel',{bubbles:false,cancelable:true})),
   ()=>fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'})),
   d=>{pointer(d,'pointerdown',{clientX:-1,clientY:-1});fireEvent.click(d,{clientX:-1,clientY:-1})}]) {
   act(()=>button.focus());fireEvent.click(button)
   const dialog=view.getByRole('dialog'),closeButton=view.getByRole('button',{name:'アイテム説明を閉じる'}),region=view.getByRole('region')
   assert.equal(document.activeElement,closeButton)
   fireEvent.keyDown(closeButton,{key:'Tab',shiftKey:true});assert.equal(document.activeElement,region)
   fireEvent.keyDown(region,{key:'Tab'});assert.equal(document.activeElement,closeButton)
   close(dialog);assert.equal(view.queryByRole('dialog'),null);assert.equal(document.activeElement,button)
 }
})
test('description failure preserves the saved name/image and closing aborts a pending fetch',async()=>{
 const view=render(component(items)),button=view.getByRole('button',{name:items[1].name})
 await act(async()=>fireEvent.click(button))
 const dialog=view.getByRole('dialog',{name:items[1].name})
 assert.match(dialog.textContent,/取得できません/)
 assert.equal(dialog.querySelector('img').getAttribute('src'),items[1].image)
 assert.match(dialog.textContent,/現在の基本値/)
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 const originalFetch=globalThis.fetch;let signal
 globalThis.fetch=(_url,options)=>{signal=options.signal;return new Promise(()=>{})}
 view.rerender(component([{id:3,name:'保留中',image}]))
 fireEvent.click(view.getByRole('button',{name:'保留中'}));view.unmount()
 assert.equal(signal.aborted,true);globalThis.fetch=originalFetch
})

test('rapid clicks, late responses after closing, and switching/reopening items cannot mix details',async t=>{
 const originalFetch=globalThis.fetch,requests=[]
 t.after(()=>{globalThis.fetch=originalFetch})
 globalThis.fetch=(url,{signal})=>new Promise(resolve=>requests.push({url,signal,resolve}))
 const first={id:101,name:'遅い装備A',image},second={id:102,name:'装備B',image}
 const view=render(component([first,second])),a=view.getByRole('button',{name:first.name}),b=view.getByRole('button',{name:second.name})
 act(()=>{for(let i=0;i<5;i++)fireEvent.click(a)})
 assert.equal(requests.length,1);assert.equal(view.getAllByRole('dialog').length,1)
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 assert.equal(requests[0].signal.aborted,true)
 fireEvent.click(b)
 await act(async()=>requests[1].resolve(Response.json({id:102,type:'upgrade',description:{desc:'Bだけの効果'}})))
 await act(async()=>requests[0].resolve(Response.json({id:101,type:'upgrade',description:{desc:'古いAの効果'}})))
 assert.match(view.getByRole('dialog',{name:second.name}).textContent,/Bだけの効果/)
 assert.ok(!view.getByRole('dialog').textContent.includes('古いA'))
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}));fireEvent.click(a)
 assert.equal(requests.length,3,'Aborted stale data must not have been cached')
 await act(async()=>requests[2].resolve(Response.json({id:101,type:'upgrade',description:{desc:'新しいAの効果'}})))
 assert.match(view.getByRole('dialog',{name:first.name}).textContent,/新しいAの効果/)
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 await act(async()=>fireEvent.click(b));assert.equal(requests.length,3)
 assert.match(view.getByRole('dialog',{name:second.name}).textContent,/Bだけの効果/)
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 view.rerender(component([{id:103,name:'遅延C',image}]))
 fireEvent.click(view.getByRole('button',{name:'遅延C'}))
 fireEvent.click(view.getByRole('button',{name:'アイテム説明を閉じる'}))
 await act(async()=>requests[3].resolve(Response.json({id:103,type:'upgrade',description:{desc:'閉じた後の効果'}})))
 assert.equal(view.queryByRole('dialog'),null)
})
