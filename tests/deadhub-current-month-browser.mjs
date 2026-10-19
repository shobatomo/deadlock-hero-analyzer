// Local built UI; all API responses are synthetic and external calls are blocked.
// Arguments: Playwright module, Chromium executable, output directory.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const [modulePath,executablePath,output]=process.argv.slice(2)
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(_req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true}),results=[]
try{
 for(const width of [1280,390,320]){
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch,timezoneId:'America/Los_Angeles'}),page=await context.newPage()
  const errors=[],blocked=[],calls=[];let fail=false
  page.on('pageerror',error=>errors.push(error.message))
  await page.clock.install({time:new Date('2026-12-31T14:59:50Z')})
  await page.clock.pauseAt(new Date('2026-12-31T14:59:59Z'))
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET')
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname+url.search)
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records'){
    if(fail)return route.fulfill({status:503,json:{error:'画面検証用：月別記録の読取り失敗'}})
    const month=url.searchParams.get('month'),matches=[15,4].map(hero_id=>({match_id:month+'-'+hero_id,started_at:month+'-02T12:00:00+09:00',hero_id,won:true,kills:0,deaths:2,assists:null,final_items:[]}))
    return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month,account:{sync_status:'success',last_success_at:'2026-12-31T06:00:00+09:00'},matches,observed:{count:2}}})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unmocked API');return route.continue()
  })
  await page.goto(base+'/deadhub');const calendar=page.locator('.dh-calendar'),current=page.getByRole('button',{name:'今月へ',exact:true}),previous=page.getByRole('button',{name:'前の月',exact:true})
  const list=page.getByRole('combobox',{name:'一覧のヒーロー',exact:true}),graph=page.getByRole('combobox',{name:'ヒーロー',exact:true}),heading=calendar.locator('.dh-month h3')
  await graph.waitFor();await page.waitForFunction(()=>!document.querySelector('.dh-list-controls select').disabled)
  const readCount=()=>calls.filter(c=>c.startsWith('/api/deadhub/records?')).length
  const selected=()=>calendar.locator('.dh-day[aria-pressed=true]').getAttribute('aria-label')
  const settle=async text=>{await heading.getByText(text,{exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.dh-list-controls select').disabled)}
  assert.equal(await heading.innerText(),'2026年12月');assert.equal(await current.isDisabled(),true)
  assert.match(await selected(),/^2026-12-31 /)
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面検証用の合成データ。日付はJST年末を再現しています。';p.style.cssText='background:#ffdf87;color:#19211b;padding:10px;font-size:12px';document.querySelector('main').prepend(p)})
  await list.selectOption('15');await graph.selectOption('4');await page.getByRole('button',{name:'アシスト（A）',exact:true}).click()
  for(const month of [11,10,9]){await previous.click();await settle(`2026年${month}月`)}
  assert.match(await selected(),/^2026-09-01 /);assert.equal(await current.isEnabled(),true)
  const box=await current.boundingBox();assert.ok(box.width>=44&&box.height>=44)
  await calendar.screenshot({path:join(output,`past-month-${width}.png`)})
  const before=readCount()
  if(touch)await current.tap();else{
   await previous.focus();await page.keyboard.press('Tab');assert.equal(await current.evaluate(el=>el===document.activeElement),true)
   assert.match(await current.evaluate(el=>getComputedStyle(el).outlineStyle),/dashed/);await page.keyboard.press('Space')
  }
  await settle('2026年12月');assert.equal(readCount(),before+1);assert.equal(await current.isDisabled(),true)
  assert.match(await selected(),/^2026-12-31 /);assert.equal(await list.inputValue(),'15');assert.equal(await graph.inputValue(),'4')
  assert.equal(await page.getByRole('button',{name:'アシスト（A）',exact:true}).getAttribute('aria-pressed'),'true')
  assert.match(await page.locator('.dh-day-summary').innerText(),/未同期・未確認/)
  const cells=await calendar.locator('.dh-day').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,color:getComputedStyle(n).backgroundColor,recorded:n.classList.contains('dh-recorded')})))
  assert.ok(cells.every(c=>/^\d{1,2}$/.test(c.text)&&c.height===(width===1280?54:width===390?48:44)))
  assert.ok(Math.max(...cells.map(c=>c.width))-Math.min(...cells.map(c=>c.width))<.1)
  assert.ok(cells.every(c=>c.color===(c.recorded?'rgb(190, 219, 161)':'rgb(23, 32, 27)')))
  await calendar.screenshot({path:join(output,`current-month-${width}.png`)})
  await previous.click();await settle('2026年11月')
  await current.focus();await page.keyboard.press('Enter');await settle('2026年12月')
  await previous.click();await settle('2026年11月');fail=true
  await current.click();await page.getByRole('alert').waitFor()
  const region=page.getByRole('region',{name:'試合一覧',exact:true})
  await region.getByText(/読み込めませんでした/).waitFor()
  assert.equal(await region.getAttribute('aria-busy'),'false');assert.doesNotMatch(await region.innerText(),/読み込み中|0試合|該当する試合はありません/)
  assert.equal(await current.isDisabled(),true);await page.screenshot({path:join(output,`read-failure-${width}.png`),fullPage:true})
  fail=false;await previous.click();await settle('2026年11月');await current.click();await settle('2026年12月')
  await page.getByRole('alert').waitFor({state:'detached'})
  const beforeMidnight=readCount();await page.clock.runFor(1000)
  await page.waitForFunction(()=>!document.querySelector('.dh-current-month').disabled)
  assert.equal(readCount(),beforeMidnight);assert.equal(await heading.innerText(),'2026年12月');assert.match(await selected(),/^2026-12-31 /)
  if(touch)await current.tap();else await current.click()
  await settle('2027年1月');assert.equal(readCount(),beforeMidnight+1);assert.match(await selected(),/^2027-01-01 /)
  assert.equal(await current.isDisabled(),true);assert.equal(await list.inputValue(),'15');assert.equal(await graph.inputValue(),'4')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await calendar.screenshot({path:join(output,`jst-year-boundary-${width}.png`)})
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,one_action_month_return:true,current_month_disabled:true,keyboard_enter:true,keyboard_space:!touch,filters_retained:true,selected_day_correct:true,jst_midnight_no_auto_fetch:true,jst_year_boundary:true,client_timezone:'America/Los_Angeles',read_failure_and_recovery:true,day_height:cells[0].height,day_colors_preserved:true,horizontal_overflow:false,real_api_calls:0,sync_calls:0})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',local_only:true,synthetic_only:true,external_calls:0,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',widths:results.map(r=>r.width),external_calls:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
