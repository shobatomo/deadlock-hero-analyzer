import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {createSteamProfileProvider,createSteamAvatarProvider} from '../public-app/backend/deadhub/steam-profile.js'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {createSteamAuth,ownerForAccount} from '../public-app/backend/deadhub/auth.js'
import {safeSteamAvatar,safeSteamProfile} from '../public-app/shared/steam-profile.mjs'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {accountIdToSteamId} from '../public-app/shared/diagnosis.mjs'
const id=accountIdToSteamId('1'),other=accountIdToSteamId('2'),key='a'.repeat(32)
const avatar='https://avatars.steamstatic.com/'+'b'.repeat(40)+'_medium.jpg'
const player=(extra={})=>({steamid:id,personaname:'ダミープレイヤー',avatarmedium:avatar,realname:'DO_NOT_RETURN',profileurl:'https://untrusted.example/',...extra})
const body=p=>Response.json({response:{players:p}})
const original=globalThis.fetch;let unexpected=0
globalThis.fetch=()=>{unexpected++;throw Error('No real network in profile tests')}
after(()=>{globalThis.fetch=original;assert.equal(unexpected,0)})

test('missing/invalid key disables profile provider without requests or configuration changes',()=>{
 for(const apiKey of [undefined,null,'','DUMMY_NOT_A_KEY'])assert.equal(createSteamProfileProvider({apiKey}),null)
})
test('official user API uses one verified ID and a header key; only display fields survive',async()=>{
 let calls=0
 const provider=createSteamProfileProvider({apiKey:key,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url.origin,'https://api.steampowered.com');assert.equal(url.pathname,'/ISteamUser/GetPlayerSummaries/v2/')
  assert.deepEqual([...url.searchParams],[['steamids',id]]);assert.ok(!url.href.includes(key));assert.equal(options.headers['x-webapi-key'],key)
  assert.equal(options.redirect,'error');assert.equal(options.signal.aborted,false);return body([player()])
 }})
 assert.deepEqual(await provider(id),{steam_id:id,display_name:'ダミープレイヤー',avatar_url:avatar});assert.equal(calls,1)
})
test('mismatched identity, duplicate players, malformed, large and failed responses fall back',async()=>{
 const fixtures=[()=>body([player({steamid:other})]),()=>body([player(),player()]),()=>body([]),()=>new Response('{bad'),()=>new Response('x'.repeat(16385)),()=>new Response('',{status:429}),()=>{throw Error('DUMMY_PRIVATE_ERROR')}]
 for(const fetchImpl of fixtures)assert.equal(await createSteamProfileProvider({apiKey:key,fetchImpl})(id),null)
})
test('timeout also bounds a non-cooperative mock fetch and aborts its signal',async()=>{
 let signal
 const start=Date.now(),provider=createSteamProfileProvider({apiKey:key,timeoutMs:15,fetchImpl:async(u,o)=>{signal=o.signal;return new Promise(()=>{})}})
 assert.equal(await provider(id),null);assert.equal(signal.aborted,true);assert.ok(Date.now()-start<1000)
})
test('success/failure caching is bounded in time and concurrent reads share one request',async()=>{
 let clock=0,calls=0,resolve
 const provider=createSteamProfileProvider({apiKey:key,now:()=>clock,fetchImpl:()=>{calls++;return new Promise(r=>resolve=r)}})
 const first=provider(id),second=provider(id);resolve(body([player()]));assert.deepEqual(await first,await second);assert.equal(calls,1)
 await provider(id);assert.equal(calls,1);clock=300001
 const expired=provider(id);resolve(new Response('',{status:503}));assert.equal(await expired,null);assert.equal(calls,2)
 clock+=29999;assert.equal(await provider(id),null);assert.equal(calls,2)
 clock+=2;const retry=provider(id);resolve(body([player()]));assert.ok(await retry);assert.equal(calls,3)
})
test('avatar allowlist rejects script, data, SVG, userinfo, query, wrong host and deceptive paths',()=>{
 assert.equal(safeSteamAvatar(avatar),avatar)
 for(const input of ['javascript:alert(1)','data:image/svg+xml,x','http:'+avatar.slice(6),avatar+'?key=x',avatar+'#x',avatar.replace('.jpg','.svg'),avatar.replace('avatars.steamstatic.com','avatars.steamstatic.com.evil.test'),avatar.replace('https://','https://user@'),avatar.replace('/'+ 'b'.repeat(40),'/%2e%2e/'+ 'b'.repeat(40))])assert.equal(safeSteamAvatar(input),null,input)
 const legacy='https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/bb/'+'b'.repeat(40)+'_full.jpg';assert.equal(safeSteamAvatar(legacy),legacy)
})
test('profile projection requires identity match and strips control text while bounding name',()=>{
 assert.equal(safeSteamProfile({steam_id:other,display_name:'wrong'},id),null)
 const p=safeSteamProfile({steam_id:id,display_name:'\u202e\u0000'+ '字'.repeat(100),avatar_url:'https://evil.test/p.jpg',extra:'DROP'},id)
 assert.equal(Array.from(p.display_name).length,80);assert.equal(p.avatar_url,null);assert.deepEqual(Object.keys(p),['steam_id','display_name','avatar_url'])
})
test('profile route uses session identity only and failure is a harmless null response',async()=>{
 for(const mode of ['ok','throw','missing']){
  const ids=[];const profile=mode==='missing'?null:async steamId=>{ids.push(steamId);if(mode==='throw')throw Error('DUMMY_PRIVATE');return {steam_id:steamId,display_name:'ダミー',avatar_url:avatar,extra:'DROP'}}
  const app=createDeadhubApp({store:{},sync:async()=>{},auth:{origin:'https://dummy.example.test'},profile})
  const route=app.router.stack.find(l=>l.route?.path==='/api/deadhub/profile').route.stack[0].handle
  let result;await route({identity:{steamId:id},query:{steamid:other},body:{steamid:other}},{json:r=>result=r})
  assert.deepEqual(ids,mode==='missing'?[]:[id]);assert.deepEqual(result,mode==='ok'?{profile:{steam_id:id,display_name:'ダミー',avatar_url:avatar}}:{profile:null})
 }
})

