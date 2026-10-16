// Display-only data. This must never establish or change a user's identity.
const avatarHosts=new Set(['avatars.steamstatic.com','avatars.fastly.steamstatic.com','avatars.akamai.steamstatic.com','avatars.cloudflare.steamstatic.com'])
export function safeSteamAvatar(value) {
  if(typeof value!=='string'||value.length>512||/[\\%\u0000-\u0020\u007f]/.test(value))return null
  try {
    const url=new URL(value)
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)return null
    const path=avatarHosts.has(url.hostname)?/^\/[a-f0-9]{40}(?:_(?:medium|full))?\.jpg$/i:
      url.hostname==='steamcdn-a.akamaihd.net'?/^\/steamcommunity\/public\/images\/avatars\/[a-f0-9]{2}\/[a-f0-9]{40}(?:_(?:medium|full))?\.jpg$/i:null
    return path?.test(url.pathname)?url.href:null
  } catch {return null}
}
export function safeSteamProfile(value,steamId) {
  if(!value||typeof steamId!=='string'||!/^\d{17}$/.test(steamId)||value.steam_id!==steamId)return null
  const name=typeof value.display_name==='string'?Array.from(value.display_name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim()).slice(0,80).join(''):''
  const avatar=safeSteamAvatar(value.avatar_url)
  return name||avatar?{steam_id:steamId,display_name:name||null,avatar_url:avatar}:null
}
