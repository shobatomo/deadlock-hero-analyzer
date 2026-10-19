// Local build and synthetic API fixtures only; no authenticated production access.
// Arguments: Playwright module, Chromium executable, output directory.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
import {historyFixture,historyRows} from './fixtures/deadhub-trend-history.mjs'
import {statisticsFixture} from './fixtures/deadhub-statistics.mjs'
const [modulePath,executablePath,output]=process.argv.slice(2)
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(_req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true}),results=[]
const today=tokyoDay(Date.now()),month=today.slice(0,7),previous=shiftMonth(month,-1)
const source=[...historyRows(),...historyRows(6).map((row,i)=>({...row,hero_id:4,match_id:String(1000+i),kills:1000}))]
try{
 for(const width of [1280,390,320]){
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch,timezoneId:'America/Los_Angeles'}),page=await context.newPage(),calls=[],errors=[],blocked=[]
  let mode='normal'
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET')
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname+url.search)
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/statistics')return route.fulfill({json:statisticsFixture()})
   if(url.pathname==='/api/deadhub/trend-history'){
    if(mode==='error')return route.fulfill({status:503,json:{error:'PRIVATE_DATABASE_DETAILS'}})
    const records=mode==='empty'?[]:mode==='normal'?source:historyRows(6).map(row=>({...row,kills:mode==='missing'?null:0,deaths:null,assists:null,hero_damage:mode==='missing'?null:0,duration_s:60}))
    return route.fulfill({json:historyFixture({rows:records,heroId:url.searchParams.get('hero_id')??'15',page:Number(url.searchParams.get('page')??1)})})
   }
   if(url.pathname==='/api/deadhub/records'){
    const selected=url.searchParams.get('month')
    return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month:selected,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},observed:{count:411},
     matches:[15,4].map(hero_id=>({match_id:String(hero_id),started_at:selected+'-01T12:00:00+09:00',hero_id,won:true,kills:0,deaths:1,assists:null,final_items:[]}))}})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API');return route.continue()
  })
  await page.goto(base+'/deadhub')
  const chart=page.getByRole('region',{name:'ヒーロー別の推移',exact:true}),all=chart.getByRole('button',{name:'保存済み全期間',exact:true}),monthly=chart.getByRole('button',{name:'表示中の月',exact:true}),hero=chart.getByRole('combobox'),reads=()=>calls.filter(c=>c.startsWith('/api/deadhub/trend-history')).length
  const ready=()=>page.waitForFunction(()=>document.querySelector('.dh-trends').getAttribute('aria-busy')==='false')
  await hero.waitFor();assert.equal(reads(),0);assert.equal(await monthly.getAttribute('aria-pressed'),'true');await hero.selectOption('15')
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面検証用の合成データです。実ユーザーの記録ではありません。';p.style.cssText='background:#ffdf87;color:#19211b;padding:10px;font-size:12px';document.querySelector('main').prepend(p)})
  await page.getByRole('button',{name:'全期間の統計',exact:true}).click();await page.locator('.dh-stats-overview').waitFor()
  const stats=await page.getByRole('region',{name:'保存済み全期間の統計',exact:true}).innerText(),grid=await page.locator('.dh-grid').innerHTML()
  if(touch)await all.tap();else{await all.focus();await page.keyboard.press('Enter')}
  await chart.locator('.dh-trend-pages').waitFor();await ready();assert.equal(reads(),1)
  assert.match(await chart.innerText(),/保存済み全期間：411試合/);assert.match(await chart.innerText(),/描画：1–200 \/ 405試合/)
  assert.match(await chart.innerText(),/2025\/12\/30.*2027\/02\/07/);assert.match(await chart.innerText(),/生涯の全履歴を保証するものではありません/)
  assert.equal(await page.locator('.dh-grid').innerHTML(),grid)
  assert.equal(await page.getByRole('region',{name:'保存済み全期間の統計',exact:true}).innerText(),stats)
  await chart.screenshot({path:join(output,`all-time-${width}.png`)})
  const next=chart.getByRole('button',{name:'次の200試合'});await next.focus();await page.keyboard.press('Enter');await ready()
  assert.equal(reads(),2);assert.match(await chart.innerText(),/描画：201–400 \/ 405試合/);assert.equal(await next.evaluate(el=>el===document.activeElement),true)
  const slider=chart.getByRole('slider');await slider.focus();await page.keyboard.press('Home')
  assert.match(await slider.getAttribute('aria-valuetext'),/^第201試合/);assert.equal(await chart.locator('[data-selected-average]').innerText(),'—')
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');assert.match(await chart.locator('[data-selected-average]').innerText(),/201/)
  await chart.screenshot({path:join(output,`page-two-${width}.png`)})
  await next.click();await ready();assert.match(await chart.innerText(),/描画：401–405 \/ 405試合/);assert.equal(await slider.getAttribute('max'),'5')
  assert.equal(await next.getAttribute('aria-disabled'),'true');await next.focus();await page.keyboard.press('Enter');assert.equal(reads(),3)
  const beforeMonth=await chart.innerText();await page.getByRole('button',{name:'前の月',exact:true}).click()
  await page.waitForFunction(m=>document.querySelector('.dh-list-scope').textContent.includes(Number(m.slice(0,4))+'年'+Number(m.slice(5))+'月')&&!document.querySelector('.dh-list-controls select').disabled,previous)
  assert.equal(reads(),3);assert.equal(await chart.innerText(),beforeMonth)
  await page.getByRole('button',{name:'今月へ',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.dh-current-month').disabled&&!document.querySelector('.dh-list-controls select').disabled)
  assert.equal(reads(),3);assert.equal(await chart.innerText(),beforeMonth)
  await page.getByRole('combobox',{name:'一覧のヒーロー',exact:true}).selectOption('4');assert.equal(reads(),3);assert.equal(await hero.inputValue(),'15')
  await hero.selectOption('4');await ready();assert.match(await chart.innerText(),/選択ヒーロー：6試合/);assert.equal(await chart.locator('svg').getAttribute('data-axis-maximum'),'1000')
  assert.equal(await page.getByRole('region',{name:'保存済み全期間の統計',exact:true}).innerText(),stats)
  await hero.selectOption('15');await ready()
  const currentGrid=await page.locator('.dh-grid').innerHTML(),summary=await page.locator('.dh-day-summary').innerText(),matches=await page.getByRole('region',{name:'試合一覧',exact:true}).innerText(),refresh=chart.getByRole('button',{name:'グラフを再確認'})
  mode='error';const currentSvg=await chart.locator('svg').innerHTML();await refresh.focus();await page.keyboard.press('Enter');await ready()
  assert.equal(await refresh.evaluate(el=>el===document.activeElement),true);assert.equal(await chart.locator('svg').innerHTML(),currentSvg)
  assert.match(await chart.innerText(),/前回取得した範囲を表示しています/);assert.doesNotMatch(await chart.innerText(),/PRIVATE_/)
  await chart.screenshot({path:join(output,`error-preserved-${width}.png`)})
  for(const state of ['empty','missing','zero']){
   mode=state;await refresh.click();await ready()
   if(state==='empty'){assert.equal(await chart.locator('svg').count(),0);assert.match(await chart.innerText(),/保存済み全期間：0試合/)}
   else if(state==='missing'){assert.equal(await chart.locator('[data-point=value]').count(),0);assert.match(await chart.innerText(),/この指標はすべて未取得/)}
   else{assert.equal(await chart.locator('[data-point=value]').count(),6);assert.match(await chart.locator('[data-selected-average]').innerText(),/0/)}
   assert.equal(await page.locator('.dh-grid').innerHTML(),currentGrid);assert.equal(await page.locator('.dh-day-summary').innerText(),summary);assert.equal(await page.getByRole('region',{name:'試合一覧',exact:true}).innerText(),matches)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   await chart.screenshot({path:join(output,`${state}-${width}.png`)})
  }
  mode='normal';await refresh.click();await ready();await chart.locator('summary').click();await chart.locator('table').waitFor()
  assert.equal(await chart.locator('tbody tr').count(),200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await chart.locator('summary').click();await page.screenshot({path:join(output,`whole-page-${width}.png`),fullPage:true})
  for(const button of [all,monthly,refresh,next])assert.ok((await button.boundingBox()).height>=44)
  await monthly.focus();await page.keyboard.press('Space');await chart.getByRole('button',{name:'グラフの前の月'}).waitFor();assert.equal(await monthly.evaluate(el=>el===document.activeElement),true)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,keyboard:true,bounded_points_and_table:200,all_pages_reachable:true,previous_four_context:true,jst_range:true,zero_missing_empty_distinct:true,error_preserves_graph_calendar_matches:true,calendar_month_independent:true,current_month_regression:true,all_time_statistics_regression:true,horizontal_overflow:false,real_api_calls:0,external_calls:0})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',local_only:true,synthetic_only:true,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',widths:results.map(r=>r.width),external_calls:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
