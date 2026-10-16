import {test,afterEach,after} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import React from 'react'
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://records.example.test/deadhub'})
for(const key of ['window','document','navigator','HTMLElement','Node','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:key==='window'?dom.window:dom.window[key],configurable:true,writable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true
const {render,fireEvent,cleanup}=await import('@testing-library/react')
const {default:FinalItems}=await import('../public-app/frontend/src/pages/Deadhub/FinalItems.jsx')
afterEach(cleanup);after(()=>dom.window.close())
const image='https://assets-bucket.deadlock-api.com/assets-api-res/images/items/weapon/basic_magazine.webp'
const items=[{id:1,name:'基礎拡張マガジン',image},{id:2,name:'モンスターラウンド',image:image.replace('basic_magazine','monster_rounds')}]
const component=items=>React.createElement(FinalItems,{items})
test('unknown and observed-empty inventories have distinct text and no fabricated icons',()=>{
 const view=render(component(null));assert.match(view.container.textContent,/未取得/);assert.equal(view.queryAllByRole('button').length,0)
 view.rerender(component([]));assert.match(view.container.textContent,/取得済みデータ上は所持アイテムなし/);assert.ok(!view.container.textContent.includes('未取得'))
})
test('tap, click and keyboard focus expose names; selection has an accessible pressed state',()=>{
 const view=render(component(items)),second=view.getByRole('button',{name:items[1].name})
 assert.equal(view.getByRole('status').textContent,items[0].name)
 fireEvent.click(second);assert.equal(view.getByRole('status').textContent,items[1].name);assert.equal(second.getAttribute('aria-pressed'),'true')
 fireEvent.focus(view.getByRole('button',{name:items[0].name}));assert.equal(view.getByRole('status').textContent,items[0].name)
 assert.equal(view.container.querySelector('img').getAttribute('referrerpolicy'),'no-referrer')
 assert.match(view.container.textContent,/スロット順ではありません/)
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
 assert.equal(view.getByRole('status').textContent,items[1].name)
 view.rerender(component([items[0]]));assert.equal(view.getByRole('status').textContent,items[0].name)
 view.rerender(component(null));assert.match(view.container.textContent,/未取得/)
})
