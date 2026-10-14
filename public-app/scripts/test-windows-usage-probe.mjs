import test from 'node:test'
import assert from 'node:assert/strict'
import {PassThrough,Writable} from 'node:stream'
import {runWindowsProbe,promptHidden} from './windows-usage-probe.mjs'
const ca='-----BEGIN CERTIFICATE-----\nPUBLIC TEST CA ONLY\n-----END CERTIFICATE-----'
const uri='postgresql:'+'//fixture-user:public-dummy-only@fixture.invalid/postgres'
const success={status:'passed',metadata_only:true,writes:0,usage_collection_enabled:false,cron_verified:false,backup_verified:false}
test('PowerShell-friendly --ca path is literal, URI asked once, disabled metadata-only delegation',async()=>{
 let prompts=0,calls=0
 const result=await runWindowsProbe({caPath:'C:\\Public certs\\CA.pem',readPublicCa:async path=>{assert.equal(path,'C:\\Public certs\\CA.pem');return ca},askForUri:async()=>{prompts++;return uri},probe:async({env})=>{calls++;assert.equal(env.FYTH_USAGE_ENABLED,'false');assert.equal(env.FYTH_USAGE_DB_URL,uri);assert.equal(env.FYTH_USAGE_DB_CA_CERT,ca);return {...success,unexpected_private:uri}}})
 assert.deepEqual(result,success);assert.equal(prompts,1);assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(uri))
})
test('missing/public-CA checks stop before asking URI or invoking authentication',async()=>{
 for(const certificate of ['',ca+'\n-----BEGIN '+'PRIVATE '+'KEY-----']){
  let called=false
  const result=await runWindowsProbe({caPath:'public.pem',readPublicCa:async()=>certificate,askForUri:async()=>{called=true;return uri},probe:async()=>{called=true;return success}})
  assert.equal(result.status,'failed');assert.equal(called,false)
 }
})
test('empty input/cancel/error are sanitized; secret never returned',async()=>{
 for(const askForUri of [async()=>'',async()=>{throw new Error(uri)}]){
  const result=await runWindowsProbe({caPath:'ca.pem',readPublicCa:async()=>ca,askForUri})
  assert.deepEqual(result,{status:'failed',code:'windows_probe_setup_failed'})
 }
 const result=await runWindowsProbe({caPath:'ca.pem',readPublicCa:async()=>ca,askForUri:async()=>uri,probe:async()=>{throw new Error(uri)}})
 assert.deepEqual(result,{status:'failed',code:'windows_probe_setup_failed'})
})
test('does not claim success for writes, activation or incomplete proof',async()=>{
 for(const change of [{writes:1},{usage_collection_enabled:true},{metadata_only:false},{status:'failed'}])assert.equal((await runWindowsProbe({caPath:'ca.pem',readPublicCa:async()=>ca,askForUri:async()=>uri,probe:async()=>({...success,...change})})).status,'failed')
})
test('actual readline hidden-input path: no echo, no URI output, raw mode restored',async()=>{
 const input=new PassThrough();input.isTTY=true;const raw=[];input.setRawMode=value=>{raw.push(value)}
 let transcript='';const output=new Writable({write(chunk,encoding,callback){transcript+=chunk.toString();callback()}});output.isTTY=true
 const pending=promptHidden({input,output});input.write(uri+'\r');assert.equal(await pending,uri)
 assert.ok(transcript.includes('hidden'));assert.ok(!transcript.includes(uri));assert.equal(raw.at(-1),false);input.end()
})
test('noninteractive/piped console refuses hidden URI entry',async()=>{
 await assert.rejects(promptHidden({input:{isTTY:false},output:{isTTY:true}}))
})
