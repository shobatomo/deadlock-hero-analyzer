import express from 'express'
import {createHash,timingSafeEqual} from 'node:crypto'
import {tokyoDay,monthBounds} from '../../shared/deadhub.mjs'
import {RecordError} from './provider.js'
import {getSteamLoginFailureCode} from './auth.js'
const MESSAGES={unauthorized:'Steamでログインしてください。',not_allowed:'このSteamアカウントは利用許可されていません。',
  login_failed:'Steamログインを確認できませんでした。最初からお試しください。',
  busy:'記録を取得中です。しばらくお待ちください。',cooldown:'連続取得を防ぐため、少しお待ちください。',
  already_registered:'このSteamアカウントは登録済みです。',not_registered:'先に記録対象として登録してください。',
  rate_limited:'提供元の取得制限に達しました。時間をおいてお試しください。',provider_timeout:'提供元の応答が時間内に返りませんでした。保存済みの記録は残っています。'}
const digest=s=>createHash('sha256').update(s).digest()
export function createDeadhubApp({store=null,sync=null,auth=null,cronSecret=null,cronOwner=null,loginFailureLogger=code=>console.warn(code)}={}) {
  const app=express();app.disable('x-powered-by')
  app.use((req,res,next)=>{res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});next()})
  app.use(express.json({limit:'1kb',strict:true}))
  const enabled=!!(store&&sync&&auth)
  app.get('/api/deadhub/config',(req,res)=>res.json({enabled,auth:'steam',time_zone:'Asia/Tokyo'}))
  app.use((req,res,next)=>enabled?next():res.status(503).json({error:'記録機能の接続準備中です。',code:'disabled'}))
  // Cron has a separate server-only credential and cannot use browser sessions.
  app.get('/api/deadhub/cron',async(req,res)=>{
    const bearer=req.get('authorization')??''
    if (!cronSecret || cronSecret.length<32 || !cronOwner || !timingSafeEqual(digest(bearer),digest('Bearer '+cronSecret))) throw new RecordError('unauthorized',401)
    try {res.json(await sync(cronOwner))} catch(error) {
      if(['not_registered','busy','cooldown'].includes(error.code))return res.json({status:'skipped',reason:error.code})
      throw error
    }
  })
  // Fixed origin, not Host/X-Forwarded-Host. All browser writes require same-origin JSON.
  app.use((req,res,next)=>{
    if(req.method==='POST' && (req.get('origin')!==auth.origin || req.get('sec-fetch-site')==='cross-site' || !req.is('application/json'))) return res.status(403).json({error:'操作元を確認できませんでした。',code:'forbidden'})
    next()
  })
  app.post('/api/deadhub/auth/login',(req,res)=>auth.start(req,res))
  app.get('/api/deadhub/auth/callback',async(req,res)=>{
    try {await auth.callback(req,res)}catch(error){
      // One fixed stage code only. No error object, URL, cookies or account IDs.
      try {loginFailureLogger(getSteamLoginFailureCode(error))}catch{/* Diagnostics must not affect the safe redirect. */}
      res.redirect(303,auth.origin+'/deadhub?login=failed')
    }
  })
  app.use(async(req,res,next)=>{req.identity=await auth.identify(req);next()})
  app.post('/api/deadhub/auth/logout',(req,res)=>auth.logout(req,res))
  app.get('/api/deadhub/records',async(req,res)=>{
    const month=req.query.month??tokyoDay(Date.now()).slice(0,7)
    try{monthBounds(month)}catch{throw new RecordError('invalid_month',400)}
    res.json({identity:{steam_id:req.identity.steamId},...await store.snapshot(req.identity.owner,month)})
  })
  app.post('/api/deadhub/register',async(req,res)=>{
    if(!req.body || Array.isArray(req.body) || Object.keys(req.body).length)throw new RecordError('invalid_input',400)
    // Registration target comes exclusively from verified Steam identity.
    await store.register(req.identity.owner,req.identity.accountId)
    res.json(await sync(req.identity.owner))
  })
  app.post('/api/deadhub/sync',async(req,res)=>{
    if(!req.body || Array.isArray(req.body) || Object.keys(req.body).length)throw new RecordError('invalid_input',400)
    res.json(await sync(req.identity.owner))
  })
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error)
    const code=error instanceof RecordError?error.code:'request_failed'
    const status=error instanceof RecordError?error.status:error.type==='entity.too.large'?413:error.type==='entity.parse.failed'?400:503
    if(['cooldown','busy','rate_limited'].includes(code))res.set('Retry-After',String(error.retryAfter??60))
    res.status(status).json({code,error:MESSAGES[code]??'記録の取得に失敗しました。保存済みの記録は残っています。'})
  })
  return app
}
