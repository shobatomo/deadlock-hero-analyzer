// Synthetic-only failures. Network functions are blocked before any Pool is constructed.
import {test,mock,after} from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import tls from 'node:tls'
import {createRecordPool,getRecordPoolFailureCode} from '../public-app/backend/deadhub/store.js'
let networkCalls=0
const forbidden=()=>{networkCalls++;throw Error('Unexpected network call')}
mock.method(net.Socket.prototype,'connect',forbidden)
mock.method(tls,'connect',forbidden)
mock.method(globalThis,'fetch',forbidden)
after(()=>{assert.equal(networkCalls,0);mock.restoreAll()})
const direct=()=>['postgresql:','//deadhub_app_login:DUMMY_ONLY@','db.adxoqjgmhmortztqngcz.supabase.co/postgres'].join('')
const privateError=()=>Object.assign(new Error('DUMMY_PRIVATE_URL_CERTIFICATE_PASSWORD'),{code:'DUMMY_DRIVER_CODE',stage:'DUMMY_STAGE'})
class FakePool{constructor(options){this.options=options}on(name,listener){assert.equal(name,'error');assert.equal(typeof listener,'function')}}
function failure(options,code){
 let error;try{createRecordPool({connectionString:direct(),ca:'DUMMY_CA',Pool:FakePool,...options})}catch(caught){error=caught}
 assert.ok(error);assert.equal(error.message,'Record database initialization failed')
 assert.equal(error.cause,undefined);assert.equal(error.code,undefined)
 assert.equal(getRecordPoolFailureCode(error),'DEADHUB_INIT_DB_'+code)
 assert.ok(!JSON.stringify(error).includes('DUMMY_PRIVATE'))
 return error
}

test('each URL condition has a fixed code without exposing parser input',()=>{
 for(const connectionString of [undefined,'DUMMY_NOT_A_URL','https://[DUMMY_INVALID'])failure({connectionString},'URL_PARSE')
 for(const [connectionString,code] of [[direct().replace('postgresql:','https:'),'URL_SCHEME'],
  [direct().replace('deadhub_app_login','%ZZ'),'URL_USERNAME_DECODE'],
  [direct().replace('adxoqjgmhmortztqngcz','other-project'),'URL_TARGET'],
  [direct().replace('deadhub_app_login','other_role'),'URL_TARGET'],
  [direct().replace(':DUMMY_ONLY',''),'URL_PASSWORD'],
  [direct().replace('/postgres','/other_database'),'URL_PATHNAME']])failure({connectionString},code)
})

test('combined URL failures preserve username, scheme, target, password and pathname priority',()=>{
 const wrong=direct().replace('postgresql:','https:').replace('deadhub_app_login','other_role').replace(':DUMMY_ONLY','').replace('/postgres','/other_database')
 failure({connectionString:wrong.replace('other_role','%ZZ')},'URL_USERNAME_DECODE')
 failure({connectionString:wrong},'URL_SCHEME')
 failure({connectionString:wrong.replace('https:','postgresql:')},'URL_TARGET')
 failure({connectionString:wrong.replace('https:','postgresql:').replace('other_role','deadhub_app_login')},'URL_PASSWORD')
 failure({connectionString:direct().replace('/postgres','/other_database')},'URL_PATHNAME')
})

test('query-option preparation failures are distinguished without accepting URI TLS overrides',t=>{
 t.mock.method(URLSearchParams.prototype,'delete',()=>{throw privateError()})
 failure({connectionString:direct()+'?sslmode=disable'},'URL_OPTIONS')
})

test('missing or malformed Pool export shapes receive a driver code without fallback',()=>{
 for(const Pool of [null,{},'DUMMY_DRIVER',{default:FakePool}])failure({Pool},'DRIVER')
})

test('constructor failures and non-constructible function exports receive only a pool code',()=>{
 failure({Pool:class{constructor(){throw privateError()}}},'POOL')
 failure({Pool:()=>({})},'POOL')
 failure({Pool:new Proxy(FakePool,{construct(){throw privateError()}})},'POOL')
})

test('listener access and registration failures receive a separate fixed code',()=>{
 failure({Pool:class{get on(){throw privateError()}}},'LISTENER')
 failure({Pool:class{on(){throw privateError()}}},'LISTENER')
})

test('only locally generated errors can supply diagnostics; forged properties are ignored',()=>{
 const forged=Object.assign(privateError(),{poolFailureCode:'DEADHUB_INIT_DB_URL_PARSE',code:'DEADHUB_INIT_DB_POOL'})
 const hostile=new Proxy({}, {get(){throw privateError()}})
 for(const value of [null,undefined,'DUMMY_PRIVATE',forged,hostile])assert.equal(getRecordPoolFailureCode(value),null)
 const error=failure({Pool:class{constructor(){throw forged}}},'POOL')
 assert.notEqual(error,forged)
})

test('valid direct and pooler targets retain the original verified TLS and bounded options',()=>{
 const pooled=direct().replace('deadhub_app_login:','deadhub_app_login.adxoqjgmhmortztqngcz:').replace('db.adxoqjgmhmortztqngcz.supabase.co','aws-0-test.pooler.supabase.com')
 for(const connectionString of [direct(),pooled]){
  const pool=createRecordPool({connectionString:connectionString+'?sslmode=disable&application_name=DUMMY_OVERRIDE',ca:'DUMMY_CA',Pool:FakePool})
  assert.deepEqual(pool.options,{connectionString,ssl:{rejectUnauthorized:true,ca:'DUMMY_CA'},max:2,
   connectionTimeoutMillis:3000,idleTimeoutMillis:10000,query_timeout:5000,statement_timeout:4000,lock_timeout:1000,application_name:'deadhub-records'})
 }
})

test('real installed pg default export constructs and closes an idle Pool without network or TLS handshake',async()=>{
 const pool=createRecordPool({connectionString:direct(),ca:'DUMMY_CA_NOT_A_CERTIFICATE'})
 assert.equal(pool.totalCount,0);assert.equal(pool.idleCount,0);assert.equal(pool.waitingCount,0)
 assert.equal(pool.options.ssl.rejectUnauthorized,true)
 assert.equal(networkCalls,0);await pool.end();assert.equal(networkCalls,0)
})
