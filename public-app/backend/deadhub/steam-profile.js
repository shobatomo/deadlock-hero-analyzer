import {safeSteamAvatar,safeSteamProfile} from '../../shared/steam-profile.mjs'
const ENDPOINT='https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/'
// Optional, display-only API. The key stays in a server-side header, never a URL.
export function createSteamProfileProvider({apiKey,fetchImpl=fetch,timeoutMs=2500,now=()=>Date.now()}={}) {
  if(typeof apiKey!=='string'||!/^[a-f0-9]{32}$/i.test(apiKey))return null
  let cached=null,pending=null
  async function retrieve(steamId) {
    const control=new AbortController();let timer
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{control.abort();resolve(null)},Math.min(2500,Math.max(1,timeoutMs)))})
    const work=(async()=>{
      const url=new URL(ENDPOINT);url.searchParams.set('steamids',steamId)
      const response=await fetchImpl(url,{headers:{'x-webapi-key':apiKey,Accept:'application/json'},redirect:'error',signal:control.signal})
      if(!response.ok||!response.body)return null
      const chunks=[];let size=0
      for await(const chunk of response.body){size+=chunk.length;if(size>16384)throw Error('Profile response limit');chunks.push(chunk)}
      const players=JSON.parse(Buffer.concat(chunks).toString('utf8'))?.response?.players
      if(!Array.isArray(players)||players.length!==1||players[0]?.steamid!==steamId)return null
      const player=players[0]
      return safeSteamProfile({steam_id:steamId,display_name:player.personaname,avatar_url:player.avatarmedium??player.avatarfull},steamId)
    })().catch(()=>null)
    try{return await Promise.race([work,timeout])}finally{clearTimeout(timer);control.abort()}
  }
  return async steamId=>{
    if(typeof steamId!=='string'||!/^\d{17}$/.test(steamId))return null
    if(cached?.id===steamId&&cached.until>now())return cached.value
    if(pending?.id===steamId)return pending.work
    const work=retrieve(steamId).then(value=>{cached={id:steamId,value,until:now()+(value?300000:30000)};return value})
    pending={id:steamId,work}
    try{return await work}finally{if(pending?.work===work)pending=null}
  }
}

// Fetch images server-side so redirects cannot escape the avatar allowlist.
// No user-supplied URL, cookies, or API key is sent to the image host.
export function createSteamAvatarProvider({profile,fetchImpl=fetch,timeoutMs=2000,now=()=>Date.now()}={}) {
  if(typeof profile!=='function')return null
  let cached=null,pending=null
  async function retrieve(steamId) {
    const control=new AbortController();let timer
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>{control.abort();resolve(null)},Math.min(2000,Math.max(1,timeoutMs)))})
    const work=(async()=>{
      const value=safeSteamProfile(await profile(steamId),steamId),url=safeSteamAvatar(value?.avatar_url)
      if(!url||control.signal.aborted)return null
      const response=await fetchImpl(url,{headers:{Accept:'image/jpeg'},redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:control.signal})
      if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/jpeg')return null
      const chunks=[];let size=0
      for await(const chunk of response.body){size+=chunk.length;if(size>131072)throw Error('Avatar response limit');chunks.push(chunk)}
      const bytes=Buffer.concat(chunks)
      if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)return null
      return bytes
    })().catch(()=>null)
    try{return await Promise.race([work,timeout])}finally{clearTimeout(timer);control.abort()}
  }
  return async steamId=>{
    if(typeof steamId!=='string'||!/^\d{17}$/.test(steamId))return null
    if(cached?.id===steamId&&cached.until>now())return cached.value
    if(pending?.id===steamId)return pending.work
    const work=retrieve(steamId).then(value=>{cached={id:steamId,value,until:now()+(value?300000:30000)};return value})
    pending={id:steamId,work}
    try{return await work}finally{if(pending?.work===work)pending=null}
  }
}