const jpeg=Buffer.from([255,216,255,224,0,2,255,217])
const image=()=>new Response(jpeg,{headers:{'content-type':'image/jpeg'}})
const display=steamId=>({steam_id:steamId,display_name:'Fixture',avatar_url:avatar})
test('avatar uses only the verified profile URL, rejects redirects and sends no API key or credentials',async()=>{
 let calls=0
 const provider=createSteamAvatarProvider({profile:async steamId=>display(steamId),fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,avatar);assert.deepEqual(options.headers,{Accept:'image/jpeg'});assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.signal.aborted,false);return image()
 }})
 assert.deepEqual(await provider(id),jpeg);assert.equal(calls,1)
 assert.equal(createSteamAvatarProvider({profile:null}),null)
 assert.equal(await provider('invalid'),null);assert.equal(calls,1)
 for(const value of [null,display(other),{...display(id),avatar_url:'https://evil.test/a.jpg'}])assert.equal(await createSteamAvatarProvider({profile:async()=>value,fetchImpl:()=>{throw Error('URL validation must stop fetch')}})(id),null)
})
test('avatar redirects, MIME spoofing, non-JPEG, oversize and provider errors return no image',async()=>{
 const fixtures=[()=>new Response(null,{status:302,headers:{location:'https://evil.test/a.jpg'}}),()=>new Response('<svg/>',{headers:{'content-type':'image/svg+xml'}}),()=>new Response('<svg/>',{headers:{'content-type':'image/jpeg'}}),()=>new Response(Buffer.alloc(131073),{headers:{'content-type':'image/jpeg'}}),()=>new Response(null,{status:503}),()=>{throw Error('DUMMY_PRIVATE')}]
 for(const fetchImpl of fixtures)assert.equal(await createSteamAvatarProvider({profile:async()=>display(id),fetchImpl})(id),null)
 assert.equal(await createSteamAvatarProvider({profile:async()=>{throw Error('Profile unavailable')}})(id),null)
})
test('avatar deadline covers both profile lookup and image body without blocking name retrieval',async()=>{
 const start=Date.now()
 assert.equal(await createSteamAvatarProvider({profile:()=>new Promise(()=>{}),timeoutMs:15})(id),null)
 let signal
 const p=createSteamAvatarProvider({profile:async()=>display(id),timeoutMs:15,fetchImpl:async(u,o)=>{signal=o.signal;return new Response(new ReadableStream({start(){}}),{headers:{'content-type':'image/jpeg'}})}})
 assert.equal(await p(id),null);assert.equal(signal.aborted,true);assert.ok(Date.now()-start<1000)
})
test('avatar cache is bounded, identity-specific and coalesces concurrent reads',async()=>{
 let clock=0,calls=0,resolve
 const p=createSteamAvatarProvider({profile:async steamId=>display(steamId),now:()=>clock,fetchImpl:()=>{calls++;return new Promise(r=>resolve=r)}})
 const a=p(id),b=p(id);await new Promise(queueMicrotask);resolve(image());assert.deepEqual(await a,await b);assert.equal(calls,1)
 await p(id);assert.equal(calls,1);clock=300001
 const expired=p(id);await new Promise(queueMicrotask);resolve(new Response(null,{status:503}));assert.equal(await expired,null);assert.equal(calls,2)
 clock+=29999;assert.equal(await p(id),null);assert.equal(calls,2)
 clock+=2;const retry=p(other);await new Promise(queueMicrotask);resolve(image());assert.deepEqual(await retry,jpeg);assert.equal(calls,3)
})
function routeWithoutListening(app,url,cookie='') {
 return new Promise((resolve,reject)=>{
  const socket=new Socket(),req=new IncomingMessage(socket),res=new ServerResponse(req)
  req.method='GET';req.url=url;req.headers={cookie};req.push(null)
  const timer=setTimeout(()=>reject(Error('Router did not finish')),1000)
  res.end=function(chunk){clearTimeout(timer);resolve({status:this.statusCode,headers:this.getHeaders(),body:chunk?Buffer.from(chunk):Buffer.alloc(0)});return this}
  app.handle(req,res,error=>{clearTimeout(timer);reject(error??Error('Unhandled route'))})
 })
}
test('real auth middleware denies missing or invalid sessions before either display provider runs',async()=>{
 for(const session of [null,{steam_account_id:'2',owner_id:ownerForAccount('2')},{steam_account_id:'1',owner_id:ownerForAccount('2')}]){
  let calls=0;const auth=createSteamAuth({store:{resolveSession:async()=>session},origin:'https://dummy.example.test',allowedAccounts:['1']})
  const app=createDeadhubApp({store:{},sync:async()=>{},auth,profile:()=>{calls++;return display(id)},avatar:()=>{calls++;return jpeg}})
  for(const endpoint of ['profile','profile/avatar'])for(const cookie of ['', '__Host-deadhub_session='+'a'.repeat(43)]){
   const response=await routeWithoutListening(app,'/api/deadhub/'+endpoint+'?steamid='+other,cookie)
   assert.equal(response.status,401);assert.equal(JSON.parse(response.body).code,'unauthorized');assert.equal(calls,0)
  }
 }
})
test('real router uses verified session identity for profile and avatar and keeps private response headers',async()=>{
 const seen=[],auth=createSteamAuth({store:{resolveSession:async()=>({steam_account_id:'1',owner_id:ownerForAccount('1')})},origin:'https://dummy.example.test',allowedAccounts:['1']})
 const app=createDeadhubApp({store:{},sync:async()=>{},auth,profile:async steamId=>{seen.push(steamId);return display(steamId)},avatar:async steamId=>{seen.push(steamId);return jpeg}})
 for(const endpoint of ['profile','profile/avatar']){
  const response=await routeWithoutListening(app,'/api/deadhub/'+endpoint+'?steamid='+other+'&url=https://evil.test','__Host-deadhub_session='+'a'.repeat(43))
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'private, no-store');assert.equal(response.headers['x-content-type-options'],'nosniff')
  if(endpoint==='profile/avatar'){assert.equal(response.headers['content-type'],'image/jpeg');assert.deepEqual(response.body,jpeg)}else assert.equal(JSON.parse(response.body).profile.steam_id,id)
 }
 assert.deepEqual(seen,[id,id])
})
test('avatar route failures stay empty and private; exceptions containing keys are never logged or returned',async()=>{
 const lines=[],saved={warn:console.warn,error:console.error,log:console.log}
 try {
  for(const name of Object.keys(saved))console[name]=(...values)=>lines.push(values)
  const auth={origin:'https://dummy.example.test',identify:async()=>({steamId:id})}
  const app=createDeadhubApp({store:{},sync:async()=>{},auth,profile:async()=>{throw Error(key)},avatar:async()=>{throw Error(key)}})
  const a=await routeWithoutListening(app,'/api/deadhub/profile/avatar'),p=await routeWithoutListening(app,'/api/deadhub/profile')
  assert.equal(a.status,404);assert.equal(a.body.length,0);assert.deepEqual(JSON.parse(p.body),{profile:null});assert.equal(lines.length,0)
 } finally {Object.assign(console,saved)}
})
