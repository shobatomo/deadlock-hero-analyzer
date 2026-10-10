// Local routing harness, not a Vercel emulator. Never logs request bodies or URLs.
import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,relative,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import handler from '../api/public.js'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
export async function createPreviewServer({api=handler,directory=root}={}){
 const config=JSON.parse(await readFile(resolve(directory,'vercel.json'),'utf8')),dist=resolve(directory,config.outputDirectory)
 return http.createServer(async(req,res)=>{
  try{
   const path=new URL(req.url,'http://127.0.0.1').pathname,rule=config.rewrites.find(r=>r.source===path)
   if(rule?.destination==='/api/public')return api(req,res)
   if(path.startsWith('/api/')){res.writeHead(404);res.end('Not found');return}
   const destination=rule?.destination??(path==='/'?'/index.html':path),file=resolve(dist,'.'+decodeURIComponent(destination))
   if(relative(dist,file).startsWith('..')||relative(dist,file).includes(':')){res.writeHead(404);res.end('Not found');return}
   const bytes=await readFile(file),mime=file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream'
   res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store'});res.end(bytes)
  }catch{res.writeHead(404);res.end('Not found')}
 })
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=await createPreviewServer();server.listen(3031,'127.0.0.1',()=>console.log('FYTH local artifact: http://127.0.0.1:3031'))}
