import {createRecordPool,createRecordStore,getRecordPoolFailureCode} from './store.js'
import {createRecordProvider} from './provider.js'
import {createRecordSync} from './sync.js'
import {createSteamAuth,ownerForAccount} from './auth.js'
import {normalizeAccountId} from '../../shared/diagnosis.mjs'
export function createRecordRuntime({env=process.env,initializationLogger=code=>console.warn(code)}={}) {
  // Preview is deliberately disconnected. No fallback to any FYTH credential.
  // Only a fixed local stage code is logged. Never log env values or errors.
  let stage='DEADHUB_INIT_DISABLED'
  const unavailable=()=>{try{initializationLogger(stage)}catch{/* Keep failures closed even if logging fails. */}return {}}
  try {
    if(env.DEADHUB_ENABLED!=='true')return unavailable()
    stage='DEADHUB_INIT_ENVIRONMENT'
    if(env.VERCEL_ENV!=='production')return unavailable()
    stage='DEADHUB_INIT_OWNER_FORMAT'
    if(!/^[0-9]{17}$/.test(env.DEADHUB_OWNER_STEAM_ID??''))return unavailable()
    stage='DEADHUB_INIT_OWNER_ID'
    const account=normalizeAccountId(env.DEADHUB_OWNER_STEAM_ID)
    stage='DEADHUB_INIT_DATABASE'
    const pool=createRecordPool({connectionString:env.DEADHUB_DB_URL,ca:env.DEADHUB_DB_CA_CERT})
    stage='DEADHUB_INIT_DB_STORE'
    const store=createRecordStore(pool)
    stage='DEADHUB_INIT_AUTH'
    const auth=createSteamAuth({store,origin:env.DEADHUB_PUBLIC_ORIGIN,allowedAccounts:[account]})
    stage='DEADHUB_INIT_SERVICES'
    return {store,auth,sync:createRecordSync({store,provider:createRecordProvider()}),cronOwner:ownerForAccount(account)}
  } catch(error) {
    if(stage==='DEADHUB_INIT_DATABASE')stage=getRecordPoolFailureCode(error)??stage
    return unavailable()
  }
}
