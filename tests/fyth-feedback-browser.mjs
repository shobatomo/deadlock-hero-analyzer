import assert from 'node:assert/strict'
import {nodeDiagnosis} from '../public-app/backend/five-axis.js'
import {FEEDBACK_CHOICES} from '../public-app/shared/feedback.mjs'
const {chromium}=await import(process.env.FYTH_PLAYWRIGHT_MODULE ?? '/tmp/fyth-browser-tools/node_modules/playwright/index.mjs')
const base=process.env.FYTH_TEST_BASE_URL ?? 'http://127.0.0.1:3031'
 const fields=['kills','deaths','assists','net_worth_per_min','player_damage_per_min','player_damage_taken_per_min']
 const payload={rows:[{hero_id:15,game_mode:1,match_mode:1,match_duration_s:1200,player_kills:4,player_deaths:2,player_assists:5,net_worth:200,metadata:{status:'available',provider_snapshot_maxima:{player_damage:300,player_damage_taken:400}}}],groups:['15','3','1'].flatMap(hero=>[{hero_id:hero,group:'population',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{percentile5:0,percentile50:10,percentile95:30}]))},{hero_id:hero,group:'top',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{avg:15}]))}])}

const diagnosis={...nodeDiagnosis(payload),collection:{storage:'request-only'}}
const browser=await chromium.launch({executablePath:process.env.FYTH_CHROMIUM_PATH??'/usr/bin/chromium',headless:true})
const evidence=[]
try {
 for(const scenario of [
  {name:'desktop-keyboard-success',width:1280,height:900,enabled:true,outcomes:['stored']},
  {name:'mobile-retry-success',width:390,height:844,enabled:true,outcomes:['not_stored','stored']},
  {name:'mobile-unknown-locked',width:320,height:740,enabled:true,outcomes:['unknown']},
  {name:'mobile-disconnected',width:390,height:844,enabled:false,outcomes:[]},
 ]) {
  const page=await browser.newPage({viewport:{width:scenario.width,height:scenario.height}})
  let requests=0;const consoleErrors=[]
  page.on('pageerror',error=>consoleErrors.push(error.message))
  await page.route('**/api/diagnosis',route=>route.fulfill({json:diagnosis}))
  await page.route('**/api/feedback',async route=>{
   if(route.request().method()==='GET')return route.fulfill({json:{enabled:scenario.enabled}})
   requests++;assert.deepEqual(Object.keys(route.request().postDataJSON()),['choice'])
   assert.ok(FEEDBACK_CHOICES.includes(route.request().postDataJSON().choice))
   assert.equal(route.request().headers().referer,undefined)
   const status=scenario.outcomes[Math.min(requests-1,scenario.outcomes.length-1)]
   await new Promise(resolve=>setTimeout(resolve,150))
   return route.fulfill({status:status==='stored'?200:status==='not_stored'?503:502,json:{status,...(status!=='stored'?{retryable:status==='not_stored'}:{})}})
  })
  await page.goto(base)
  await page.locator('#account-id').fill('1');await page.getByRole('button',{name:'確認画面へ'}).click()
  await page.getByRole('button',{name:'プレイ記録を取得しておすすめを見る'}).click()
  const panel=page.getByRole('region',{name:'任意のフィードバック'})
  await panel.waitFor()
  assert.equal(await panel.getByRole('radio').count(),3)
  if(scenario.enabled) {
   await panel.getByRole('radio').first().waitFor({state:'visible'})
   // Native keyboard group: Space selects, ArrowDown changes, Tab reaches submit, Enter submits.
   const radio=panel.getByRole('radio').first();await radio.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown')
   assert.equal(await panel.getByRole('radio').nth(1).isChecked(),true)
   await page.keyboard.press('Tab');assert.equal(await panel.getByRole('button').evaluate(el=>el===document.activeElement),true)
   await page.keyboard.press('Enter');await page.keyboard.press('Enter')
   if(scenario.outcomes[0]==='not_stored') {
    await panel.getByText('保存されませんでした。時間をおいて、もう一度送信できます。').waitFor()
    await panel.getByRole('button',{name:'もう一度送信する'}).click()
   }
   if(scenario.outcomes.at(-1)==='stored')await panel.getByText('回答を集計に保存しました。ありがとうございます。').waitFor()
   else await panel.getByText('保存できたか確認できませんでした。重複を防ぐため、この画面からの再送信を停止しています。').waitFor()
   assert.equal(await panel.getByRole('button').isDisabled(),true)
   assert.equal(requests,scenario.outcomes.length)
  } else {
   await panel.getByText('現在、回答の受付は停止しています。回答は送信されません。').waitFor()
   assert.equal(await panel.getByRole('button').isDisabled(),true)
   assert.equal(requests,0)
  }
  assert.equal(await panel.evaluate(el=>getComputedStyle(el).color), 'rgb(7, 7, 7)')
  assert.equal(await panel.locator('#feedback-note').evaluate(el=>getComputedStyle(el).color), 'rgb(81, 74, 64)')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  for(const radio of await panel.getByRole('radio').all()) {
   const box=await radio.locator('..').boundingBox();assert.ok(box.height>=44)
  }
  assert.deepEqual(consoleErrors,[])
  await panel.scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/fyth-'+scenario.name+'.png'})
  evidence.push({scenario:scenario.name,viewport:scenario.width,requests,keyboard:true,horizontalOverflow:false,minTargetHeight:44,pageErrors:0})
  await page.close()
 }
 console.log(JSON.stringify({status:'passed',localOnly:true,mockOnly:true,evidence},null,2))
} finally {await browser.close()}
