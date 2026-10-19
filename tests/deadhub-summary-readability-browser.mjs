// Local production build + synthetic records only; all external requests denied.
// Arguments: Playwright module, Chromium executable, output directory, [baseline].
// Baseline captures the old wording while applying the same numerical checks.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const [modulePath,executablePath,output,mode]=process.argv.slice(2),baseline=mode==='baseline'
assert.ok(modulePath&&executablePath&&output)
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(req,res)=>{unmockedApi++;res.writeHead(500).end('Unexpected API')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),other=month+(today.endsWith('-01')?'-02':'-01'),results=[]
const record=(id,day,hour,hero_id,extra={})=>({match_id:String(id),started_at:day+'T'+String(hour).padStart(2,'0')+':00:00+09:00',hero_id,won:true,kills:0,deaths:0,assists:0,hero_damage:0,player_healing:null,duration_s:600,final_items:[],...extra})
const rows=[...[0,2,null,6,8,10,12,14].map((kills,i)=>record(i+1,today,i,15,{kills,assists:i===0?null:i+1,hero_damage:(i+1)*6000,duration_s:i===3?0:600,player_healing:i===1?0:null})),
  record(100,today,8,4,{kills:4,deaths:2,assists:null,hero_damage:null,player_healing:100,won:null}),record(101,other,9,4,{kills:20})]
try {
 for(const width of [1280,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<800,isMobile:width<800}),calls=[],errors=[],blocked=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{
   const req=route.request(),url=new URL(req.url());if(url.origin!==base){blocked.push(url.origin);return route.abort()}
   assert.equal(req.method(),'GET')
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname)
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records')return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month,account:{sync_status:'success',last_success_at:today+'T06:00:00+09:00'},matches:rows,observed:{count:42}}})
   assert.ok(!url.pathname.startsWith('/api/'),'Unexpected API '+url.pathname);return route.continue()
  })
  await page.goto(base+'/deadhub');await page.locator('.dh-trends svg').waitFor()
  const summary=page.locator('.dh-day-summary'),graph=page.locator('.dh-trends'),list=page.getByRole('region',{name:'試合一覧',exact:true})
  const totals=await summary.locator('dd').allTextContents()
  assert.deepEqual(totals,['56（取得 8/9 試合分）','2','35（取得 7/9 試合分）','216,000（取得 8/9 試合分）','100（部分合計 · 取得 2/9 試合分）'])
  assert.match(await summary.innerText(),/9試合を取得/)
  const note=summary.locator('.dh-summary-note')
  if(baseline)assert.equal(await note.count(),0)
  else {assert.match(await note.innerText(),/全ヒーローの合計/);assert.match(await note.innerText(),/取得件数／この日の保存済み試合数/)}
  assert.match(await graph.locator('.dh-trend-count').innerText(),/この月：10試合 \/ 保存済み全期間：42試合 ・ 選択ヒーロー：8試合/)
  const countCopy=baseline?/平均を表示できる試合：1試合/:/5試合平均の表示点：1点/
  assert.match(await graph.innerText(),countCopy);assert.equal(await graph.locator('[data-point=average]').count(),1)
  assert.equal(await graph.locator('[data-selected-average]').textContent(),'10回')
  const apiCount=calls.length
  await page.getByRole('combobox',{name:'一覧のヒーロー',exact:true}).selectOption('4')
  assert.equal(await list.locator('.dh-match').count(),2);assert.deepEqual(await summary.locator('dd').allTextContents(),totals)
  await page.getByRole('combobox',{name:'ヒーロー',exact:true}).selectOption('4')
  assert.match(await graph.locator('.dh-trend-count').innerText(),/選択ヒーロー：2試合/)
  assert.deepEqual(await summary.locator('dd').allTextContents(),totals)
  await page.getByRole('combobox',{name:'ヒーロー',exact:true}).selectOption('15')
  await page.evaluate(()=>{
   for(const panel of document.querySelectorAll('.dh-day-summary,.dh-trends')){
    const p=document.createElement('p');p.textContent='画面テスト用の合成データです。実ユーザーの記録ではありません。'
    p.style.cssText='background:#ffdf87;color:#19211b;padding:8px;font-size:12px';panel.prepend(p)
   }
  })
  await summary.screenshot({path:join(output,`summary-${width}.png`)})
  await graph.screenshot({path:join(output,`kills-${width}.png`)})
  await page.getByRole('button',{name:'ダメージ/分',exact:true}).click()
  assert.equal(await graph.locator('[data-selected-value]').textContent(),'4,800ダメージ/分')
  assert.equal(await graph.locator('[data-point=value]').count(),7);assert.equal(await graph.locator('[data-point=average]').count(),0)
  assert.match(await graph.innerText(),/時間が0・未取得の場合も欠損/)
  assert.match(await graph.innerText(),/分間ダメージも各試合の分間値を平均/)
  await graph.screenshot({path:join(output,`damage-per-minute-${width}.png`)})
  await page.getByRole('button',{name:'デス（D）',exact:true}).click()
  assert.equal(await graph.locator('[data-selected-value]').textContent(),'0回');assert.equal(await graph.locator('[data-selected-average]').textContent(),'0回')
  assert.equal(await graph.locator('[data-point=average]').count(),4)
  assert.equal(calls.length,apiCount,'Display controls must not fetch')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  const calendarBox=await page.locator('.dh-calendar').boundingBox(),summaryBox=await summary.boundingBox(),listBox=await list.boundingBox(),graphBox=await graph.boundingBox()
  assert.ok(calendarBox.y<=summaryBox.y&&graphBox.y>=listBox.y+listBox.height)
  if(width<800)assert.ok(summaryBox.y>=calendarBox.y+calendarBox.height)
  const contrast=await page.locator(baseline?'.dh-trend-note':'.dh-summary-note,.dh-trend-note').evaluateAll(nodes=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
   return nodes.map(el=>{let parent=el,bg;while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=='transparent'&&!c.match(/rgba\([^)]*,\s*0\)$/)){bg=c;break}parent=parent.parentElement}const a=lum(rgb(getComputedStyle(el).color)),b=lum(rgb(bg));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})
  });assert.ok(Math.min(...contrast)>=4.5)
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[])
  results.push({width,baseline,daily_totals:totals,daily_count:9,month_count:10,all_period_count:42,hero_count:8,kills_mean:10,kills_mean_points:1,damage_per_minute:4800,missing_duration_excluded:true,zero_preserved:true,filters_keep_daily_scope:true,no_filter_requests:true,calendar_first:true,horizontal_overflow:false,min_text_contrast:Math.min(...contrast)})
  await page.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',baseline,synthetic_only:true,production:false,real_api_calls:0,external_requests:0,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',baseline,widths:results.length,external_requests:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
