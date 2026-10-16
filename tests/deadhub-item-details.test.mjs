import {test} from 'node:test'
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
import {plainItemText, projectItemDetails, createItemDetailsLoader} from '../public-app/frontend/src/pages/Deadhub/item-details.mjs'
const dom = new JSDOM('')
globalThis.DOMParser = dom.window.DOMParser
const fixture = {
  id:1548066885, type:'upgrade', description:{},
  properties:{
    BaseAttackDamagePercent:{value:'8',label:'武器ダメージ',prefix:'{s:sign}',postfix:'%'},
    BonusClipSizePercent:{value:'30',label:'最大弾数',prefix:'{s:sign}',postfix:'%'},
    AbilityCooldown:{value:'0',label:'非表示の内部値',postfix:'秒'},
  },
  tooltip_sections:[{section_type:'innate',section_attributes:[{properties:['BaseAttackDamagePercent'],elevated_properties:['BonusClipSizePercent']}]}],
}

test('HTML becomes text: removed subtrees, entities, line breaks, and no executable markup', () => {
  const html = '<script>bad()</script><style>bad-css</style><svg><text>bad-svg</text></svg><span onclick="bad()">HP &amp; 回復</span><br>次&#x884C;&nbsp;&lt;安全&gt;<img src=x onerror=bad()>'
  assert.equal(plainItemText(html), 'HP & 回復\n次行\u00a0<安全>')
  assert.equal(plainItemText(null), '')
  assert.equal(plainItemText('<svg><foreignObject><p>hidden</p></foreignObject></svg>visible'), 'visible')
})

test('real basic-magazine shape shows referenced base stats despite an empty description', () => {
  const value = projectItemDetails(fixture)
  assert.deepEqual(value.sections, [{title:'基本効果',blocks:[{text:'',rows:[
    {label:'武器ダメージ',value:'+8%',condition:''}, {label:'最大弾数',value:'+30%',condition:''},
  ]}]}])
  assert.equal(JSON.stringify(value).includes('非表示'), false)
})

test('section and attribute ordering, all reference groups, zero, units, signs and conditions survive', () => {
  const value = projectItemDetails({description:{desc:'条件を満たすと発動',desc2:'補足',passive:'自動効果',active:'手動効果'},
    properties:{a:{label:'時間',value:0,postfix:'秒'},b:{label:'射程',value:'7m',postfix:'m'},
      c:{label:'耐性',value:'-10%',prefix:'{s:sign}',postfix:'%'},d:{label:'ダメージ',value:'25',postfix:'%',conditional:'対NPC'},
      e:{label:'HP',value:'50',usage_flags:['ConditionallyApplied']}},
    tooltip_sections:[{section_type:'active',section_attributes:[
      {loc_string:'条件を満たすと発動',properties:['a','b'],important_properties:['c'],elevated_properties:['d']},
      {important_properties_with_icon:['e'],properties:['a']},
    ]},{section_type:'innate',section_attributes:[{properties:['a']}]}]})
  assert.deepEqual(value.sections.map(s=>s.title), ['アクティブ','基本効果','説明','パッシブ','アクティブ'])
  assert.deepEqual(value.sections[0].blocks.flatMap(b=>b.rows).map(r=>[r.value,r.condition]), [
    ['0秒',''],['7m',''],['-10%',''],['25%','対NPC'],['50','条件付き'],
  ])
  assert.equal(JSON.stringify(value).split('条件を満たすと発動').length, 2)
})

test('unknown placeholders and missing references do not leak or imply unconditional bonuses', () => {
  const value = projectItemDetails({description:{desc:'{s:unknown}条件の説明'},properties:{
    ok:{label:'効果',value:'10',prefix:'{s:sign}'},broken:{label:'秘密',value:'{s:unknown}'},
    condition:{label:'回復',value:'5',conditional:'{s:condition}'},
  },tooltip_sections:[{section_type:'passive',section_attributes:[{loc_string:'{s:unknown}で発動',properties:['ok','missing','broken','condition']}]}]})
  assert.equal(value.incomplete, true)
  assert.ok(!JSON.stringify(value).includes('{s:'))
  assert.ok(value.sections[0].blocks[0].rows.every(r=>r.condition === '条件の詳細は未取得'))
  assert.deepEqual(projectItemDetails(null), {sections:[],incomplete:false})
})

