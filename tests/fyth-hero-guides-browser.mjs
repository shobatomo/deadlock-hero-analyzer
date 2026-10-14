// Local fixtures only; blocks non-local requests. No game API or actual data.
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {nodeDiagnosis} from '../public-app/backend/five-axis.js'
import {validateDiagnosis} from '../public-app/shared/diagnosis.mjs'
const {chromium}=await import('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')
const approved=JSON.parse(await readFile(new URL('../public-app/shared/hero-guides-approved.json',import.meta.url),'utf8'))
const base=process.env.FYTH_TEST_BASE_URL??'http://127.0.0.1:3037'
const fields=['kills','deaths','assists','net_worth_per_min','player_damage_per_min','player_damage_taken_per_min']
const payload={rows:[{hero_id:15,game_mode:1,match_mode:1,match_duration_s:1200,player_kills:4,player_deaths:2,player_assists:5,net_worth:200,metadata:{status:'available',provider_snapshot_maxima:{player_damage:300,player_damage_taken:400}}}],groups:['15','3','1'].flatMap(hero=>[{hero_id:hero,group:'population',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{percentile5:0,percentile50:10,percentile95:30}]))},{hero_id:hero,group:'top',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{avg:15}]))}])}
const initial={...nodeDiagnosis(payload),collection:{storage:'request-only'}}
const ids=Object.keys(approved),evidence=[]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true})
try{
 for(const width of [1280,390,320]){
  const page=await browser.newPage({viewport:{width,height:900}});let current=initial,errors=[],blocked=0
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url())
   if(u.origin!==new URL(base).origin){blocked++;return route.abort()}
   if(u.pathname==='/api/diagnosis')return route.fulfill({json:current})
   if(u.pathname==='/api/feedback')return route.fulfill({json:{enabled:false}})
   return route.continue()
  })
  let checked=0,minTarget=Infinity
  for(let index=0;index<ids.length;index+=3){
   const batch=ids.slice(index,index+3),rows=batch.map((id,i)=>({...initial.five_axis.recommendations[i%initial.five_axis.recommendations.length],hero_id:id}))
   current={...initial,five_axis:{...initial.five_axis,recommendations:rows}};assert.equal(validateDiagnosis(current),true)
   await page.goto(base);await page.locator('#account-id').fill('1');await page.getByRole('button',{name:'確認画面へ'}).click();await page.getByRole('button',{name:'プレイ記録を取得しておすすめを見る'}).click()
   await page.locator('.hero-card').first().waitFor()
   for(let i=0;i<batch.length;i++){
    const id=batch[i],card=page.locator('.hero-card').nth(i),button=card.getByRole('button')
    await button.focus();await page.keyboard.press(i%2?'Space':'Enter')
    await card.locator('.try-tip').waitFor();assert.equal(await card.locator('.try-tip strong').textContent(),approved[id].title);assert.equal(await card.locator('.try-tip p').textContent(),approved[id].body)
    assert.equal(await button.getAttribute('aria-expanded'),'true');assert.equal(await button.evaluate(el=>el===document.activeElement),true)
    minTarget=Math.min(minTarget,(await button.boundingBox()).height)
    assert.equal(await card.locator('.try-tip').evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.keyboard.press('Enter');await card.locator('.try-tip').waitFor({state:'detached'});assert.equal(await button.getAttribute('aria-expanded'),'false')
    await page.keyboard.press('Enter');await card.locator('.try-tip').waitFor();checked++
   }
   if(index===0&&width===320)await page.screenshot({path:'/tmp/fyth-hero-copy-320.png',fullPage:true})
  }
  assert.equal(checked,39);assert.equal(errors.length,0);assert.equal(blocked,0);assert.ok(minTarget>=44)
  evidence.push({width,hero_cards_checked:checked,keyboard:true,min_target_height:minTarget,overflow:false,page_errors:0,external_requests:0})
  await page.close()
 }
 console.log(JSON.stringify({status:'passed',fixture_only:true,evidence},null,2))
}finally{await browser.close()}
