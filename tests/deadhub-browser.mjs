import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createPreviewServer} from '../public-app/scripts/public-preview-server.mjs'
import {tokyoDay,shiftMonth} from '../public-app/shared/deadhub.mjs'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const {chromium}=await import(process.env.DEADHUB_PLAYWRIGHT_MODULE??'/tmp/deadhub-tools/node_modules/playwright/index.mjs')
const server=(await createPreviewServer()).listen(0,'127.0.0.1');await once(server,'listening')
const base='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true})
const today=tokyoDay(Date.now()),month=today.slice(0,7)
const rows=[{match_id:'101',started_at:today+'T01:00:00+09:00',hero_id:15,won:false,kills:0,deaths:2,assists:4,hero_damage:0,duration_s:1200},
  {match_id:'102',started_at:today+'T00:00:00+09:00',hero_id:null,won:null,kills:null,deaths:null,assists:0,hero_damage:null,duration_s:null}]
const results=[]
async function screenshot(page,name,width){
  const banner=await page.evaluateHandle(()=>{const p=document.createElement('p');p.textContent='画面テスト用ダミーデータ（実際のプレイ記録ではありません）';p.style.cssText='background:#ffdf87;color:#19211b;padding:12px';document.querySelector('main').prepend(p);return p})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`/tmp/deadhub-${name}-${width}.png`,fullPage:true})
  await banner.evaluate(p=>p.remove());await banner.dispose()
}
try{
  for(const width of [1280,390,320]) {
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    let reads=0,syncs=0,failed=false,recordsFailed=false
    await page.route('**/api/deadhub/config',route=>route.fulfill({json:{enabled:true,auth:'steam',time_zone:'Asia/Tokyo'}}))
    await page.route('**/api/deadhub/records?*',route=>{
      reads++;const requested=new URL(route.request().url()).searchParams.get('month')
      if(recordsFailed)return route.fulfill({status:503,json:{error:'テスト用：保存済み記録の再読み込みに失敗しました。'}})
      return route.fulfill({json:{identity:{steam_id:accountIdToSteamId('1')},month:requested,
        account:{steam_account_id:'1',sync_status:failed?'error':'success',last_success_at:today+'T06:00:00+09:00',
          coverage_from:shiftMonth(month,-1)+'-01T00:00:00+09:00',coverage_until:today+'T06:00:00+09:00'},
        matches:requested===month?rows:[],observed:{count:2,first:rows[1].started_at,last:rows[0].started_at}}})
    })
    await page.route('**/api/deadhub/sync',async route=>{
      syncs++;await new Promise(r=>setTimeout(r,300));if(syncs===2){failed=true;return route.fulfill({status:502,json:{code:'provider_failed',error:'テスト用の取得失敗。保存済みの記録は残っています。'}})}
      return route.fulfill({json:{status:'success',processed:2}})
    })
    await page.goto(base+'/deadhub')
    const day=page.getByRole('button',{name:today+' 記録あり 2試合',exact:true})
    await day.waitFor();assert.equal(await day.getAttribute('aria-pressed'),'true')
    await page.getByText('0（取得 1/2 試合分）',{exact:true}).first().waitFor()
    assert.equal(await page.locator('.dh-match').count(),2)
    await page.getByRole('button',{name:'前の月',exact:true}).click()
    await page.getByText('照会済み・記録なし',{exact:true}).waitFor()
    assert.match(await page.locator('.dh-detail .dh-empty').innerText(),/プレイしていないことを示すものではありません/)
    await screenshot(page,'queried-empty',width)
    await page.getByRole('button',{name:'前の月',exact:true}).click()
    await page.getByText('未同期・未確認',{exact:true}).waitFor()
    assert.match(await page.locator('.dh-detail .dh-empty').innerText(),/この日全体の照会はまだ終わっていません/)
    await screenshot(page,'unsynced',width)
    await page.getByRole('button',{name:'次の月',exact:true}).click()
    await page.getByText('照会済み・記録なし',{exact:true}).waitFor()
    await page.getByRole('button',{name:'次の月',exact:true}).click();await day.waitFor()
    await day.focus();await page.keyboard.press('Enter')
    const update=page.getByRole('button',{name:'最新の記録を取得',exact:true})
    await update.click();assert.equal(await page.getByRole('button',{name:'記録を取得中…'}).isDisabled(),true)
    await page.getByText('提供元の保存済みデータを確認しました。未収録の試合や未取得の項目が残る場合があります。',{exact:true}).waitFor();assert.equal(syncs,1)
    assert.equal(await page.locator('.dh-match').count(),2)
    assert.match(await page.locator('.dh-account-main').innerText(),/最終照会成功/)
    assert.match(await page.locator('.dh-coverage').innerText(),/全試合・全項目の取得完了を示すものではありません/)
    await screenshot(page,'success',width)
    await update.click();await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('.dh-match').count(),2)
    await screenshot(page,'error-records',width)
    await page.reload();await day.waitFor();assert.equal(await page.locator('.dh-match').count(),2);assert.ok(reads>=5)
    await page.getByRole('button',{name:'前の月',exact:true}).click()
    await page.getByText('取得失敗・未確認',{exact:true}).waitFor()
    assert.match(await page.locator('.dh-detail .dh-empty').innerText(),/取得に失敗したため、この日の記録の有無は未確認/)
    await screenshot(page,'failed',width)
    await page.getByRole('button',{name:'次の月',exact:true}).click();await day.waitFor()
    recordsFailed=true;await update.click()
    await page.getByRole('alert').filter({hasText:'保存済み記録の再読み込みに失敗しました。'}).waitFor()
    assert.equal(await page.locator('.dh-match').count(),2)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    for(const button of await page.locator('.dh-day').all()){const box=await button.boundingBox();assert.ok(box.height>=44)}
    assert.deepEqual(errors,[])
    await screenshot(page,'refresh-error',width)
    results.push({width,month_navigation:true,keyboard_selection:true,partial_totals:true,distinct_empty_states:true,success_not_completeness:true,error_preserves_records:true,refresh_error_preserves_records:true,reload:true,horizontal_overflow:false})
    await page.close()
  }
  const page=await browser.newPage()
  await page.goto(base+'/deadhub');await page.getByRole('heading',{name:'接続準備中'}).waitFor()
  console.log(JSON.stringify({status:'passed',data:'synthetic only',production:false,cases:results,disabled_gate:true}))
}finally{await browser.close();await new Promise(r=>server.close(r))}
