// Synthetic-only OpenID callbacks. No real login, HTTP listener, credentials or DB.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import * as authModule from '../public-app/backend/deadhub/auth.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const {createSteamAuth,hashToken,ownerForAccount}=authModule
const origin='https://records.example.test', endpoint='https://steamcommunity.com/openid/login'
const ns='http://specs.openid.net/auth/2.0', now=Date.parse('2026-10-15T12:00:00Z')
const rawError=()=>new Error('DUMMY cookie=private; openid.sig=dummy-signature; steam=76561197960265729; postgres://dummy:private@dummy.invalid/db')
function response(){
  return {headers:{},setHeader(name,value){this.headers[name]=value},json(value){this.body=value},
    redirect(status,url){this.status=status;this.location=url}}
}
function fixture({fetchImpl,openSession=async()=>true,logger}={}){
  const calls=[],dbCalls=[],logs=[]
  const store={async openSession(...args){dbCalls.push(args);return openSession(...args)}}
  const auth=createSteamAuth({store,origin,allowedAccounts:['1'],now:()=>now,
    fetchImpl:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):new Response(`ns:${ns}\nis_valid:true\n`)}})
  const app=createDeadhubApp({store,auth,sync:async()=>{},loginFailureLogger:logger??(code=>logs.push(code))})
  const route=app.router.stack.find(layer=>layer.route?.path==='/api/deadhub/auth/callback').route.stack[0].handle
  return {auth,calls,dbCalls,logs,async assertion({account='1',change={},cookie}={}){
    const started=response();await auth.start({headers:{}},started)
    const login=new URL(started.body.url),ret=new URL(login.searchParams.get('openid.return_to'))
    const state=ret.searchParams.get('state'),steam=accountIdToSteamId(account)
    const fields={ns,mode:'id_res',op_endpoint:endpoint,claimed_id:'https://steamcommunity.com/openid/id/'+steam,
      identity:'https://steamcommunity.com/openid/id/'+steam,return_to:ret.toString(),
      response_nonce:'2026-10-15T12:00:00Zsynthetic-only',assoc_handle:'dummy-association',sig:'dummy-signed-assertion',
      signed:'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',...change}
    for(const [key,value]of Object.entries(fields))ret.searchParams.set('openid.'+key,value)
    return {req:{originalUrl:ret.pathname+ret.search,headers:{cookie:cookie===undefined?started.headers['Set-Cookie'].split(';')[0]:cookie}},
      state,fields,started,login}
  },async callback(req){const res=response();await route(req,res);return res}}
}
const assertFailed=res=>{assert.equal(res.status,303);assert.equal(res.location,origin+'/deadhub?login=failed')}

test('baseline: legitimate fixture preserves state/required fields, verifies Steam and stores only hashes',async()=>{
  const f=fixture(),a=await f.assertion(),res=await f.callback(a.req)
  assert.match(a.started.headers['Set-Cookie'],/^__Host-deadhub_login=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/)
  assert.equal(a.login.searchParams.get('openid.realm'),origin+'/')
  assert.equal(res.location,origin+'/deadhub');assert.equal(res.status,303)
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,endpoint)
  assert.equal(f.calls[0].options.method,'POST');assert.equal(f.calls[0].options.redirect,'error')
  assert.equal(f.calls[0].options.body.get('openid.mode'),'check_authentication')
  assert.equal(f.calls[0].options.body.has('state'),false)
  for(const field of ['return_to','response_nonce','sig','signed','claimed_id'])assert.equal(f.calls[0].options.body.get('openid.'+field),a.fields[field])
  assert.equal(f.dbCalls.length,1)
  const [tokenHash,owner,account,nonceHash,stateHash,previousHash]=f.dbCalls[0]
  assert.match(tokenHash,/^[a-f0-9]{64}$/);assert.equal(owner,ownerForAccount('1'));assert.equal(account,'1')
  assert.equal(nonceHash,hashToken(a.fields.response_nonce));assert.equal(stateHash,hashToken(a.state));assert.equal(previousHash,null)
  assert.equal(res.headers['Set-Cookie'].length,2);assert.deepEqual(f.logs,[])
})

test('baseline: missing/duplicate/mismatched state cookies and duplicate query fields reject before external work',async()=>{
  for(const mutate of [a=>delete a.req.headers.cookie,a=>a.req.headers.cookie+='; '+a.req.headers.cookie,
    a=>a.req.headers.cookie='__Host-deadhub_login='+'A'.repeat(43),
    a=>a.req.originalUrl+='&openid.mode=id_res']){
    const f=fixture(),a=await f.assertion();mutate(a)
    assertFailed(await f.callback(a.req));assert.equal(f.calls.length,0);assert.equal(f.dbCalls.length,0)
  }
})

test('baseline: incorrect return URL, signed fields, identity or endpoint fail closed',async()=>{
  for(const change of [{return_to:origin+'/api/deadhub/auth/callback?state=wrong'},
    {signed:'op_endpoint,identity,return_to,response_nonce,assoc_handle'},
    {identity:'https://steamcommunity.com/openid/id/'+accountIdToSteamId('2')},
    {op_endpoint:'https://evil.example.test/verify'},{mode:'cancel'}]){
    const f=fixture(),a=await f.assertion({change})
    assertFailed(await f.callback(a.req));assert.equal(f.calls.length,0);assert.equal(f.dbCalls.length,0)
  }
})

