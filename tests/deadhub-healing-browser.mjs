// Build first. All application APIs are synthetic and external browser requests
// are blocked. Arguments: Playwright module, Chromium executable, output folder.
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const [modulePath,executablePath,output]=process.argv.slice(2)
assert.ok(modulePath&&executablePath&&output,'Provide three local paths')
const {chromium}=await import(pathToFileURL(resolve(modulePath)).href)
await mkdir(output,{recursive:true})
let unmockedApi=0
const deny=(req,res)=>{unmockedApi++;res.writeHead(500);res.end('Unexpected test API request')}
const server=(await createPreviewServer({api:deny,records:deny})).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath,headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),results=[]
const scenarios=[
 {name:'partial',values:[2462,null,0],total:'2,462（部分合計 · 取得 2/3 試合分）'},
 {name:'zero-partial',values:[0,null],total:'0（部分合計 · 取得 1/2 試合分）'},
 {name:'complete',values:[2462,0],total:'2,462'},
 {name:'missing',values:[null,null],total:'未取得'},
]
try{
 for(const width of [1280,390,320])for(const scenario of scenarios){
  const page=await browser.newPage({viewport:{width,height:900},isMobile:width<800,hasTouch:width<800}),errors=[],external=[]
  page.on('pageerror',e=>errors.push(e.message))
  const rows=scenario.values.map((player_healing,i)=>({match_id:String(101+i),started_at:today+`T0${i+1}:00:00+09:00`,hero_id:i?3:15,won:i===0,kills:4,deaths:2,assists:3,hero_damage:41901,duration_s:2375,player_healing,final_items:null}))
  let syncs=0,failed=false
  await page.route('**/*',route=>{
   const url=new URL(route.request().url())
   if(url.origin!==base){external.push(url.origin);return route.abort()}
   if(url.pathname==='/api/deadhub/config')return route.fulfill({json:{enabled:true,auth:'steam',time_zone:'Asia/Tokyo'}})
   if(url.pathname==='/api/deadhub/profile')return route.fulfill({json:{profile:null}})
   if(url.pathname==='/api/deadhub/records')return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month:url.searchParams.get('month'),
    account:{sync_status:failed?'error':'success',last_success_at:today+'T06:00:00+09:00',coverage_from:month+'-01T00:00:00+09:00',coverage_until:today+'T06:00:00+09:00'},
    matches:url.searchParams.get('month')===month?rows:[],observed:{count:rows.length}}})
   if(url.pathname==='/api/deadhub/sync'){syncs++;failed=true;return route.fulfill({status:502,json:{error:'テスト用の取得失敗。'}})}
   if(url.pathname.startsWith('/api/'))throw Error('Unexpected API: '+url.pathname)
   return route.continue()
  })
  await page.goto(base+'/deadhub')
  const day=page.getByRole('button',{name:today+' 記録あり '+rows.length+'試合',exact:true});await day.waitFor()
  const total=page.locator('.dh-totals>div').filter({has:page.locator('dt',{hasText:'回復量'})})
  assert.equal(await total.locator('dd').innerText(),scenario.total)
  assert.equal(await total.locator('small').innerText(),'API提供値')
  for(let i=0;i<rows.length;i++){
   const healing=page.locator('.dh-match').nth(i).locator('dl>div').filter({has:page.locator('dt',{hasText:'回復量'})})
   assert.equal(await healing.locator('dd').innerText(),scenario.values[i]==null?'未取得':scenario.values[i].toLocaleString('ja-JP'))
   assert.equal(await healing.locator('small').innerText(),'API提供値')
  }
  const dimensions=await page.locator('.dh-day').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,text:n.textContent})))
  for(const {height,text} of dimensions){assert.equal(height,width===1280?54:width===390?48:44);assert.match(text,/^\d{1,2}$/)}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.match(await page.locator('.dh-coverage').innerText(),/回復量はAPI提供値です。提供元の最終スナップショット/)
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面テスト用の合成データ（実取得ではありません）';p.style.cssText='background:#ffdf87;color:#19211b;padding:12px';document.querySelector('main').prepend(p)})
  await page.screenshot({path:join(output,`healing-${scenario.name}-${width}.png`),fullPage:true})
  if(scenario.name==='partial'){
   if(width<800)await day.tap();else{await day.focus();await page.keyboard.press('Enter')}
   await page.getByRole('button',{name:'最新の記録を取得',exact:true}).click();await page.getByRole('alert').waitFor()
   assert.equal(syncs,1);assert.equal(await total.locator('dd').innerText(),scenario.total);assert.equal(await page.locator('.dh-match').count(),rows.length)
   await page.getByRole('button',{name:'前の月',exact:true}).click();await page.locator('.dh-empty').waitFor()
   await page.getByRole('button',{name:'次の月',exact:true}).click();await day.waitFor()
   assert.equal(await total.locator('dd').innerText(),scenario.total)
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  results.push({width,scenario:scenario.name,day_height:dimensions[0].height,zero_and_unknown_distinct:true,overflow:false,browser_errors:0})
  await page.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',synthetic_only:true,new_game_api_requests:0,production:false,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',cases:results.length,synthetic_only:true,external_requests:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
