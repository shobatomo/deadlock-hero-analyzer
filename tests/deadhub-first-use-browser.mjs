// Built local UI + synthetic responses. Every API/image failure is intercepted.
// Arguments: Playwright module, Chromium executable, output directory, [baseline].
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay,DAY_MS} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const [modulePath,executablePath,output,modeArg]=process.argv.slice(2),baseline=modeArg==='baseline'
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
const assets=JSON.parse((await readFile(new URL('./fixtures/deadhub-item-details-ja.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
const items=assets.slice(0,2).map(item=>({id:item.id,name:item.name,image:item.shop_image_webp}))
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(_req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),other=month+(today.endsWith('-01')?'-02':'-01')
const row=(id,extra={})=>({match_id:String(id),started_at:other+'T12:00:00+09:00',hero_id:15,won:true,kills:0,deaths:2,assists:null,hero_damage:0,player_healing:null,duration_s:600,final_items:items,...extra})
const rows=[row(101),row(102,{hero_id:4,final_items:[]}),row(103,{hero_id:null,final_items:null})],results=[]
try {
 for(const width of [1280,390,320]) {
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch}),page=await context.newPage()
  const errors=[],blocked=[],calls=[],detailCalls=[];let mode='initial_read_failure',failedImages=0
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET')
   if(items.some(item=>item.image===url.href)||(url.origin===base&&url.pathname.startsWith('/heroes/'))){failedImages++;return route.fulfill({status:404,body:''})}
   if(url.origin==='https://api.deadlock-api.com'&&url.pathname.startsWith('/v1/assets/items/')){
    const id=Number(url.pathname.split('/').at(-1));assert.ok(items.some(item=>item.id===id));detailCalls.push(id)
    return id===items[0].id?route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},body:''}):
     route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{id,type:'upgrade',description:null}})
   }
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname)
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records'){
    if(mode==='initial_read_failure')return route.fulfill({status:503,json:{error:'画面テスト用：保存済み記録の読取り失敗'}})
    const account={sync_status:mode==='initial'?'running':mode==='failed'?'error':'success',last_success_at:mode==='initial'?null:today+'T06:00:00+09:00',
     coverage_from:mode==='initial'||mode==='unconfirmed'?null:month+'-01T00:00:00+09:00',coverage_until:mode==='initial'||mode==='unconfirmed'?null:new Date(Date.parse(today+'T00:00:00+09:00')+DAY_MS).toISOString()}
    return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month,account,matches:mode==='assets'?rows:[],observed:{count:mode==='assets'?3:0}}})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API');return route.continue()
  })
  const mark=()=>page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面検証用の合成データ・意図的な通信失敗です。実記録ではありません。';p.style.cssText='background:#ffdf87;color:#19211b;padding:10px;font-size:12px';document.querySelector('main').prepend(p)})
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.goto(base+'/deadhub');await page.getByRole('alert').waitFor()
  const status=page.locator('.dh-signin [role=status]')
  assert.match(await status.innerText(),baseline?/ログイン状態を確認しています/:/確認できませんでした。ページを再読み込みしてください/)
  assert.equal(await page.getByRole('button',{name:'Steamでログインする'}).isEnabled(),false)
  assert.equal(calls.length,2);assert.equal(await page.locator('.dh-calendar').count(),0)
  await mark();await noOverflow();await page.screenshot({path:join(output,`initial-read-failure-${width}.png`),fullPage:true})
  const states=[['initial','初回同期中',/まだ確認できていません/],['empty','照会済み・記録なし',/プレイしていないことを示すものではありません/],['failed','取得失敗・未確認',/保存済みの記録は引き続き表示/],['unconfirmed','未同期・未確認',/この日全体の照会はまだ終わっていません/]]
  for(const [name,label,description] of states){
   mode=name;await page.reload();await page.locator('.dh-calendar').waitFor()
   const empty=page.locator('.dh-day-summary .dh-empty')
   assert.equal(await empty.locator('strong').innerText(),label);assert.match(await empty.locator('p').innerText(),description)
   assert.equal(await page.getByRole('alert').count(),0)
   if(name==='initial')assert.equal(await page.getByRole('button',{name:'記録を取得中…'}).isEnabled(),false)
   assert.ok((await page.locator('.dh-day').allTextContents()).every(text=>/^\d{1,2}$/.test(text)))
   await mark();await noOverflow();await page.screenshot({path:join(output,`${name}-${width}.png`),fullPage:true})
  }
  mode='assets';await page.reload();await page.locator('.dh-calendar').waitFor();await mark()
  const day=page.getByRole('button',{name:new RegExp('^'+other+' ')}),list=page.getByRole('region',{name:'試合一覧',exact:true})
  await day.click();assert.equal(await day.getAttribute('aria-pressed'),'true');assert.equal(await list.locator('.dh-match').count(),3)
  assert.match(await list.innerText(),/0 \/ 2 \/ 未取得/);assert.match(await list.innerText(),/取得済みデータ上は所持アイテムなし/);assert.match(await list.innerText(),/アイテム情報は未取得です/)
  const opener=list.getByRole('button',{name:items[0].name,exact:true});await opener.scrollIntoViewIfNeeded()
  await list.locator('.dh-hero-portrait .portrait-fallback').first().waitFor();await opener.locator('.dh-item-fallback').waitFor()
  const recordsText=()=>list.locator('.dh-match-heading,.dh-match-head>span,.dh-match dl,.dh-match>small').allTextContents()
  const before=await recordsText(),callCount=calls.length,session=await context.newCDPSession(page)
  const hold=async(target,cancel)=>{
   await target.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
   const box=await target.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2}
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
   if(cancel==='move')await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-65}]})
   if(cancel==='cancel')await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
   await new Promise(r=>setTimeout(r,650))
   if(cancel!=='cancel')await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }
  if(touch){
   await opener.tap();assert.equal(await page.getByRole('dialog').count(),0)
   for(const cancel of ['move','cancel']){await hold(opener,cancel);assert.equal(await page.getByRole('dialog').count(),0)}
  }
  await opener.scrollIntoViewIfNeeded();const scrollBefore=await page.evaluate(()=>scrollY)
  if(touch)await hold(opener);else await opener.click()
  const dialog=page.getByRole('dialog',{name:items[0].name}),close=page.getByRole('button',{name:'アイテム説明を閉じる'})
  await dialog.getByText('効果の説明を取得できませんでした。',{exact:true}).waitFor()
  await dialog.locator('.dh-item-fallback').waitFor()
  assert.ok((await close.boundingBox()).height>=44);const box=await dialog.boundingBox();assert.ok(box.width<=380&&box.x>=16&&box.y>=24)
  await close.focus();await page.keyboard.press('Shift+Tab');assert.equal(await dialog.getByRole('region').evaluate(el=>el===document.activeElement),true)
  await page.keyboard.press('Tab');assert.equal(await close.evaluate(el=>el===document.activeElement),true)
  await page.screenshot({path:join(output,`missing-assets-modal-${width}.png`)})
  if(touch)await close.tap();else await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await opener.evaluate(el=>el===document.activeElement),true)
  assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<2,'Closing returns to the same list position')
  assert.deepEqual(await recordsText(),before)
  const emptyOpener=list.getByRole('button',{name:items[1].name,exact:true})
  if(touch)await hold(emptyOpener);else await emptyOpener.click()
  await page.getByRole('dialog',{name:items[1].name}).getByText('このアイテムの効果の説明は未取得です。',{exact:true}).waitFor()
  await close.click();assert.equal(await emptyOpener.evaluate(el=>el===document.activeElement),true)
  await page.getByRole('button',{name:new RegExp('^'+today+' ')}).click();assert.equal(await list.locator('.dh-match').count(),0)
  await day.click();assert.equal(await list.locator('.dh-match').count(),3)
  assert.equal(calls.length,callCount);assert.deepEqual(detailCalls,items.map(i=>i.id));assert.ok(failedImages>0)
  await noOverflow();await page.screenshot({path:join(output,`returned-list-${width}.png`),fullPage:true})
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,initial_failure_pending_message:baseline,initial_failure_recovers_on_reload:true,distinct_states:states.map(s=>s[0]),date_cells_only_numbers:true,missing_and_zero_distinct:true,failed_images:failedImages,item_failure_preserves_record:true,empty_description_preserves_record:true,touch_cancellation:touch,focus_and_scroll_restored:true,date_selection_retained:true,horizontal_overflow:false,real_api_calls:0})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',baseline,synthetic_only:true,production:false,external_calls:0,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',baseline,widths:results.length,external_calls:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
