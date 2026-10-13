import * as fs from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,dirname,relative} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createPreviewServer} from './public-preview-server.mjs'
import {createPublicApp} from '../backend/public-app.js'
import {nodeDiagnosis} from '../backend/five-axis.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const blockedPath=p=>/(?:^|\/)(?:node_modules|\.env[^/]*|\.fyth-local|analysis|documents|database|deployment|\.vercel|profile[^/]*)(?:\/|$)/.test(p)||/reference-daily|writer|own-history|LegacyResult|backend\/(?:collection|server)\.js/.test(p)
// Steam public individual base is a protocol constant, not an account ID.
// Permit only this exact BigInt literal; keep all other Steam IDs blocked.
const scanText=text=>text.replace(new RegExp('\\b'+['7656119','7960265728'].join('')+'n\\b','g'),'STEAM_PUBLIC_BASE')
const patterns=[/postgres(?:ql)?:\/\/[^\s'"]+/,/gh[pousr]_[A-Za-z0-9]{20,}/,/github_pat_[A-Za-z0-9_]{20,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/7656119[0-9]{10}/,/"account_id"\s*:\s*(?:"[0-9]+"|[0-9]+)/]
export const hasSensitiveText=text=>patterns.some(pattern=>pattern.test(scanText(text)))
async function resolveImport(path,spec,allowed){
 const stem=resolve(dirname(resolve(root,path)),spec)
 assert.ok(!relative(root,stem).startsWith('..'),'import escapes bundle')
 const options=[stem,...['.js','.jsx','.mjs','.json','.css'].map(x=>stem+x)]
 assert.ok(options.some(p=>allowed.has(relative(root,p).split('\\').join('/'))),'missing import in '+path)
}
export async function verifyBundle(){
 assert.match(process.version,/^v22\./)
 const manifest=JSON.parse(await fs.readFile(resolve(root,'public-manifest.json'),'utf8')),allowed=new Set(manifest.files.map(f=>f.path))
 assert.equal(allowed.size,manifest.files.length)
 for(const f of manifest.files){
  assert.ok(!blockedPath(f.path)&&!f.path.includes('..')&&!f.path.includes('\\'),'forbidden bundle path')
  assert.ok(!(await fs.lstat(resolve(root,f.path))).isSymbolicLink(),'symlink source');const bytes=await fs.readFile(resolve(root,f.path));assert.equal(sha(bytes),f.sha256,'source drift: '+f.path)
  const text=bytes.toString('utf8');for(const pattern of patterns)assert.ok(!pattern.test(scanText(text)),'sensitive pattern in '+f.path)
  if(/\.(?:js|jsx|mjs)$/.test(f.path)){
   for(const match of text.matchAll(/(?:import|export)\s+[^;\n]*?\sfrom\s*['"](\.[^'"]+)['"]/g))await resolveImport(f.path,match[1],allowed)
   for(const match of text.matchAll(/\bimport\s*['"](\.[^'"]+)['"]/g))await resolveImport(f.path,match[1],allowed)
   if(f.path.startsWith('backend/'))assert.ok(!/child_process|execFile|\.venv|FYTH_DB_WRITE_URL|CRON_SECRET|console\.(?:log|error)/.test(text),'private runtime dependency')
  }
 }
 const config=JSON.parse(await fs.readFile(resolve(root,'vercel.json'),'utf8'))
 assert.equal(config.git.deploymentEnabled,false);assert.equal(config.functions['api/public.js'].maxDuration,65)
 assert.deepEqual(config.rewrites,[...['feedback','diagnosis','candidates','health'].map(n=>({source:'/api/'+n,destination:'/api/public'})),{source:'/result',destination:'/index.html'}])
 const pkg=JSON.parse(await fs.readFile(resolve(root,'package.json'),'utf8')),lock=JSON.parse(await fs.readFile(resolve(root,'package-lock.json'),'utf8'))
 assert.deepEqual(pkg.dependencies,lock.packages[''].dependencies);assert.equal(pkg.engines.node,'22.x')
 const front=JSON.parse(await fs.readFile(resolve(root,'frontend/package.json'),'utf8')),flock=JSON.parse(await fs.readFile(resolve(root,'frontend/package-lock.json'),'utf8'))
 assert.deepEqual(front.dependencies,flock.packages[''].dependencies);assert.deepEqual(front.devDependencies,flock.packages[''].devDependencies)
 const dist=resolve(root,config.outputDirectory),artifacts=[]
 async function checkExtras(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const p=resolve(dir,item.name),name=relative(root,p).split('\\').join('/');assert.ok(!item.isSymbolicLink(),'symlink in bundle');if(['node_modules','frontend/node_modules',config.outputDirectory].includes(name))continue;if(item.isDirectory())await checkExtras(p);else assert.ok(allowed.has(name)||['public-manifest.json','.npmrc-empty'].includes(name),'unreviewed bundle file: '+name)}}
 await checkExtras(root)
 async function scan(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){const file=resolve(dir,item.name);if(item.isDirectory())await scan(file);else{
  assert.ok(!item.name.endsWith('.map'),'source map artifact');const text=(await fs.readFile(file)).toString('utf8')
  for(const pattern of patterns)assert.ok(!pattern.test(scanText(text)),'sensitive compiled artifact')
  assert.ok(!text.includes('sourceMappingURL'),'embedded source map');artifacts.push(relative(dist,file).split('\\').join('/'))
 }}}
 await scan(dist)
 const fields=['kills','deaths','assists','net_worth_per_min','player_damage_per_min','player_damage_taken_per_min']
 const payload={rows:[{hero_id:15,game_mode:1,match_mode:1,match_duration_s:1200,player_kills:4,player_deaths:2,player_assists:5,net_worth:200,metadata:{status:'available',provider_snapshot_maxima:{player_damage:300,player_damage_taken:400}}}],groups:['15','3','1'].flatMap(hero=>[{hero_id:hero,group:'population',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{percentile5:0,percentile50:10,percentile95:30}]))},{hero_id:hero,group:'top',http_status:200,metrics:Object.fromEntries(fields.map(f=>[f,{avg:15}]))}])}
 let calls=0
 const api=createPublicApp({collector:{catalog:async()=>({eligible_count:39,supported_count:3,heroes:[]}),collect:async()=>{calls++;return {...nodeDiagnosis(payload),collection:{storage:'request-only'}}}}})
 const server=(await createPreviewServer({api})).listen(0,'127.0.0.1');await once(server,'listening')
 const url='http://127.0.0.1:'+server.address().port
 try{
  for(const path of ['/','/result']){const response=await fetch(url+path);assert.equal(response.status,200);assert.ok((await response.text()).includes('<div id="root">'))}
  for(const path of ['/api/health','/api/candidates'])assert.equal((await fetch(url+path)).status,200)
  const feedback=await fetch(url+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({choice:'まだ分からない'})});assert.equal(feedback.status,503);assert.deepEqual(await feedback.json(),{status:'not_stored',retryable:true})
  const response=await fetch(url+'/api/diagnosis',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account_id:'1'})})
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const result=await response.json();assert.equal(result.five_axis.status,'ready');assert.equal(result.recommendations.length,3)
  for(const path of ['/api/reference-daily','/.env','/backend/public-app.js','/result/private-id'])assert.equal((await fetch(url+path)).status,404)
  assert.equal(calls,1)
 }finally{await new Promise(r=>server.close(r))}
 return {status:'passed',source_files:manifest.files.length,artifact_files:artifacts.length,source_maps:0,sensitive_pattern_hits:0,api_routes:4,spa_routes:2,worker_route:404,local_only:true,external_calls:0,vercel_runtime_verified:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(await verifyBundle()))}catch(e){console.error(JSON.stringify({status:'failed',code:'public_bundle_verification_failed',reason:e.message}));process.exitCode=1}}
