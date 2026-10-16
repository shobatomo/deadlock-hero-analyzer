import {useState} from 'react'
import {safeSteamProfile} from '../../../../shared/steam-profile.mjs'
export default function SteamProfile({steamId,profile}) {
  const safe=safeSteamProfile(profile,steamId),[failed,setFailed]=useState(null)
  const avatar=safe?.avatar_url
  return <div className="dh-profile">
    <div className="dh-avatar" aria-hidden="true">
      {avatar&&failed!==avatar?<img key={avatar} src="/api/deadhub/profile/avatar" alt="" width="64" height="64" referrerPolicy="no-referrer" decoding="async" onError={()=>setFailed(avatar)}/>:
        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="24" cy="17" r="7"/><path d="M10 40v-4a14 14 0 0 1 28 0v4"/></svg>}
    </div>
    <div className="dh-profile-text"><span className="dh-label">Steamアカウント</span>
      <strong className="dh-profile-name"><bdi dir="auto">{safe?.display_name??'Steamユーザー'}</bdi></strong>
      <small className="dh-steam">Steam ID: {steamId}</small>
    </div>
  </div>
}
