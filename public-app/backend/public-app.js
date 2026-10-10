import express from 'express'
import {createPublicCollector} from './public-collection.js'
import {validateAccountId,validateDiagnosis} from '../shared/diagnosis.mjs'
// No request-body logging, personal files, account response fields or raw metadata.
export function createPublicApp({collector=createPublicCollector(),timeoutMs=60000}={}){
 const app=express();app.disable('x-powered-by')
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
 app.use(express.json({limit:'1kb',strict:true}))
 app.get('/api/health',(req,res)=>res.json({status:'OK',runtime:'node',storage:'request-only'}))
 app.get('/api/candidates',async(req,res)=>{try{res.json(await collector.catalog())}catch{res.status(503).json({error:'比較基準を確認できませんでした。'})}})
 app.post('/api/diagnosis',async(req,res)=>{
  if(!req.body||Array.isArray(req.body)||Object.keys(req.body).some(k=>!['account_id','collect','refresh'].includes(k))||!validateAccountId(req.body.account_id)||['collect','refresh'].some(k=>req.body[k]!=null&&typeof req.body[k]!=='boolean'))return res.status(400).json({error:'有効な数値IDと取得条件を入力してください。'})
  const controller=new AbortController();let timedOut=false
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},timeoutMs),close=()=>{if(!res.writableEnded)controller.abort()}
  res.on('close',close)
  try{
   const result=await Promise.race([collector.collect(req.body.account_id,{signal:controller.signal,refresh:true}),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))])
   if(!validateDiagnosis(result))throw new Error('invalid')
   // Explicit response allowlist; injected collectors cannot leak identities/history.
   const response=Object.fromEntries(['status','recommendations','reasons','experimental','input_state','future_inputs','five_axis','candidate_coverage','collection'].filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]]))
   if(!res.destroyed)res.json(response)
  }catch(e){
   const errors={busy:[409,'この入力の取得が進行中です。少し待ってください。'],cooldown:[429,'続けて取得する場合は30秒ほど待ってください。'],capacity:[429,'取得が混み合っています。少し待ってください。'],rate_limited:[429,'外部APIの取得制限です。時間をおいて再試行してください。'],unavailable:[422,'公開データを取得できません。非公開や未登録の可能性があります。'],reference_unavailable:[503,'比較基準を利用できません。'],timeout:[504,'外部APIが時間内に応答しませんでした。']}
   const [status,error]=timedOut?[504,'取得が時間内に完了しませんでした。']:errors[e.code]??[502,'データを取得・分析できませんでした。時間をおいて再試行してください。']
   if(!res.destroyed){if(status===429)res.set('Retry-After','30');res.status(status).json({error})}
  }finally{clearTimeout(timer);res.off('close',close)}
 })
 app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.type==='entity.too.large'?413:400).json({error:'入力JSONを確認してください。'})})
 return app
}
export default createPublicApp()
