// Synthetic match records only. Serves built static files; never imports the backend.
// node tests/deadhub-item-modal-browser.mjs <playwright-module> <chromium-executable> <output-dir> [--live-api]
import assert from 'node:assert/strict'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {resolve, extname, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const {chromium} = await import(process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'playwright')
const output = resolve(process.argv[4] ?? 'item-modal-browser-results')
await mkdir(output, {recursive:true})
const assets = JSON.parse((await readFile(new URL('./fixtures/deadhub-item-details-ja.json',import.meta.url),'utf8')).replace(/^\uFEFF/,''))
const items = assets.map(item => ({id:item.id, name:item.name, image:item.shop_image_webp}))
const dist = fileURLToPath(new URL('../public-app/frontend/dist/',import.meta.url))
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'}
const server = createServer(async(req,res) => {
  try {
    const pathname = new URL(req.url,'http://localhost').pathname
    const file = pathname === '/deadhub' || pathname === '/' ? resolve(dist,'index.html') : resolve(dist,'.'+decodeURIComponent(pathname))
    if (!file.startsWith(resolve(dist)+sep)) { res.writeHead(404).end();return }
    const body = await readFile(file)
    res.writeHead(200,{'Content-Type':mime[extname(file)] ?? 'application/octet-stream'}).end(body)
  } catch { res.writeHead(404).end() }
}).listen(0,'127.0.0.1')
await once(server,'listening')
const browser = await chromium.launch({headless:true,...(process.argv[3] ? {executablePath:process.argv[3]} : {})})
const results = [], today = tokyoDay(Date.now()), month = today.slice(0,7)
let liveApi = null
try {
  for (const width of [1280,390,320]) {
    const touch = width < 800
    const context = await browser.newContext({viewport:{width,height:900},hasTouch:touch,isMobile:touch})
    const page = await context.newPage(), errors = [], requests = []
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/api/deadhub/config',route=>route.fulfill({json:{enabled:true,auth:'steam',time_zone:'Asia/Tokyo'}}))
    await page.route('**/api/deadhub/profile',route=>route.fulfill({json:{profile:null}}))
    const row = {match_id:'101',started_at:today+'T01:00:00+09:00',hero_id:15,won:true,kills:4,deaths:2,assists:6,hero_damage:12000,duration_s:1200,final_items:items}
    await page.route('**/api/deadhub/records?*',route=>route.fulfill({json:{
      identity:{steam_id:accountIdToSteamId('1')},month,
      account:{steam_account_id:'1',sync_status:'success',last_success_at:today+'T06:00:00+09:00',coverage_from:month+'-01T00:00:00+09:00',coverage_until:today+'T06:00:00+09:00'},
      matches:[row],observed:{count:1,first:row.started_at,last:row.started_at},
    }}))
    await page.route('https://api.deadlock-api.com/v1/assets/items/*',async route=>{
      const id=Number(new URL(route.request().url()).pathname.split('/').at(-1))
      requests.push(id)
      const asset=assets.find(a=>a.id===id)
      await route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:asset})
    })
    await page.goto('http://127.0.0.1:'+server.address().port+'/deadhub')
    const button=page.getByRole('button',{name:items[0].name,exact:true})
    await button.waitFor();await button.scrollIntoViewIfNeeded()
    await page.evaluate(()=>{
      window.touchTrace=[]
      for(const type of ['pointerdown','pointerup','pointermove','pointerout','pointercancel','scroll','blur'])window.addEventListener(type,event=>{
        window.touchTrace.push({type,id:event.pointerId,target:event.target.className,x:event.clientX,y:event.clientY,primary:event.isPrimary,at:Math.round(performance.now())})
        if(window.touchTrace.length>30)window.touchTrace.shift()
      },true)
    })
    assert.equal(requests.length,0,'Details must load on demand')
    assert.equal(await page.getByText('選択すると名前を確認できます。',{exact:false}).count(),0)
    const session=await context.newCDPSession(page)
    async function hold(target,{move=false,cancel=false,release=true}={}) {
      await target.scrollIntoViewIfNeeded()
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const box=await target.boundingBox(),point={x:box.x+box.width/2,y:box.y+box.height/2}
      await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]})
      if(move) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y-65}]})
      if(cancel) await session.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]})
      await new Promise(r=>setTimeout(r,650))
      if(release&&!cancel) await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    }
    if(touch) {
      await button.tap();assert.equal(await page.getByRole('dialog').count(),0)
      await hold(button,{move:true});assert.equal(await page.getByRole('dialog').count(),0)
      await hold(button,{cancel:true});assert.equal(await page.getByRole('dialog').count(),0)
      await hold(button)
    } else { await button.click() }
    const dialog=page.getByRole('dialog',{name:items[0].name}),close=page.getByRole('button',{name:'アイテム説明を閉じる'})
    await dialog.waitFor();await dialog.getByText('+30%',{exact:true}).waitFor()
    assert.equal(await dialog.getByText('+8%',{exact:true}).count(),1)
    assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'Focus must stay inside the open modal')
    await close.focus()
    await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('region',{name:'アイテムの効果'}).evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Tab');assert.equal(await close.evaluate(el=>el===document.activeElement),true)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    const box=await dialog.boundingBox();assert.ok(box.width<=380&&box.x>=16&&box.y>=24)
    await dialog.locator('img').evaluate(img=>img.decode().catch(()=>{}))
    await page.screenshot({path:resolve(output,`modal-${width}.png`)})
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0)
    assert.equal(await button.evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Enter');await dialog.waitFor();assert.equal(requests.length,1,'Cached reopen should not fetch again')
    await close.click();assert.equal(await button.evaluate(el=>el===document.activeElement),true)
    await page.keyboard.press('Space');await dialog.waitFor()
    await page.mouse.click(5,5);assert.equal(await page.getByRole('dialog').count(),0)
    const activeButton=page.getByRole('button',{name:items[2].name,exact:true})
    if(touch)await hold(activeButton);else await activeButton.click()
    const activeDialog=page.getByRole('dialog',{name:items[2].name})
    await activeDialog.getByText('アクティブ',{exact:true}).waitFor()
    assert.ok((await activeDialog.innerText()).includes('条件付き'))
    const body=activeDialog.getByRole('region')
    await body.focus();await page.keyboard.press('End')
    await page.waitForFunction(()=>document.querySelector('.dh-item-modal-body').scrollTop>0)
    assert.ok((await activeDialog.boundingBox()).height<=560)
    await page.screenshot({path:resolve(output,`active-modal-${width}.png`)})
    await close.click()
    // Failure stays local to the description, preserving saved identity and image.
    await page.route('**/v1/assets/items/'+items[3].id+'?*',route=>route.fulfill({status:503,headers:{'Access-Control-Allow-Origin':'*'},body:''}))
    const failedButton=page.getByRole('button',{name:items[3].name,exact:true})
    if(touch)await hold(failedButton);else await failedButton.click()
    const failed=page.getByRole('dialog',{name:items[3].name})
    try { await failed.getByText('効果の説明を取得できませんでした。').waitFor({timeout:10000}) }
    catch(error) {
      await page.screenshot({path:resolve(output,`debug-failure-${width}.png`)})
      console.log(JSON.stringify({width,requests,dialogs:await page.locator('dialog').allTextContents(),events:await page.evaluate(()=>window.touchTrace)}))
      throw error
    }
    assert.equal(await failed.locator('img').getAttribute('src'),items[3].image)
    await page.screenshot({path:resolve(output,`failure-${width}.png`)})
    await close.click()
    if(width===1280) {
      const html='<script>window.itemHtmlExecuted=true</script><style>.bad{color:red}</style><svg><text>SVG_CHILD_REMOVED</text></svg><b>安全 &amp; 平文</b><br>次の行'
      await page.route('**/v1/assets/items/'+items[1].id+'?*',route=>route.fulfill({headers:{'Access-Control-Allow-Origin':'*'},json:{
        id:items[1].id,type:'upgrade',description:{desc:html},properties:{
          speed:{label:'移動速度',value:'4m',postfix:' m／秒',usage_flags:['ConditionallyApplied']},
          zero:{label:'待機時間',value:0,postfix:'秒'},internal:{label:'表示禁止の内部値',value:'999'},
        },tooltip_sections:[{section_type:'passive',section_attributes:[{loc_string:html,properties:['speed','zero']}]}],
      }}))
      await page.getByRole('button',{name:items[1].name,exact:true}).click()
      const safe=page.getByRole('dialog',{name:items[1].name})
      await safe.getByText('4m／秒',{exact:true}).waitFor()
      assert.ok((await safe.innerText()).includes('安全 & 平文\n次の行'))
      assert.ok((await safe.innerText()).includes('条件付き'))
      assert.ok((await safe.innerText()).includes('0秒'))
      assert.ok(!(await safe.innerText()).includes('表示禁止'))
      assert.ok(!(await safe.innerText()).includes('SVG_CHILD_REMOVED'))
      assert.equal(await safe.locator('svg,script,style').count(),0)
      assert.equal(await page.evaluate(()=>window.itemHtmlExecuted===true),false)
      await close.click()
      if(process.argv.includes('--live-api')) {
        await page.unroute('https://api.deadlock-api.com/v1/assets/items/*')
        await page.reload();await button.waitFor()
        const responsePromise=page.waitForResponse(response=>response.url()==='https://api.deadlock-api.com/v1/assets/items/'+items[0].id+'?language=japanese')
        await button.click()
        const response=await responsePromise
        assert.equal(response.status(),200)
        await dialog.locator('dl').waitFor()
        const headers=await response.request().allHeaders()
        assert.equal(headers.cookie,undefined);assert.equal(headers.authorization,undefined);assert.equal(headers.referer,undefined)
        liveApi={status:response.status(),origin:await page.evaluate(()=>location.origin),cors:response.headers()['access-control-allow-origin'],rendered:true,credentials_sent:false,referrer_sent:false}
        await page.screenshot({path:resolve(output,'live-api-1280.png')})
        await close.click()
      }
    }
    assert.deepEqual(errors,[])
    results.push({width,touch,compact:true,keyboard:true,focus_restore:true,backdrop_close:true,scroll_cancel:touch,pointercancel:touch,failed_details_preserve_item:true,horizontal_overflow:false})
    await context.close()
  }
  const result={status:'passed',data:'synthetic match records; public API item snapshots from 2026-10-16',html_svg_text_only:true,conditional_speed_unit:true,liveApi,results}
  await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally { await browser.close();await new Promise(r=>server.close(r)) }
