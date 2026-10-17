import {normalizeAccountId,accountIdToSteamId} from '../../shared/diagnosis.mjs'

// Server-only private trial: owner plus one invite. Never return this list.
export function invitedAccounts(ownerAccount,raw) {
  const accounts=new Set([normalizeAccountId(ownerAccount)])
  if(raw===undefined)return [...accounts]
  if(typeof raw!=='string'||raw.length>71)throw Error('Invalid invitation configuration')
  const entries=raw.split(',')
  if(entries.length>4)throw Error('Invalid invitation configuration')
  for(const steamId of entries){
    if(!/^[0-9]{17}$/.test(steamId))throw Error('Invalid invitation configuration')
    const account=normalizeAccountId(steamId)
    if(accountIdToSteamId(account)!==steamId)throw Error('Invalid invitation configuration')
    accounts.add(account)
  }
  if(accounts.size>2)throw Error('Invitation limit exceeded')
  return [...accounts]
}
