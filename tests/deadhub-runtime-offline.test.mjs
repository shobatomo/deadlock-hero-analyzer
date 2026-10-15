// Synthetic configuration and mocked Pool only. No real credentials or connections.
import {test,mock,after} from 'node:test'
import assert from 'node:assert/strict'
import * as actualStore from '../public-app/backend/deadhub/store.js'
import * as actualProvider from '../public-app/backend/deadhub/provider.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const constructed=[],connections=[],external=[]
let poolFailure=false,storeFailure=false,providerFailure=false
const privateError=()=>Object.assign(new Error('DUMMY_PRIVATE_ERROR cookie=DUMMY; certificate=DUMMY'),{code:'DUMMY_PRIVATE_CODE'})
class FakePool {
  constructor(options){if(poolFailure)throw privateError();this.options=options;constructed.push(options)}
  on(){}
  connect(){connections.push('connect');throw Error('Unexpected DB connection')}
  query(){connections.push('query');throw Error('Unexpected DB query')}
  end(){}
}
mock.module('../public-app/backend/deadhub/store.js',{namedExports:{
  createRecordPool:options=>actualStore.createRecordPool({...options,Pool:FakePool}),
  createRecordStore:pool=>{if(storeFailure)throw privateError();return actualStore.createRecordStore(pool)}
}})
mock.module('../public-app/backend/deadhub/provider.js',{namedExports:{...actualProvider,
  createRecordProvider:()=>{if(providerFailure)throw privateError();return actualProvider.createRecordProvider()}
}})
const {createRecordRuntime}=await import('../public-app/backend/deadhub/runtime.js')
mock.method(globalThis,'fetch',()=>{external.push(true);throw Error('Unexpected external request')})
after(()=>{assert.deepEqual(connections,[]);assert.deepEqual(external,[]);mock.restoreAll()})
const direct=()=>['postgresql:','//deadhub_app_login:DUMMY_ONLY@','db.adxoqjgmhmortztqngcz.supabase.co/postgres'].join('')
const valid=()=>({DEADHUB_ENABLED:'true',VERCEL_ENV:'production',DEADHUB_OWNER_STEAM_ID:accountIdToSteamId('1'),
  DEADHUB_DB_URL:direct(),DEADHUB_DB_CA_CERT:'DUMMY_CA_NOT_A_CERTIFICATE',DEADHUB_PUBLIC_ORIGIN:'https://records.example.test'})
function run(env,options={}){
  const logs=[],before=constructed.length
  const runtime=createRecordRuntime({env,initializationLogger:(...args)=>logs.push(args),...options})
  return {runtime,logs,pools:constructed.slice(before)}
}
function failed(result,code){
  assert.deepEqual(result.runtime,{})
  assert.deepEqual(result.logs,[['DEADHUB_INIT_'+code]])
}
function config(runtime){
  const app=createDeadhubApp(runtime),route=app.router.stack.find(layer=>layer.route?.path==='/api/deadhub/config').route.stack[0].handle
  let body;route({}, {json:value=>{body=value}});return body
}

test('flag requires exact true and short-circuits every other configuration read',()=>{
  for(const flag of [undefined,'false','TRUE',' true','true ','1']){
    const env={DEADHUB_ENABLED:flag}
    for(const key of ['VERCEL_ENV','DEADHUB_OWNER_STEAM_ID','DEADHUB_DB_URL','DEADHUB_DB_CA_CERT','DEADHUB_PUBLIC_ORIGIN'])
      Object.defineProperty(env,key,{get(){throw Error('Later configuration read')}})
    const result=run(env);failed(result,'DISABLED');assert.equal(result.pools.length,0)
    assert.deepEqual(config(result.runtime),{enabled:false,auth:'steam',time_zone:'Asia/Tokyo'})
  }
})

test('non-production environment remains disconnected with no owner or DB reads',()=>{
  for(const value of [undefined,'preview','development','Production','production ']){
    const env={DEADHUB_ENABLED:'true',VERCEL_ENV:value}
    for(const key of ['DEADHUB_OWNER_STEAM_ID','DEADHUB_DB_URL'])Object.defineProperty(env,key,{get(){throw Error('Later configuration read')}})
    const result=run(env);failed(result,'ENVIRONMENT');assert.equal(result.pools.length,0)
  }
})

test('owner format and semantic Steam account validation retain distinct fixed diagnostics',()=>{
  for(const owner of [undefined,'','1','DUMMY_OWNER',accountIdToSteamId('1')+' ', ' '+accountIdToSteamId('1')]){
    const result=run({...valid(),DEADHUB_OWNER_STEAM_ID:owner});failed(result,'OWNER_FORMAT');assert.equal(result.pools.length,0)
  }
  for(const owner of ['00000000000000001',String(BigInt(accountIdToSteamId('1'))-1n),String(BigInt(accountIdToSteamId('1'))+2147483647n)]){
    const result=run({...valid(),DEADHUB_OWNER_STEAM_ID:owner});failed(result,'OWNER_ID');assert.equal(result.pools.length,0)
  }
})