test('Frenzy speed completes m with m／秒 while existing units never double or lose precision', () => {
  for (const [value,postfix,expected] of [['4m',' m／秒','4m／秒'],['4m/s','m','4m/s'],['4m／秒','m／秒','4m／秒'],
    ['4m/s','m／秒','4m/s'],['0','秒','0秒'],['2秒','秒','2秒'],['25%','%','25%'],['7m','m','7m']]) {
    const result=projectItemDetails({properties:{speed:{label:'移動速度',value,postfix,usage_flags:['ConditionallyApplied']}},
      tooltip_sections:[{section_type:'passive',section_attributes:[{properties:['speed']}]}]})
    assert.deepEqual(result.sections[0].blocks[0].rows,[{label:'移動速度',value:expected,condition:'条件付き'}])
  }
})

test('icon reference objects use the top-level value, and unresolved affixes are marked incomplete', () => {
  const result=projectItemDetails({properties:{speed:{value:'10',postfix:'%'},badUnit:{label:'不明単位',value:'2',postfix:'{s:unit}'},
    badPrefix:{label:'不明符号',value:'1',prefix:'{s:prefix}'}},tooltip_sections:[{section_type:'passive',section_attributes:[{
      properties:['badUnit','badPrefix'],important_properties_with_icon:[{name:'speed',localized_name:'速度',icon:'ignored.svg'}],
    }]}]})
  assert.deepEqual(result.sections[0].blocks[0].rows,[{label:'速度',value:'10%',condition:''}])
  assert.equal(result.incomplete,true)
})

test('loader is lazy, sends no credentials, validates identity and caches successes for six hours', async () => {
  let calls=0, time=0
  const load=createItemDetailsLoader({now:()=>time,fetchImpl:async(url,options)=>{
    calls++;assert.equal(url, 'https://api.deadlock-api.com/v1/assets/items/1548066885?language=japanese')
    assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error')
    return Response.json(fixture)
  }})
  assert.equal(calls,0)
  const first=await load(fixture.id);assert.equal(await load(fixture.id),first);assert.equal(calls,1)
  time=6*3600000+1;await load(fixture.id);assert.equal(calls,2)
  await assert.rejects(load('../bad'),/invalid_item/)
})

test('failure and invalid/oversized payloads are briefly cached; aborted fetch can be retried', async () => {
  for (const response of [()=>new Response('',{status:503}),()=>Response.json({...fixture,id:1}),()=>Response.json({...fixture,type:'ability'}),
    ()=>new Response('x'.repeat(512*1024+1)),()=>new Response('bad-json')]) {
    let calls=0,time=0
    const load=createItemDetailsLoader({now:()=>time,fetchImpl:async()=>{calls++;return response()}})
    await assert.rejects(load(fixture.id));await assert.rejects(load(fixture.id));assert.equal(calls,1)
    time=60001;await assert.rejects(load(fixture.id));assert.equal(calls,2)
  }
  let calls=0
  const load=createItemDetailsLoader({fetchImpl:async(_url,{signal})=>{calls++;signal?.throwIfAborted();return Response.json(fixture)}})
  const controller=new AbortController();controller.abort()
  await assert.rejects(load(fixture.id,{signal:controller.signal}))
  await load(fixture.id);assert.equal(calls,1)
})

test('an aborted late response cannot overwrite a newer cached result when the same item is reopened', async () => {
  const requests=[]
  const load=createItemDetailsLoader({fetchImpl:()=>new Promise(resolve=>requests.push(resolve))})
  const controller=new AbortController()
  const old=load(fixture.id,{signal:controller.signal})
  const rejected=assert.rejects(old,error=>error.name==='AbortError')
  controller.abort()
  const fresh=load(fixture.id)
  requests[1](Response.json({...fixture,description:{desc:'新しい説明'}}))
  const expected=await fresh
  requests[0](Response.json({...fixture,description:{desc:'古い説明'}}))
  await rejected
  assert.deepEqual(await load(fixture.id),expected)
})
