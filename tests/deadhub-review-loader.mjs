// Portable offline review loader: resolve only repository-local dependencies.
// JSX is transformed in memory. No server, Vite config, or disk cache is used.
import {readFile} from 'node:fs/promises'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const app=new URL('../public-app/',import.meta.url),frontend=new URL('frontend/',app)
const frontendRequire=createRequire(new URL('package.json',frontend))
let transformer
export async function resolve(specifier,context,nextResolve){
 if(/^(express|pg|@vercel\/functions)$/.test(specifier))return nextResolve(specifier,{...context,parentURL:new URL('package.json',app).href})
 if(/^(react(?:-dom|-router-dom)?(?:\/|$)|jsdom$|@testing-library\/react$)/.test(specifier))return nextResolve(specifier,{...context,parentURL:new URL('package.json',frontend).href})
 try{return await nextResolve(specifier,context)}catch(error){
  if(specifier.startsWith('.')&&!/\.[a-z]+$/.test(specifier))return nextResolve(specifier+'.jsx',context)
  throw error
 }
}
export async function load(url,context,nextLoad){
 if(url.startsWith(frontend.href)&&url.endsWith('.jsx')){
  transformer??=import(pathToFileURL(frontendRequire.resolve('vite')).href).then(module=>module.transformWithOxc)
  const transform=await transformer,source=await readFile(new URL(url),'utf8')
  return {format:'module',source:(await transform(source,fileURLToPath(url),{jsx:{runtime:'automatic'},sourcemap:false})).code,shortCircuit:true}
 }
 if(url.startsWith(app.href)&&url.endsWith('.css'))return {format:'module',source:'',shortCircuit:true}
 if(url.startsWith(app.href)&&url.endsWith('.json'))return {format:'module',source:'export default '+await readFile(new URL(url),'utf8'),shortCircuit:true}
 return nextLoad(url,context)
}