test('invalid DB URL configuration fails without constructing a Pool or logging input',()=>{
  const invalid=[undefined,'DUMMY_NOT_A_URL',direct().replace('postgresql:','https:'),
    direct().replace('adxoqjgmhmortztqngcz','wrong-project'),direct().replace('deadhub_app_login','wrong_role'),
    direct().replace(':DUMMY_ONLY',''),direct().replace('/postgres','/wrong_database'),
    direct().replace('deadhub_app_login','%ZZ')]
  for(const url of invalid){
    const result=run({...valid(),DEADHUB_DB_URL:url});failed(result,'DATABASE');assert.equal(result.pools.length,0)
  }
})

test('Pool and store construction errors emit only one local database stage',()=>{
  for(const target of ['pool','store']){
    poolFailure=target==='pool';storeFailure=target==='store'
    try{failed(run(valid()),'DATABASE')}finally{poolFailure=false;storeFailure=false}
  }
})

test('origin must remain an exact HTTPS origin; no trimming or slash removal',()=>{
  for(const origin of [undefined,'DUMMY_ORIGIN','http://records.example.test','https://records.example.test/',
    'https://records.example.test/path','https://records.example.test?dummy=1','https://records.example.test#dummy',
    ' https://records.example.test','https://records.example.test ','https://dummy@records.example.test']){
    const result=run({...valid(),DEADHUB_PUBLIC_ORIGIN:origin});failed(result,'AUTH')
    assert.equal(result.pools.length,1);assert.equal(result.pools[0].ssl.rejectUnauthorized,true)
    assert.equal(config(result.runtime).enabled,false)
  }
})

test('valid direct and pooled config preserve verified TLS and initialize without DB or provider calls',()=>{
  const pooled=direct().replace('deadhub_app_login:','deadhub_app_login.adxoqjgmhmortztqngcz:').replace('db.adxoqjgmhmortztqngcz.supabase.co','aws-0-test.pooler.supabase.com')
  for(const url of [direct(),pooled]){
    const env={...valid(),DEADHUB_DB_URL:url+'?sslmode=disable&application_name=DUMMY_OVERRIDE'},result=run(env)
    assert.deepEqual(result.logs,[]);assert.equal(result.runtime.auth.origin,env.DEADHUB_PUBLIC_ORIGIN)
    assert.equal(typeof result.runtime.sync,'function');assert.ok(result.runtime.store);assert.ok(result.runtime.cronOwner)
    assert.equal(config(result.runtime).enabled,true)
    assert.equal(result.pools.length,1)
    const options=result.pools[0];assert.deepEqual(options.ssl,{rejectUnauthorized:true,ca:'DUMMY_CA_NOT_A_CERTIFICATE'})
    assert.equal(new URL(options.connectionString).search,'')
    assert.equal(options.max,2);assert.equal(options.application_name,'deadhub-records')
    assert.deepEqual(connections,[]);assert.deepEqual(external,[])
  }
})

test('CA and password authenticity plus cron secret are not checked during constructor-only initialization',()=>{
  for(const ca of [undefined,'','DUMMY_CA_NOT_A_CERTIFICATE']){
    const result=run({...valid(),DEADHUB_DB_CA_CERT:ca,CRON_SECRET:undefined})
    assert.deepEqual(result.logs,[]);assert.equal(config(result.runtime).enabled,true)
    assert.equal(result.pools[0].ssl.rejectUnauthorized,true)
    assert.deepEqual(connections,[])
  }
})

test('unexpected service construction failure remains closed and sanitized',()=>{
  providerFailure=true
  try{failed(run(valid()),'SERVICES')}finally{providerFailure=false}
})

test('default logger receives one fixed string; failing logger cannot enable a runtime',()=>{
  const captured=[],saved=console.warn;console.warn=(...args)=>captured.push(args)
  try{
    const runtime=createRecordRuntime({env:{DEADHUB_ENABLED:'false'}})
    assert.deepEqual(runtime,{});assert.deepEqual(captured,[['DEADHUB_INIT_DISABLED']])
  }finally{console.warn=saved}
  assert.deepEqual(createRecordRuntime({env:{DEADHUB_ENABLED:'false'},initializationLogger:()=>{throw privateError()}}),{})
  const result=run(valid(),{initializationLogger:()=>{throw Error('No success logs expected')}})
  assert.equal(config(result.runtime).enabled,true)
})
