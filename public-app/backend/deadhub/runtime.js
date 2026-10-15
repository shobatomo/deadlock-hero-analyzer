import {createRecordPool,createRecordStore} from './store.js'
import {createRecordProvider} from './provider.js'
import {createRecordSync} from './sync.js'
import {createSteamAuth,ownerForAccount} from './auth.js'
import {normalizeAccountId} from '../../shared/diagnosis.mjs'
export function createRecordRuntime({env=process.env}={}) {
  // Preview is deliberately disconnected. No fallback to any FYTH credential.
  if(env.DEADHUB_ENABLED!=='true' || env.VERCEL_ENV!=='production')return {}
  try {
    if(!/^[0-9]{17}$/.test(env.DEADHUB_OWNER_STEAM_ID??''))return {}
    const account=normalizeAccountId(env.DEADHUB_OWNER_STEAM_ID)
    const store=createRecordStore(createRecordPool({connectionString:env.DEADHUB_DB_URL,ca:env.DEADHUB_DB_CA_CERT}))
    const auth=createSteamAuth({store,origin:env.DEADHUB_PUBLIC_ORIGIN,allowedAccounts:[account]})
    return {store,auth,sync:createRecordSync({store,provider:createRecordProvider()}),cronOwner:ownerForAccount(account)}
  } catch {return {}}
}
