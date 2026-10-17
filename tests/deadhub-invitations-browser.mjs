// Built UI + synthetic routes only. All external requests are blocked.
// node tests/deadhub-invitations-browser.mjs <playwright-module> <chromium> <output>
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {resolve,extname,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {tokyoDay} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const {chromium}=await import(pathToFileURL(resolve(process.argv[2])).href)
const output=resolve(process.argv[4]);await mkdir(output,{recursive:true})
const dist=fileURLToPath(new URL('../public-app/frontend/dist/',import.meta.url))
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'}
const server=createServer(async(req,res)=>{
  try{const p=new URL(req.url,'http://localhost').pathname,file=p==='/deadhub'?resolve(dist,'index.html'):resolve(dist,'.'+decodeURIComponent(p))
    if(!file.startsWith(resolve(dist)+sep)){res.writeHead(404).end();return}
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'}).end(await readFile(file))
  }catch{res.writeHead(404).end()}
}).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({executablePath:process.argv[3],headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7),results=[]
try{
  for(const width of [1280,390,320])for(const mode of ['manual','daily']){
    const context=await browser.newContext({viewport:{width,height:900},isMobile:width<800,hasTouch:width<800}),page=await context.newPage()
    const errors=[],external=[];let registered=mode==='daily',failed=false,signedIn=true,registers=0,syncs=0,paused=false
    page.on('pageerror',e=>errors.push(e.message))
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==base){external.push(route.request().url());return route.abort()}return route.continue()})
    await page.route('**/api/deadhub/config',r=>r.fulfill({json:{enabled:true,auth:'steam',time_zone:'Asia/Tokyo'}}))
    await page.route('**/api/deadhub/profile',r=>r.fulfill({json:{profile:null}}))
    await page.route('**/api/deadhub/records?*',r=>{
      if(!signedIn)return r.fulfill({status:401,json:{code:'unauthorized',error:'Steamでログインしてください。'}})
      return r.fulfill({json:{identity:{steam_id:accountIdToSteamId(mode==='daily'?'1':'2')},sync_mode:mode,month,
        account:registered?{sync_status:failed?'error':'success',sync_paused:paused,last_success_at:failed?null:today+'T06:00:00+09:00'}:null,
        matches:registered&&!failed?[{match_id:'99',started_at:today+'T01:00:00+09:00',hero_id:15,won:true,kills:mode==='daily'?1:2,deaths:0,assists:1,hero_damage:100,duration_s:600,final_items:[]}]:[],observed:{count:registered&&!failed?1:0}}})
    })
    await page.route('**/api/deadhub/register',r=>{assert.equal(r.request().postData(),'{}');registers++;registered=true;failed=true;return r.fulfill({status:502,json:{code:'rate_limited',error:'テスト用：提供元の取得制限です。時間をおいて再試行してください。'}})})
    await page.route('**/api/deadhub/sync',r=>{assert.equal(r.request().postData(),'{}');syncs++;failed=false;return r.fulfill({json:{status:'success'}})})
    await page.goto(base+'/deadhub')
    if(mode==='manual'){
      await page.getByRole('button',{name:'このアカウントを登録して過去30日を取得'}).waitFor()
      await page.getByText('記録は手動で更新します。自動取得はありません。',{exact:true}).waitFor()
      assert.ok(!(await page.locator('main').innerText()).includes('毎朝'))
      await page.screenshot({path:resolve(output,`invited-register-${width}.png`),fullPage:true})
      await page.getByRole('button',{name:'このアカウントを登録して過去30日を取得'}).click()
      await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'最新の記録を取得'}).waitFor()
      assert.equal(await page.getByRole('button',{name:'このアカウントを登録して過去30日を取得'}).count(),0)
      await page.screenshot({path:resolve(output,`invited-first-failure-${width}.png`),fullPage:true})
      await page.getByRole('button',{name:'最新の記録を取得'}).click();await page.locator('.dh-match').waitFor()
      assert.equal(registers,1);assert.equal(syncs,1)
      assert.ok(!(await page.locator('main').innerText()).includes('毎朝'))
    }else{
      await page.locator('.dh-match').waitFor();assert.ok((await page.locator('main').innerText()).includes('毎朝6時台'))
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.evaluate(()=>{const p=document.createElement('p');p.textContent='画面テスト用ダミーデータ';p.style.cssText='background:#ffdf87;color:#19211b;padding:12px';document.querySelector('main').prepend(p)})
    await page.screenshot({path:resolve(output,`${mode}-${width}.png`),fullPage:true})
    paused=true;await page.reload();const stopped=page.getByRole('button',{name:'更新を停止中'});await stopped.waitFor()
    assert.equal(await stopped.isDisabled(),true)
    await page.getByText('提供元の待機指定により更新を停止しています。再開には管理者の確認が必要です。',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:resolve(output,`${mode}-paused-${width}.png`),fullPage:true})
    signedIn=false;await page.reload();await page.getByRole('button',{name:'Steamでログインする'}).waitFor()
    assert.equal(await page.locator('.dh-account').count(),0);assert.ok((await page.locator('main').innerText()).includes('記録は本人だけ'))
    assert.deepEqual(errors,[]);assert.deepEqual(external,[])
    results.push({width,mode,registration_failure_retry:mode==='manual',schedule_correct:true,indefinite_pause:true,session_removed:true,horizontal_overflow:false,page_errors:0,external_requests:0})
    await context.close()
  }
  const result={status:'passed',data:'synthetic only',production:false,cases:results}
  await writeFile(resolve(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
}finally{await browser.close();await new Promise(r=>server.close(r))}
