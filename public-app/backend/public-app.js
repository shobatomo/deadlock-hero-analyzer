import express from 'express'
import {waitUntil} from '@vercel/functions'
import {beginUsage} from './usage.js'
import {createRuntimeUsage} from './usage-store.js'
import {addFeedbackRoutes} from './feedback.js'
import {createRuntimeFeedback} from './feedback-store.js'
import {createPublicCollector} from './public-collection.js'
import {validateAccountId,validateDiagnosis} from '../shared/diagnosis.mjs'
// No request-body logging, personal files, account response fields or raw metadata.
export function createPublicApp({collector=createPublicCollector(),timeoutMs=60000,feedbackStore=null,feedbackTimeoutMs=5000,feedbackLimits,usageStore=null,usageKeepAlive=waitUntil}={}){
 const app=express();app.disable('x-powered-by')
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
 app.use(express.json({limit:'1kb',strict:true}))
 addFeedbackRoutes(app,{feedbackStore,feedbackTimeoutMs,feedbackLimits})
 app.get('/api/health',(req,res)=>res.json({status:'OK',runtime:'node',storage:'request-only'}))
 app.get('/api/candidates',async(req,res)=>{try{res.json(await collector.catalog())}catch{res.status(503).json({error:"比較に使うデータを確認できませんでした。"})}})
 app.post('/api/diagnosis',async(req,res)=>{
  if(!req.body||Array.isArray(req.body)||Object.keys(req.body).some(k=>!['account_id','collect','refresh'].includes(k))||!validateAccountId(req.body.account_id)||['collect','refresh'].some(k=>req.body[k]!=null&&typeof req.body[k]!=='boolean'))return res.status(400).json({error:"数字のIDと取得条件を確認してください。"})
  const usage=beginUsage(res,{store:usageStore,keepAlive:usageKeepAlive})
  const controller=new AbortController();let timedOut=false
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs),close=()=>{if(!res.writableEnded)controller.abort()}
  res.on('close',close)
  try{
   const result=await Promise.race([collector.collect(req.body.account_id,{signal:controller.signal,refresh:true}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))])
   if(!validateDiagnosis(result))throw new Error('invalid')
   // Explicit response allowlist; injected collectors cannot leak identities/history.
   const response=Object.fromEntries(['status','recommendations','reasons','experimental','input_state','future_inputs','five_axis','candidate_coverage','collection'].filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]]))
   usage.outcome(result.five_axis?.status==='ready'?'diagnosis_ready':'diagnosis_withheld')
   if(!res.destroyed)res.json(response)
  }catch(e){
   usage.outcome('diagnosis_error')
   const errors={busy:[409,"このIDの記録を取得しています。少しお待ちください。"],cooldown:[429,"もう一度取得するには、30秒ほどお待ちください。"],capacity:[429,"混み合っているため、少し待ってからお試しください。"],rate_limited:[429,"外部APIの取得回数の上限に達しました。時間をおいて、もう一度お試しください。"],unavailable:[422,"公開データを取得できませんでした。記録が非公開か、未登録の可能性があります。"],reference_unavailable:[503,"比較に使うデータを利用できません。"],timeout:[504,"外部APIから時間内に応答がありませんでした。"]}
   errors.access_denied=[422,"外部APIへの接続を確認できなかったため、取得を中止しました。"]
   errors.metadata_unavailable=[502,"試合の詳細を取得できませんでした。時間をおいて、もう一度お試しください。"]
   const [status,error]=timedOut?[504,"時間内に取得を完了できませんでした。"]:errors[e.code]??[502,"データの取得・分析に失敗しました。時間をおいて、もう一度お試しください。"]
   if(!res.destroyed){if(status===429)res.set('Retry-After','30');res.status(status).json({error})}
  }finally{clearTimeout(timer);res.off('close',close)}
 })
 app.use((error,req,res,next)=>{
  if(res.headersSent)return next(error)
  const feedbackParserStatus={'entity.parse.failed':400,'entity.too.large':413,'charset.unsupported':415,'encoding.unsupported':415}
  if(req.path==='/api/feedback'&&Object.hasOwn(feedbackParserStatus,error.type))return res.status(feedbackParserStatus[error.type]).json({status:'not_stored',retryable:true})
  res.status(error.type==='entity.too.large'?413:400).json({error:'入力JSONを確認してください。'})
 })
 return app
}
export default createPublicApp({feedbackStore:createRuntimeFeedback(),usageStore:createRuntimeUsage()})