test('baseline: stale/future/invalid nonce and disallowed account reject before Steam and DB',async()=>{
  for(const change of [{response_nonce:'2020-01-01T00:00:00Zold'},
    {response_nonce:'2030-01-01T00:00:00Zfuture'},{response_nonce:'2026-99-99T00:00:00Zinvalid'}]){
    const f=fixture(),a=await f.assertion({change});assertFailed(await f.callback(a.req))
    assert.equal(f.calls.length,0);assert.equal(f.dbCalls.length,0)
  }
  const f=fixture(),a=await f.assertion({account:'2'});assertFailed(await f.callback(a.req))
  assert.equal(f.calls.length,0);assert.equal(f.dbCalls.length,0)
})

test('baseline: failed/duplicate/oversized verification responses and fetch errors never call DB',async()=>{
  for(const fetchImpl of [async()=>{throw rawError()},async()=>new Response(`ns:${ns}\nis_valid:false\n`),
    async()=>new Response(`ns:${ns}\nis_valid:true\n`,{status:503}),
    async()=>new Response(`ns:${ns}\nis_valid:true\nis_valid:true\n`),async()=>new Response('x'.repeat(8193))]){
    const f=fixture({fetchImpl}),a=await f.assertion();assertFailed(await f.callback(a.req))
    assert.equal(f.dbCalls.length,0)
  }
})

test('baseline: store refusal/replay and store exception issue no session cookie',async()=>{
  for(const openSession of [async()=>false,async()=>{throw rawError()}]){
    const f=fixture({openSession}),a=await f.assertion(),res=await f.callback(a.req)
    assertFailed(res);assert.equal(f.calls.length,1);assert.equal(f.dbCalls.length,1)
    assert.equal(typeof res.headers['Set-Cookie'],'string');assert.ok(!res.headers['Set-Cookie'].includes('__Host-deadhub_session='))
  }
})

test('baseline: openSession uses the existing parameterized SQL without raw state/token storage',async()=>{
  let query
  const store=createRecordStore({async query(sql,values){query={sql,values};return {rows:[{ok:true}]}}})
  const f=fixture({openSession:(...args)=>store.openSession(...args)}),a=await f.assertion()
  a.req.headers.cookie+='; __Host-deadhub_session='+'B'.repeat(43)
  await f.callback(a.req)
  assert.equal(query.sql,'SELECT deadhub_private.open_session($1,$2,$3,$4,$5,$6) AS ok')
  assert.equal(query.values[5],hashToken('B'.repeat(43)))
  assert.ok(!query.values.includes(a.state));assert.ok(!query.values.includes(a.fields.response_nonce))
})

test('diagnostic: each callback boundary emits one fixed code and no exception/request values',async()=>{
  const cases=[
    {code:'INPUT',mutate:a=>a.req.originalUrl+='&state=duplicate'},
    {code:'STATE_COOKIE',mutate:a=>delete a.req.headers.cookie},
    {code:'STATE_MATCH',mutate:a=>a.req.headers.cookie='__Host-deadhub_login='+'C'.repeat(43)},
    {code:'ASSERTION',change:{op_endpoint:'https://evil.example.test/verify'}},
    {code:'RETURN_TO',change:{return_to:origin+'/elsewhere'}},
    {code:'NONCE',change:{response_nonce:'2020-01-01T00:00:00Zold'}},
    {code:'ALLOWLIST',account:'2'},
    {code:'STEAM_REQUEST',fetchImpl:async()=>{throw rawError()}},
    {code:'STEAM_RESPONSE',fetchImpl:async()=>new Response(`ns:${ns}\nis_valid:false\n`)},
    {code:'STEAM_RESPONSE',fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.error(rawError())}}))},
    {code:'SESSION_STORE',openSession:async()=>{throw rawError()}},
    {code:'SESSION_REJECTED',openSession:async()=>false},
  ]
  for(const scenario of cases){
    const f=fixture(scenario),a=await f.assertion(scenario);scenario.mutate?.(a)
    assertFailed(await f.callback(a.req))
    assert.deepEqual(f.logs,['DEADHUB_LOGIN_'+scenario.code])
    assert.ok(!JSON.stringify(f.logs).includes(a.state))
  }
})

test('diagnostic: arbitrary exception fields cannot forge a code or reach the logger',async()=>{
  const logs=[],error=Object.assign(rawError(),{loginStage:'DUMMY cookie',code:'DEADHUB_LOGIN_ALLOWLIST'})
  const app=createDeadhubApp({store:{},sync:async()=>{},auth:{origin,callback:async()=>{throw error}},
    loginFailureLogger:(...args)=>logs.push(args)})
  const route=app.router.stack.find(layer=>layer.route?.path==='/api/deadhub/auth/callback').route.stack[0].handle
  const res=response();await route({headers:{cookie:'DUMMY'},originalUrl:'/dummy?private'},res)
  assertFailed(res);assert.deepEqual(logs,[['DEADHUB_LOGIN_CALLBACK_UNEXPECTED']])
  for(const value of [undefined,null,'DUMMY',error])assert.equal(authModule.getSteamLoginFailureCode(value),'DEADHUB_LOGIN_CALLBACK_UNEXPECTED')
})

test('diagnostic: logger failures cannot replace the existing safe failure redirect',async()=>{
  const f=fixture({logger:()=>{throw rawError()}}),a=await f.assertion({cookie:''})
  assertFailed(await f.callback(a.req))
})

test('diagnostic: default logger receives only one fixed string',async()=>{
  const captured=[],saved=console.warn
  console.warn=(...args)=>captured.push(args)
  try{
    const app=createDeadhubApp({store:{},sync:async()=>{},auth:{origin,callback:async()=>{throw rawError()}}})
    const route=app.router.stack.find(layer=>layer.route?.path==='/api/deadhub/auth/callback').route.stack[0].handle
    const res=response();await route({headers:{},originalUrl:'/dummy'},res)
    assertFailed(res);assert.deepEqual(captured,[['DEADHUB_LOGIN_CALLBACK_UNEXPECTED']])
  }finally{console.warn=saved}
})
