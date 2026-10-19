// Section palette regression: hue separation, contrast and existing layout/behavior.
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
  const dimensions=await page.locator('.dh-day').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width,text:n.textContent})))
  for(const {height,text} of dimensions){assert.equal(height,width===1280?54:width===390?48:44);assert.match(text,/^\d{1,2}$/)}
  const cellWidths=dimensions.map(d=>d.width),cellWidth=Math.min(...cellWidths)
  assert.ok(Math.max(...cellWidths)-cellWidth<.1,'Date cell widths must be uniform within rounding')
  const previousWidth=results.find(r=>r.width===width)?.day_width
  if(previousWidth!==undefined)assert.equal(cellWidth,previousWidth,'Date cell widths must not change with values/missing data')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(await page.locator('.dh-calendar-heading h2').innerText(),'プレイカレンダー')
  assert.equal(await page.locator('.dh-day-summary .dh-label').innerText(),'日別サマリー')
  assert.equal(await page.getByRole('region',{name:'試合一覧',exact:true}).getByRole('heading',{name:'試合一覧',exact:true}).count(),1)
  const calendar=await page.locator('.dh-calendar').boundingBox(),summary=await page.locator('.dh-day-summary').boundingBox(),matches=await page.locator('.dh-match-section').boundingBox(),trends=await page.locator('.dh-trends').boundingBox()
  assert.ok(calendar.y<=summary.y,'Calendar must lead the record sections')
  assert.ok(matches.y>=summary.y+summary.height+17,'Summary and match list need a separate gap')
  assert.ok(trends.y>=matches.y+matches.height+23,'Monthly chart must follow daily records')
  if(width<800)assert.ok(summary.y>=calendar.y+calendar.height+23,'Mobile calendar must precede daily summary')
  const colors=await page.locator('.dh-day').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).backgroundColor))])
  assert.equal(colors.length,2,'Calendar uses only recorded / unrecorded background colors')
  assert.equal(await page.locator('.dh-trends').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(40, 34, 59)','Purple trend accent must survive CSS import order')
  const palette=await page.evaluate(()=>['.dh-calendar','.dh-day-summary','.dh-match-section','.dh-trends'].map(selector=>{const style=getComputedStyle(document.querySelector(selector));return {selector,background:style.backgroundColor,border:style.borderTopColor}}))
  assert.deepEqual(palette.map(p=>p.background),['rgb(25, 39, 32)','rgb(22, 43, 60)','rgb(52, 40, 32)','rgb(40, 34, 59)'])
  const hue=color=>{const [r,g,b]=color.match(/\d+/g).slice(0,3).map(Number),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;if(!delta)return 0;return ((max===r?(g-b)/delta:max===g?(b-r)/delta+2:(r-g)/delta+4)*60+360)%360}
  const accentHues=palette.map(p=>hue(p.border))
  for(let i=0;i<accentHues.length;i++)for(let j=i+1;j<accentHues.length;j++){const distance=Math.abs(accentHues[i]-accentHues[j]);assert.ok(Math.min(distance,360-distance)>=45,'Section border hues must be visibly separated')}
  const outcomes=await page.locator('.dh-match-head>span').evaluateAll(nodes=>nodes.map(n=>({color:getComputedStyle(n).color,border:getComputedStyle(n).borderTopColor,background:getComputedStyle(n).backgroundColor})))
  for(const style of outcomes)assert.deepEqual(style,outcomes[0],'Win/loss uses the same neutral style')
  const contrasts=await page.evaluate(()=>{
   const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)
   const targets=[...document.querySelectorAll('.dh-section-heading .dh-label,.dh-section-heading h2,.dh-section-heading h3,.dh-section-heading>p,.dh-totals dt,.dh-totals dd,.dh-metric-source,.dh-metric-detail,.dh-match dt,.dh-match dd,.dh-match-head>span,.dh-match>small,.dh-calendar .dh-muted,.dh-legend,.dh-trend-heading .dh-label,.dh-trend-heading h2,.dh-trend-scope,.dh-trend-count,.dh-trend-note,.dh-trend-range,.dh-trend-method p,.dh-trend-hero,.dh-trend-hero select,.dh-trend-metrics button,.dh-trend-inspector>label,.dh-trend-readout dt,.dh-trend-readout dd,.dh-trend-inspector small')]
   return targets.filter(el=>el.getBoundingClientRect().height>0).map(el=>{
    let parent=el,bg
    while(parent){const c=getComputedStyle(parent).backgroundColor;if(c!=='transparent'&&!c.match(/rgba\([^)]*,\s*0\)$/)){bg=c;break}parent=parent.parentElement}
    const foreground=lum(rgb(getComputedStyle(el).color)),background=lum(rgb(bg))
    return {text:el.textContent.slice(0,30),ratio:(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05)}
   })
  })
  for(const entry of contrasts)assert.ok(entry.ratio>=4.5,'Text contrast below 4.5: '+JSON.stringify(entry))
  assert.match(await page.locator('.dh-coverage').innerText(),/回復量はAPI提供値です。提供元の最終スナップショット/)
  await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面テスト用の合成データ（実取得ではありません）';p.style.cssText='background:#ffdf87;color:#19211b;padding:12px';document.querySelector('main').prepend(p)})
  await page.screenshot({path:join(output,`colors-${scenario.name}-${width}.png`),fullPage:true})
  if(scenario.name==='partial'){
   await page.locator('.dh-day-summary').screenshot({path:join(output,'summary-'+width+'.png')})
   await page.locator('.dh-match-section').screenshot({path:join(output,'matches-'+width+'.png')})
   if(width<800)await day.tap();else{await day.focus();await page.keyboard.press('Enter')}
   await page.getByRole('button',{name:'最新の記録を取得',exact:true}).click();await page.getByRole('alert').waitFor()
   assert.equal(syncs,1);assert.equal(await total.locator('dd').innerText(),scenario.total);assert.equal(await page.locator('.dh-match').count(),rows.length)
   const alert=page.getByRole('alert');assert.match(await alert.innerText(),/取得失敗/)
   assert.deepEqual(await alert.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor})),{background:'rgb(59, 44, 37)',border:'rgb(217, 164, 119)'},'Status alert colors remain unchanged and separate from section borders')
   await page.screenshot({path:join(output,'colors-error-'+width+'.png'),fullPage:true})
   await page.getByRole('button',{name:'前の月',exact:true}).click();await page.locator('.dh-empty').waitFor()
   await page.getByRole('button',{name:'次の月',exact:true}).click();await day.waitFor()
   assert.equal(await total.locator('dd').innerText(),scenario.total)
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[])
  results.push({width,scenario:scenario.name,day_height:dimensions[0].height,day_width:cellWidth,zero_and_unknown_distinct:true,overflow:false,browser_errors:0,calendar_colors:colors.length,section_palette:palette,section_border_hues:accentHues,min_text_contrast:Math.min(...contrasts.map(c=>c.ratio)),section_order:true,distinct_heading_and_border:true})
  await page.close()
 }
 assert.equal(unmockedApi,0)
 await writeFile(join(output,'browser-results.json'),JSON.stringify({status:'passed',synthetic_only:true,new_game_api_requests:0,production:false,cases:results},null,2)+'\n')
 console.log(JSON.stringify({status:'passed',cases:results.length,synthetic_only:true,external_requests:0}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
