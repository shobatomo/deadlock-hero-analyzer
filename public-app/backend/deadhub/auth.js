import {createHash,randomBytes,timingSafeEqual} from 'node:crypto'
import {normalizeAccountId,accountIdToSteamId} from '../../shared/diagnosis.mjs'
import {RecordError} from './provider.js'
const NS='http://specs.openid.net/auth/2.0'
const ENDPOINT='https://steamcommunity.com/openid/login'
const ID_PREFIX='https://steamcommunity.com/openid/id/'
const SESSION='__Host-deadhub_session', STATE='__Host-deadhub_login'
// Only locally created failures can carry a stage. Never trust error properties
// or include request values, provider responses or exception text in diagnostics.
const loginFailures=new WeakMap()
export const getSteamLoginFailureCode=error=>loginFailures.get(error)??'DEADHUB_LOGIN_CALLBACK_UNEXPECTED'
export const hashToken=token=>createHash('sha256').update(token).digest('hex')
export function ownerForAccount(account) {
  const h=hashToken('deadhub:steam:'+normalizeAccountId(account))
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
}
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b))
const cookie=(name,token,age)=>`${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`
function readCookie(req,name) {
  const values=(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='))
  return values.length===1 ? values[0].slice(name.length+1) : null
}
async function boundedText(response,limit=8192) {
  const chunks=[];let size=0
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw new RecordError('login_failed',401);chunks.push(chunk)}
  return Buffer.concat(chunks).toString('utf8')
}
export function createSteamAuth({store,origin,allowedAccounts,fetchImpl=fetch,now=()=>Date.now()}) {
  const base=new URL(origin)
  if (base.protocol!=='https:' || base.origin!==origin || !allowedAccounts?.length) throw Error('Steam auth configuration required')
  const accounts=new Set(allowedAccounts.map(normalizeAccountId))
  const callback=origin+'/api/deadhub/auth/callback'
  return {
    origin,
    async start(req,res) {
      const state=randomBytes(32).toString('base64url')
      // Unauthenticated starts allocate no shared DB state. The high-entropy
      // host-only cookie binds the response to this browser; verified state and
      // nonce hashes are consumed atomically only after Steam confirms it.
      res.setHeader('Set-Cookie',cookie(STATE,state,600))
      const url=new URL(ENDPOINT)
      url.search=new URLSearchParams({'openid.ns':NS,'openid.mode':'checkid_setup','openid.realm':origin+'/',
        'openid.return_to':callback+'?state='+state,'openid.identity':NS+'/identifier_select','openid.claimed_id':NS+'/identifier_select'}).toString()
      res.json({url:url.toString()})
    },
    async callback(req,res) {
      let stage='DEADHUB_LOGIN_INPUT'
      try {
      const url=new URL(req.originalUrl,origin), params=url.searchParams, state=params.get('state')
      res.setHeader('Set-Cookie',cookie(STATE,'',0))
      // Reject duplicate parameters and unsolicited / cross-browser callbacks.
      if ([...params.keys()].some(k=>params.getAll(k).length!==1) || !/^[A-Za-z0-9_-]{43}$/.test(state??'')) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_STATE_COOKIE'
      const stateCookie=readCookie(req,STATE)
      if (!stateCookie) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_STATE_MATCH'
      if (!equal(state,stateCookie)) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_ASSERTION'
      const fields=['op_endpoint','claimed_id','identity','return_to','response_nonce','assoc_handle']
      const signed=(params.get('openid.signed')??'').split(',')
      const claimed=params.get('openid.claimed_id'), expectedReturn=callback+'?state='+state
      if (params.get('openid.ns')!==NS || params.get('openid.mode')!=='id_res' || params.get('openid.op_endpoint')!==ENDPOINT ||
        params.get('openid.identity')!==claimed ||
        !fields.every(k=>signed.includes(k) && params.has('openid.'+k)) || !params.get('openid.sig') ||
        !new RegExp('^'+ID_PREFIX.replaceAll('.','\\.')+'[0-9]{17}$').test(claimed??'')) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_RETURN_TO'
      if (params.get('openid.return_to')!==expectedReturn) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_NONCE'
      const nonce=params.get('openid.response_nonce')
      const nonceTime=Date.parse(nonce.slice(0,20))
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.{1,200}$/.test(nonce) || !Number.isFinite(nonceTime) || Math.abs(now()-nonceTime)>600000) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_ALLOWLIST'
      const steamId=claimed.slice(ID_PREFIX.length), account=normalizeAccountId(steamId)
      // Pin Steam's own claimed-id namespace and endpoint; never discover/fetch
      // an arbitrary user URL. Steam confirms the entire signed assertion.
      if (!accounts.has(account) || accountIdToSteamId(account)!==steamId) throw new RecordError('not_allowed',403)
      const body=new URLSearchParams([...params].filter(([k])=>k.startsWith('openid.')))
      body.set('openid.mode','check_authentication')
      let response,text
      stage='DEADHUB_LOGIN_STEAM_REQUEST'
      try {
        response=await fetchImpl(ENDPOINT,{method:'POST',body,redirect:'error',signal:AbortSignal.timeout(8000)})
        stage='DEADHUB_LOGIN_STEAM_RESPONSE'
        text=await boundedText(response)
      }
      catch {throw new RecordError('login_failed',401)}
      const lines=text.split('\n').filter(Boolean), values=new Map(lines.map(line=>[line.slice(0,line.indexOf(':')),line.slice(line.indexOf(':')+1)]))
      if (!response.ok || values.size!==lines.length || values.get('is_valid')!=='true' || values.get('ns')!==NS) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_SESSION_PREPARE'
      const token=randomBytes(32).toString('base64url'), owner=ownerForAccount(account)
      const previous=readCookie(req,SESSION)
      const previousHash=/^[A-Za-z0-9_-]{43}$/.test(previous??'')?hashToken(previous):null
      stage='DEADHUB_LOGIN_SESSION_STORE'
      const opened=await store.openSession(hashToken(token),owner,account,hashToken(nonce),hashToken(state),previousHash)
      stage='DEADHUB_LOGIN_SESSION_REJECTED'
      if (!opened) throw new RecordError('login_failed',401)
      stage='DEADHUB_LOGIN_SESSION_COOKIE'
      res.setHeader('Set-Cookie',[cookie(STATE,'',0),cookie(SESSION,token,7*86400)])
      res.redirect(303,origin+'/deadhub')
      } catch(error) {
        const denied=error instanceof RecordError && error.code==='not_allowed'
        const failure=new RecordError(denied?'not_allowed':'login_failed',denied?403:401)
        loginFailures.set(failure,stage)
        throw failure
      }
    },
    async identify(req) {
      const token=readCookie(req,SESSION)
      if (!/^[A-Za-z0-9_-]{43}$/.test(token??'')) throw new RecordError('unauthorized',401)
      const session=await store.resolveSession(hashToken(token))
      if (!session || !accounts.has(String(session.steam_account_id)) || session.owner_id!==ownerForAccount(String(session.steam_account_id))) throw new RecordError('unauthorized',401)
      return {owner:session.owner_id,accountId:String(session.steam_account_id),steamId:accountIdToSteamId(String(session.steam_account_id))}
    },
    async logout(req,res) {
      const token=readCookie(req,SESSION)
      if (token) await store.closeSession(hashToken(token))
      res.setHeader('Set-Cookie',cookie(SESSION,'',0));res.json({status:'signed_out'})
    },
  }
}
