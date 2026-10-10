import {validateAccountId} from '../../../shared/diagnosis.mjs'

// Parse Steam input locally; retain only the validated ID, never the pasted URL.
export function parseProfileInput(value){
 if(typeof value!=='string')return {accountId:null,error:'invalid'}
 const input=value.trim()
 if(!input)return {accountId:null,error:'empty'}
 if(validateAccountId(input))return {accountId:input,error:null}
 // Check raw syntax before URL parsing can normalize slashes, dot segments or ports.
 if(/[\s\\]/u.test(input)||!/^https:\/\/steamcommunity\.com\//i.test(input))return {accountId:null,error:'invalid'}
 let url
 try{url=new URL(input)}catch{return {accountId:null,error:'invalid'}}
 if(url.protocol!=='https:'||url.host!=='steamcommunity.com'||url.username||url.password)return {accountId:null,error:'invalid'}
 if(/^https:\/\/steamcommunity\.com\/id\/[^/?#]+\/?(?:[?#].*)?$/i.test(input))return {accountId:null,error:'vanity'}
 const match=/^https:\/\/steamcommunity\.com\/profiles\/([0-9]{17})\/?(?:[?#].*)?$/i.exec(input)
 if(!match||!validateAccountId(match[1]))return {accountId:null,error:'invalid'}
 return {accountId:match[1],error:null}
}
