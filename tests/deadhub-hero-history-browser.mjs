// Local built assets + synthetic records only. Never fetch live match/item APIs.
// Arguments: Playwright module, Chromium executable, output directory.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const [modulePath,executablePath,output]=process.argv.slice(2)
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
const assets=JSON.parse((await readFile(new URL('./fixtures/deadhub-item-details-ja.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
const items=assets.slice(0,3).map(asset=>({id:asset.id,name:asset.name,image:null}))
let unmockedApi=0
const deny=(req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),previous=shiftMonth(month,-1)
const other=month+(today.endsWith('-01')?'-02':'-01'),empty=month+'-'+['03','04'].find(day=>!today.endsWith('-'+day))
const row=(id,day,hero,extra={})=>({match_id:String(id),started_at:day+'T12:00:00+09:00',hero_id:hero,won:true,kills:4,deaths:2,assists:3,hero_damage:41901,player_healing:2462,duration_s:2375,final_items:[],...extra})
const rows=[row(106,today,15,{final_items:items}),row(105,today,4),row(104,other,'15',{final_items:items.slice(1),won:false}),row(103,other,15,{kills:null,hero_damage:null,player_healing:null,duration_s:null,won:null,final_items:null}),row(102,other,15,{kills:0,player_healing:0,hero_damage:0,duration_s:0}),row(101,other,null)]
const results=[]
try{
 for(const width of [1280,390,320]){
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch}),page=await context.newPage(),errors=[],blocked=[],calls=[],detailCalls=[]
  let failMonthRead=false
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin==='https://api.deadlock-api.com'&&url.pathname.startsWith('/v1/assets/items/')){
    const id=Number(url.pathname.split('/').at(-1)),asset=assets.find(a=>a.id===id);assert.ok(asset);detailCalls.push(id)
    return route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:asset})
   }
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   if(url.pathname.startsWith('/api/'))calls.push({path:url.pathname,query:url.search,method:request.method()})
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records'){
    if(failMonthRead)return route.fulfill({status:503,json:{error:'画面テスト用：月別記録の読取り失敗'}})
    const requested=url.searchParams.get('month')
    return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month:requested,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},matches:requested===month?rows:requested===previous?[row(201,previous+'-01',4)]:[],observed:{count:999}}})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unmocked API: '+url.pathname)
   assert.equal(request.method(),'GET');return route.continue()
  })
  await page.goto(base+'/deadhub')
  const list=page.getByRole('region',{name:'試合一覧',exact:true}),select=page.getByRole('combobox',{name:'一覧のヒーロー',exact:true})
  await select.waitFor();await page.getByRole('combobox',{name:'ヒーロー',exact:true}).waitFor()
  const ids=()=>list.locator('.dh-match>small').allTextContents()
  assert.deepEqual(await ids(),['試合ID 106','試合ID 105'])
  const callsBefore=calls.length,calendarBefore=await page.locator('.dh-calendar').innerHTML(),summaryBefore=await page.locator('.dh-day-summary').innerText()
  await page.getByRole('combobox',{name:'ヒーロー',exact:true}).selectOption('4')
  await page.getByRole('button',{name:'アシスト（A）',exact:true}).click()
  await select.focus();await page.keyboard.press('b')
  await select.selectOption('15')
  assert.deepEqual(await ids(),['試合ID 106','試合ID 104','試合ID 103','試合ID 102'])
  assert.equal(calls.length,callsBefore);assert.equal(detailCalls.length,0)
  assert.equal(await page.getByRole('combobox',{name:'ヒーロー',exact:true}).inputValue(),'4')
  assert.equal(await page.getByRole('button',{name:'アシスト（A）',exact:true}).getAttribute('aria-pressed'),'true')
  assert.equal(await page.locator('.dh-calendar').innerHTML(),calendarBefore);assert.equal(await page.locator('.dh-day-summary').innerText(),summaryBefore)
  assert.match(await list.locator('.dh-list-count').innerText(),/4試合 \/ この月の保存済み記録 6試合/)
  assert.match(await list.locator('.dh-list-scope').innerText(),/保存済み記録（JST）。全履歴ではありません/)
  for(const text of await list.locator('time').allTextContents()){assert.match(text,/JST/);assert.match(text,/\d{4}/)}
  assert.match(await list.locator('.dh-match').nth(2).innerText(),/アイテム情報は未取得/)
  assert.equal(await list.locator('.dh-match').nth(3).locator('dd').first().innerText(),'0 / 2 / 3')
  assert.match(await list.locator('.dh-match').nth(3).innerText(),/取得済みデータ上は所持アイテムなし/)
  const cells=await page.locator('.dh-day').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})))
  assert.ok(cells.every(c=>c.height===(width===1280?54:width===390?48:44)))
  assert.ok(Math.max(...cells.map(c=>c.width))-Math.min(...cells.map(c=>c.width))<.1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const calendar=await page.locator('.dh-calendar').boundingBox(),summary=await page.locator('.dh-day-summary').boundingBox(),listBox=await list.boundingBox()
  assert.ok(calendar.y<=summary.y&&listBox.y>summary.y+summary.height)
  if(touch)assert.ok(summary.y>calendar.y+calendar.height)
  const contrast=await page.evaluate(()=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
   return [...document.querySelectorAll('.dh-list-scope,.dh-list-hint,.dh-list-count,.dh-list-controls label,.dh-list-controls select,.dh-list-controls button,.dh-match-heading time')].map(el=>{
    let parent=el,bg;while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=='transparent'&&!c.match(/rgba\([^)]*,\s*0\)$/)){bg=c;break}parent=parent.parentElement}
    const fg=lum(rgb(getComputedStyle(el).color)),back=lum(rgb(bg));return (Math.max(fg,back)+.05)/(Math.min(fg,back)+.05)
   })
  });assert.ok(Math.min(...contrast)>=4.5)
  await page.evaluate(()=>{const note=document.createElement('p');note.textContent='画面テスト用の合成記録。実ユーザーの記録ではありません。アイテム画像は未取得を再現。';note.style.cssText='background:#ffdf87;color:#19211b;padding:12px';document.querySelector('main').prepend(note)})
  await page.screenshot({path:join(output,`hero-list-${width}.png`),fullPage:true})
  await list.screenshot({path:join(output,`hero-list-panel-${width}.png`)})
  const opener=list.locator('.dh-match').first().getByRole('button',{name:items[0].name,exact:true})
  if(touch){
   await opener.tap();assert.equal(await page.getByRole('dialog').count(),0)
   await opener.scrollIntoViewIfNeeded();const b=await opener.boundingBox(),session=await context.newCDPSession(page)
   await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]})
   await new Promise(resolve=>setTimeout(resolve,650));await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  }else{await opener.focus();await page.keyboard.press('Enter')}
  await page.getByRole('dialog',{name:items[0].name}).waitFor();await page.getByRole('dialog').locator('.dh-item-effect').first().waitFor()
  await page.screenshot({path:join(output,`hero-item-modal-${width}.png`)})
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
  assert.equal(await opener.evaluate(el=>document.activeElement===el),true)
  await page.getByRole('button',{name:'絞り込みを解除'}).focus();await page.keyboard.press('Enter')
  assert.deepEqual(await ids(),['試合ID 106','試合ID 105']);assert.equal(await select.inputValue(),'')
  await page.getByRole('button',{name:new RegExp('^'+empty+' ')}).click()
  assert.deepEqual(await ids(),[]);await select.selectOption('unknown');assert.deepEqual(await ids(),['試合ID 101'])
  await page.getByRole('button',{name:new RegExp('^'+other+' ')}).click()
  assert.equal(await select.inputValue(),'');assert.deepEqual(await ids(),['試合ID 104','試合ID 103','試合ID 102','試合ID 101'])
  assert.equal(calls.length,callsBefore)
  await select.selectOption('15');await page.getByRole('button',{name:'前の月',exact:true}).click()
  await list.getByText('この月の保存済み記録に、該当する試合はありません。絞り込みを解除するか、別の月を選んでください。',{exact:true}).waitFor()
  assert.equal(await select.inputValue(),'15');assert.deepEqual(await ids(),[])
  await list.screenshot({path:join(output,`hero-empty-${width}.png`)})
  await page.getByRole('button',{name:'次の月',exact:true}).click();await list.locator('.dh-match').first().waitFor()
  assert.deepEqual(await ids(),['試合ID 106','試合ID 104','試合ID 103','試合ID 102'])
  assert.equal(calls.filter(c=>c.path==='/api/deadhub/records').length,3)
  failMonthRead=true;await page.getByRole('button',{name:'前の月',exact:true}).click()
  await page.getByRole('alert').waitFor();await list.getByText(/読み込めませんでした/).waitFor()
  assert.equal(await list.getAttribute('aria-busy'),'false');assert.equal(await page.locator('.dh-trends').getAttribute('aria-busy'),'false')
  assert.doesNotMatch(await list.innerText(),/読み込み中|0試合|該当する試合はありません/)
  assert.match(await page.locator('.dh-trends').innerText(),/読み込めませんでした/)
  assert.match(await page.locator('.dh-day').first().getAttribute('aria-label'),/読取り失敗/)
  assert.deepEqual(await ids(),[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:join(output,`hero-month-read-error-${width}.png`),fullPage:true})
  failMonthRead=false;await page.getByRole('button',{name:'次の月',exact:true}).click();await list.locator('.dh-match').first().waitFor()
  await page.getByRole('alert').waitFor({state:'detached'})
  assert.deepEqual(await ids(),['試合ID 106','試合ID 104','試合ID 103','試合ID 102']);assert.equal(await page.getByRole('alert').count(),0)
  assert.equal(await select.inputValue(),'15');assert.equal(await page.getByRole('combobox',{name:'ヒーロー',exact:true}).inputValue(),'4')
  assert.equal(calls.filter(c=>c.path==='/api/deadhub/records').length,5)
  assert.ok(calls.every(c=>c.method==='GET'));assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,monthly_hero_list:true,calendar_resets_filter:true,graph_independent:true,no_fetch_on_filter:true,month_navigation_requests:4,month_read_failure_and_recovery:true,zero_null_and_inventory_states:true,modal:true,empty_state:true,horizontal_overflow:false,min_text_contrast:Math.min(...contrast),day_height:cells[0].height})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',synthetic_only:true,production:false,external_requests:0,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',cases:results.length,external_requests:0}))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
