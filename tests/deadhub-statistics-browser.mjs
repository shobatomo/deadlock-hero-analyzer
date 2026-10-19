// Local production build + synthetic APIs only. No real user/session/DB data.
// Arguments: Playwright module, Chromium executable, output directory.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
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
try{
 for(const width of [1280,390,320]){
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch,timezoneId:'America/Los_Angeles'}),page=await context.newPage(),calls=[],errors=[],blocked=[]
  let mode='mixed'
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());assert.equal(req.method(),'GET')
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname+url.search)
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/statistics'){
    assert.equal(url.search,'')
    return mode==='error'?route.fulfill({status:503,json:{error:'PRIVATE_DATABASE_ERROR'}}):route.fulfill({json:statisticsFixture(mode)})
   }
   if(url.pathname==='/api/deadhub/records'){
    const selected=url.searchParams.get('month')
    return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month:selected,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},observed:{count:1},
     matches:[15,4].map(hero_id=>({match_id:selected+'-'+hero_id,started_at:selected+'-01T12:00:00+09:00',hero_id,won:true,kills:0,deaths:1,assists:null,final_items:[]}))}})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API');return route.continue()
  })
  await page.goto(base+'/deadhub')
  const toggle=page.getByRole('button',{name:'全期間の統計',exact:true}),panel=page.getByRole('region',{name:'保存済み全期間の統計',exact:true}),calendar=page.locator('.dh-calendar'),list=page.getByRole('combobox',{name:'一覧のヒーロー',exact:true}),graph=page.getByRole('combobox',{name:'ヒーロー',exact:true})
  const reads=()=>calls.filter(c=>c==='/api/deadhub/statistics').length
  await graph.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(reads(),0)
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面検証用の合成統計です。実ユーザーの記録ではありません。';p.style.cssText='background:#ffdf87;color:#19211b;padding:10px;font-size:12px';document.querySelector('main').prepend(p)})
  await calendar.screenshot({path:join(output,`collapsed-${width}.png`)})
  const initialHeight=(await calendar.boundingBox()).height
  if(touch)await toggle.tap();else{await toggle.focus();await page.keyboard.press('Enter')}
  await panel.locator('.dh-stats-overview').waitFor()
  assert.equal(reads(),1);assert.match(await panel.innerText(),/本人の保存済み記録・全ヒーロー/)
  for(const pattern of [/生涯の全試合ではありません/,/2025\/12\/31 JST/,/2026\/02\/02 JST/,/50\.0%/,/勝敗判明 2試合が分母/,/勝敗不明：2試合/,/値の取得済み：3 \/ 4試合/])assert.match(await panel.innerText(),pattern)
  const snapshot=await panel.innerText()
  await list.selectOption('15');await graph.selectOption('4');await page.getByRole('button',{name:'アシスト（A）',exact:true}).click()
  await page.getByRole('button',{name:'前の月',exact:true}).click()
  await page.waitForFunction(m=>document.querySelector('.dh-list-scope').textContent.includes(Number(m.slice(0,4))+'年'+Number(m.slice(5))+'月')&&!document.querySelector('.dh-list-controls select').disabled,previous)
  const current=page.getByRole('button',{name:'今月へ',exact:true});if(touch)await current.tap();else{await current.focus();await page.keyboard.press('Space')}
  await page.waitForFunction(()=>document.querySelector('.dh-current-month').disabled&&!document.querySelector('.dh-list-controls select').disabled)
  assert.equal(reads(),1);assert.equal(await panel.innerText(),snapshot);assert.equal(await list.inputValue(),'15');assert.equal(await graph.inputValue(),'4')
  assert.match(await page.locator('.dh-day[aria-pressed=true]').getAttribute('aria-label'),new RegExp('^'+today))
  const grid=await page.locator('.dh-grid').innerHTML(),summary=await page.locator('.dh-day-summary').innerText(),matches=await page.getByRole('region',{name:'試合一覧',exact:true}).innerText()
  const contrast=await panel.locator('h3,p,dt,dd,small,button').evaluateAll(nodes=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
   return nodes.map(el=>{let parent=el,bg;while(parent){const color=getComputedStyle(parent).backgroundColor;if(color!=='transparent'&&!color.match(/rgba\([^)]*,\s*0\)$/)){bg=color;break}parent=parent.parentElement}const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(bg));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
  });assert.ok(Math.min(...contrast)>=4.5)
  const refresh=page.getByRole('button',{name:'統計を再確認',exact:true})
  for(const button of [toggle,refresh])assert.ok((await button.boundingBox()).height>=44)
  await calendar.screenshot({path:join(output,`mixed-${width}.png`)})
  await page.screenshot({path:join(output,`whole-page-${width}.png`),fullPage:true})
  for(const state of ['empty','missing','zero','error']){
   mode=state;await refresh.click()
   if(state==='error')await panel.locator('.dh-stats-error').waitFor();else await panel.locator('.dh-stats-overview').waitFor()
   const text=await panel.innerText()
   if(state==='error'){assert.match(text,/試合数や合計は不明/);assert.doesNotMatch(text,/PRIVATE_|0試合/)}
   else if(state==='zero'){assert.match(text,/合計：0時間0分0秒/);assert.match(text,/1試合平均：0\.0/)}
   else assert.match(text,/合計：未取得/)
   if(state==='empty')assert.match(text,/保存済みの試合はありません/)
   assert.equal(await page.locator('.dh-grid').innerHTML(),grid);assert.equal(await page.locator('.dh-day-summary').innerText(),summary)
   assert.equal(await page.getByRole('region',{name:'試合一覧',exact:true}).innerText(),matches)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   await panel.screenshot({path:join(output,`${state}-${width}.png`)})
  }
  mode='mixed';await refresh.focus();await page.keyboard.press('Enter');await panel.locator('.dh-stats-overview').waitFor()
  assert.equal(await refresh.evaluate(el=>el===document.activeElement),true)
  await toggle.focus();await page.keyboard.press('Space');assert.equal(await panel.count(),0)
  assert.equal((await calendar.boundingBox()).height,initialHeight);assert.equal(await toggle.evaluate(el=>el===document.activeElement),true)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,closed_by_default:true,lazy_read:true,saved_all_time_and_all_heroes_explicit:true,zero_missing_empty_distinct:true,outcome_unknown_excluded:true,jst_range:true,selection_independent:true,current_month_regression:true,error_preserves_calendar_and_matches:true,keyboard:true,min_text_contrast:Math.min(...contrast),horizontal_overflow:false,real_api_calls:0,external_calls:0})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',local_only:true,synthetic_only:true,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',widths:results.map(r=>r.width),external_calls:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
