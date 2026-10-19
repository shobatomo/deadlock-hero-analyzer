// Local production build + synthetic authenticated responses. No real sessions,
// database, synchronization, scheduler, or external requests are used.
// Arguments: Playwright module, Chromium executable, output directory.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
import {auditRun,auditSource,auditSnapshot,mixedAudit} from './fixtures/deadhub-sync-runs.mjs'
const [modulePath,executablePath,output]=process.argv.slice(2)
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),results=[]
try {
 for(const width of [1280,390,320]) {
  const touch=width<800,context=await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch}),page=await context.newPage(),calls=[],errors=[],blocked=[]
  let mode='mixed'
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   assert.equal(request.method(),'GET','This browser verification never submits sync or registration')
   if(url.pathname.startsWith('/api/'))calls.push({path:url.pathname,query:url.search})
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records')return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month,sync_mode:'daily',account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},matches:[{match_id:'901',started_at:today+'T12:00:00+09:00',hero_id:15,won:true,kills:0,deaths:2,assists:4,hero_damage:24000,player_healing:0,duration_s:1800,final_items:[]}],observed:{count:1}}})
   if(url.pathname==='/api/deadhub/sync-runs') {
    assert.equal(url.search,'')
    if(mode==='error')return route.fulfill({status:503,json:{error:'PRIVATE_SERVER_ERROR'}})
    const payload=mode==='empty'?auditSnapshot():mode==='other'?auditSnapshot({manual:auditSource(auditRun('failed')),registration:auditSource(auditRun('skipped')),cron_endpoint:auditSource(auditRun('success'))}):mixedAudit()
    return route.fulfill({json:payload})
   }
   assert.ok(!url.pathname.startsWith('/api/'),'Unmocked API: '+url.pathname)
   return route.continue()
  })
  await page.goto(base+'/deadhub');await page.locator('.dh-match').waitFor()
  await page.evaluate(()=>{
   const note=document.createElement('p');note.textContent='画面テスト用の模擬データです。実ユーザー・本番の実行記録ではありません。'
   note.style.cssText='background:#ffdf87;color:#19211b;padding:10px;font-size:12px;flex-basis:100%';document.querySelector('.dh-account').prepend(note)
  })
  const toggle=page.getByRole('button',{name:'同期の実行状況'}),panel=page.getByRole('region',{name:'同期の実行記録'}),refresh=page.getByRole('button',{name:'状況を再確認'})
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const calendarBefore=await page.locator('.dh-calendar').innerHTML(),matchBefore=await page.locator('.dh-matches').innerText()
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await panel.count(),0)
  assert.equal(calls.filter(c=>c.path==='/api/deadhub/sync-runs').length,0)
  await noOverflow();await page.screenshot({path:join(output,`collapsed-${width}.png`),fullPage:true})
  const accountClosed=(await page.locator('.dh-account').boundingBox()).height
  if(touch)await toggle.tap();else {await toggle.focus();await page.keyboard.press('Enter')}
  await panel.locator('.dh-run-source').first().waitFor()
  assert.deepEqual(await panel.locator('.dh-run-outcome').allTextContents(),['成功','一部取得','未完了（終了記録なし）'])
  const text=await panel.innerText();assert.match(text,/処理した記録\s*0件/);assert.match(text,/2026\/10\/19 06:00 JST/)
  assert.match(text,/直近の失敗/);assert.match(text,/終了記録なし：2件/);assert.match(text,/予定どおりの自動実行を証明するものではありません/)
  assert.equal(await page.locator('.dh-calendar').innerHTML(),calendarBefore);assert.equal(await page.locator('.dh-matches').innerText(),matchBefore)
  const cards=await panel.locator('.dh-run-source').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}))
  if(touch)assert.ok(cards[1].y>=cards[0].y+cards[0].height);else assert.equal(cards[0].y,cards[2].y)
  for(const button of [toggle,refresh])assert.ok((await button.boundingBox()).height>=44)
  const contrast=await panel.locator('h2,h3,p,dt,dd,button').evaluateAll(nodes=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
   return nodes.map(el=>{let parent=el,bg;while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=='transparent'&&!c.match(/rgba\([^)]*,\s*0\)$/)){bg=c;break}parent=parent.parentElement}
    const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(bg));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
  });assert.ok(Math.min(...contrast)>=4.5)
  await noOverflow();await page.locator('.dh-account').screenshot({path:join(output,`mixed-${width}.png`)})
  if(!touch) {
   await toggle.focus();await page.keyboard.press('Tab');assert.equal(await refresh.evaluate(node=>node===document.activeElement),true)
   await page.keyboard.press('Shift+Tab');await page.keyboard.press('Space');assert.equal(await panel.count(),0)
   assert.equal(await toggle.evaluate(node=>node===document.activeElement),true)
   await page.keyboard.press('Enter');await panel.locator('.dh-run-source').first().waitFor()
  }
  mode='other';await refresh.click();await panel.locator('.dh-run-failed').waitFor()
  assert.deepEqual(await panel.locator('.dh-run-outcome').allTextContents(),['失敗','スキップ','成功'])
  assert.match(await panel.innerText(),/次の取得までの待機時間中/)
  await page.locator('.dh-account').screenshot({path:join(output,`failure-skip-${width}.png`)})
  mode='empty';await refresh.click();await panel.locator('.dh-run-empty').first().waitFor()
  assert.equal(await panel.locator('.dh-run-empty').count(),3);assert.match(await panel.innerText(),/実行されていないとは限りません/)
  await page.locator('.dh-account').screenshot({path:join(output,`empty-${width}.png`)})
  mode='error';await refresh.click();await panel.locator('.dh-run-error').waitFor()
  assert.match(await panel.innerText(),/実行の有無・結果は不明/);assert.doesNotMatch(await panel.innerText(),/PRIVATE_|実行記録なし/)
  assert.equal(await panel.locator('.dh-run-source').count(),0)
  assert.equal(await page.locator('.dh-calendar').innerHTML(),calendarBefore);assert.equal(await page.locator('.dh-matches').innerText(),matchBefore)
  await noOverflow();await page.locator('.dh-account').screenshot({path:join(output,`read-error-${width}.png`)})
  mode='mixed';await refresh.click();await panel.locator('.dh-run-source').first().waitFor()
  await toggle.click();assert.equal(await panel.count(),0)
  assert.equal((await page.locator('.dh-account').boundingBox()).height,accountClosed)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,touch,collapsed_default:true,states:['success','partial','started','failed','skipped','empty','read_error'],jst:true,calendar_preserved:true,keyboard:!touch,minimum_button_height:44,min_text_contrast:Math.min(...contrast),horizontal_overflow:false,audit_reads:calls.filter(c=>c.path==='/api/deadhub/sync-runs').length})
  await context.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',synthetic_only:true,production:false,external_requests:0,real_sync_calls:0,real_cron_calls:0,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',widths:results.length,states_per_width:7,external_requests:0}))
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
