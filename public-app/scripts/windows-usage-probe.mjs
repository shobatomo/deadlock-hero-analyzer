import {readFile} from 'node:fs/promises'
import {Writable} from 'node:stream'
import {createInterface} from 'node:readline'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {checkUsageConnection} from './check-usage-connection.mjs'

export function promptHidden({input=process.stdin,output=process.stdout}={}) {
 if (!input.isTTY || !output.isTTY) return Promise.reject(new Error('Interactive terminal required'))
 return new Promise((resolve,reject)=>{
  let settled=false
  const muted=new Writable({write(chunk,encoding,callback){callback()}})
  const rl=createInterface({input,output:muted,terminal:true,historySize:0})
  function finish(error,value){
   if(settled)return
   settled=true;rl.close();output.write('\n')
   if(error)reject(error);else resolve(value)
  }
  rl.on('SIGINT',()=>finish(new Error('Cancelled')))
  rl.on('close',()=>{if(!settled)finish(new Error('Closed'))})
  output.write('Dedicated connection URI (hidden; paste then Enter): ')
  rl.question('',value=>finish(null,value))
 })
}
export async function runWindowsProbe({caPath,readPublicCa=path=>readFile(path,'utf8'),askForUri=promptHidden,probe=checkUsageConnection}={}) {
 let env
 try {
  if(typeof caPath!=='string'||!caPath)throw new Error('Public CA path required')
  const ca=await readPublicCa(caPath)
  if(!ca.includes('-----BEGIN CERTIFICATE-----')||!ca.includes('-----END CERTIFICATE-----')||ca.includes('PRIVATE KEY'))throw new Error('Public CA required')
  const uri=(await askForUri()).trim()
  if(!uri)throw new Error('Empty URI')
  // Passed directly in memory: never reads/sets process.env or writes credentials.
  env={FYTH_USAGE_ENABLED:'false',FYTH_USAGE_DB_URL:uri,FYTH_USAGE_DB_CA_CERT:ca}
  const result=await probe({env})
  if(result?.status==='passed'&&result.metadata_only===true&&result.writes===0&&result.usage_collection_enabled===false)
   return {status:'passed',metadata_only:true,writes:0,usage_collection_enabled:false,cron_verified:false,backup_verified:false}
  return {status:'failed',code:'usage_connection_check_failed'}
 } catch {
  return {status:'failed',code:'windows_probe_setup_failed'}
 } finally {
  if(env){env.FYTH_USAGE_DB_URL='';env.FYTH_USAGE_DB_CA_CERT=''}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2)
 const result=args.length===2&&args[0]==='--ca'
  ? await runWindowsProbe({caPath:args[1]}) : {status:'failed',code:'public_ca_path_required'}
 console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1
}
