import pg from 'pg'
import {randomUUID} from 'node:crypto'
import {monthBounds, DAY_MS, RECORD_FIELDS} from '../../shared/deadhub.mjs'
import {RecordError} from './provider.js'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function createRecordPool({connectionString, ca, Pool=pg.Pool}={}) {
  let url; try { url=new URL(connectionString) } catch { throw new Error('Record database configuration required') }
  const project='adxoqjgmhmortztqngcz', login='deadhub_app_login', user=decodeURIComponent(url.username)
  const direct=url.hostname===`db.${project}.supabase.co` && user===login
  const pooled=url.hostname.endsWith('.pooler.supabase.com') && user===`${login}.${project}`
  if (!['postgres:','postgresql:'].includes(url.protocol) || (!direct&&!pooled) || !url.password || url.pathname!=='/postgres') throw new Error('Record database configuration invalid')
  for (const key of [...url.searchParams.keys()]) url.searchParams.delete(key)
  const pool=new Pool({connectionString:url.toString(), ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},
    max:2, connectionTimeoutMillis:3000, idleTimeoutMillis:10000, query_timeout:5000,
    statement_timeout:4000, lock_timeout:1000, application_name:'deadhub-records'})
  pool.on?.('error',()=>{})
  return pool
}
const iso = value => value ? new Date(value).toISOString() : null
function publicAccount(row) {
  if (!row) return null
  const keys=['steam_account_id','sync_status','last_error']
  const dates=['created_at','initial_from','last_attempt_at','last_success_at','retry_after','coverage_from','coverage_until']
  return {...Object.fromEntries(keys.map(k=>[k,row[k]])),...Object.fromEntries(dates.map(k=>[k,iso(row[k])])),
    sync_status:row.sync_status==='running' && new Date(row.lease_until).getTime()<=Date.now()?'interrupted':row.sync_status}
}
export function createRecordStore(pool) {
  async function tx(owner, fn) {
    if (!uuid.test(owner)) throw new RecordError('unauthorized',401)
    const client=await pool.connect();let broken=false
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('deadhub.owner_id',$1,true)",[owner])
      const result=await fn(client)
      await client.query('COMMIT');return result
    } catch(error) { try{await client.query('ROLLBACK')}catch{broken=true} throw error }
    finally {client.release(broken)}
  }
  async function locked(client,owner,token) {
    const {rows}=await client.query('SELECT * FROM deadhub_private.accounts WHERE owner_id=$1 FOR UPDATE',[owner])
    const row=rows[0]
    if (!row || row.lease_token!==token || new Date(row.lease_until).getTime()<=Date.now()) throw new RecordError('lease_lost',409)
    return row
  }
  return {
    async register(owner,accountId) {
      try {return await tx(owner,async client=>{
        await client.query(`INSERT INTO deadhub_private.accounts(owner_id,steam_account_id,initial_from)
          VALUES($1,$2,date_trunc('second',now())-interval '30 days') ON CONFLICT(owner_id) DO NOTHING`,[owner,accountId])
        const {rows}=await client.query('SELECT * FROM deadhub_private.accounts WHERE owner_id=$1',[owner])
        if (String(rows[0].steam_account_id)!==accountId) throw new RecordError('already_registered',409)
        return publicAccount(rows[0])
      })} catch(error) { if(error.code==='23505') throw new RecordError('already_registered',409); throw error }
    },
    async snapshot(owner,month) {
      const {start,end}=monthBounds(month)
      return tx(owner,async client=>{
        const account=(await client.query('SELECT * FROM deadhub_private.accounts WHERE owner_id=$1',[owner])).rows[0]
        const {rows}=await client.query(`SELECT match_id,started_at,hero_id,won,kills,deaths,assists,hero_damage,duration_s,fetched_at,updated_at
          FROM deadhub_private.matches WHERE owner_id=$1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at DESC,match_id DESC`,[owner,start,end])
        const range=(await client.query('SELECT count(*)::int AS count,min(started_at) AS first,max(started_at) AS last FROM deadhub_private.matches WHERE owner_id=$1',[owner])).rows[0]
        return {account:publicAccount(account),month,matches:rows.map(r=>({...r,hero_damage:r.hero_damage===null?null:Number(r.hero_damage),started_at:iso(r.started_at),fetched_at:iso(r.fetched_at),updated_at:iso(r.updated_at)})),
          observed:{count:range.count,first:iso(range.first),last:iso(range.last)},provider:'stored_metadata',requery_days:7}
      })
    },
    async acquire(owner) {
      return tx(owner,async client=>{
        const row=(await client.query('SELECT * FROM deadhub_private.accounts WHERE owner_id=$1 FOR UPDATE',[owner])).rows[0]
        if (!row) throw new RecordError('not_registered',409)
        const now=Date.now()
        if (row.lease_token && new Date(row.lease_until).getTime()>now) throw new RecordError('busy',409)
        if (row.retry_after && new Date(row.retry_after).getTime()>now) throw new RecordError('cooldown',429,Math.ceil((new Date(row.retry_after).getTime()-now)/1000))
        const token=randomUUID(), until=iso(row.window_until)??new Date(Math.floor(now/1000)*1000).toISOString()
        const from=iso(row.window_from)??new Date(Math.max(new Date(row.initial_from).getTime(),row.coverage_until?new Date(row.coverage_until).getTime()-7*DAY_MS:0)).toISOString()
        await client.query(`UPDATE deadhub_private.accounts SET sync_status='running',last_error=null,last_attempt_at=now(),
          retry_after=now()+interval '60 seconds',lease_token=$2,lease_until=now()+interval '90 seconds',window_from=$3,window_until=$4 WHERE owner_id=$1`,[owner,token,from,until])
        return {token,accountId:String(row.steam_account_id),from,until,cursor:row.cursor_match_id}
      })
    },
    async savePage(owner,lease,page) {
      return tx(owner,async client=>{
        const row=await locked(client,owner,lease.token)
        if (String(row.cursor_match_id)!==String(lease.cursor)) throw new RecordError('lease_lost',409)
        if (page.records.length) {
          const cols=['owner_id','match_id','started_at',...RECORD_FIELDS]
          const vals=page.records.flatMap(record=>[owner,record.match_id,record.started_at,...RECORD_FIELDS.map(k=>record[k])])
          const placeholders=page.records.map((_,row)=>'('+cols.map((_,col)=>'$'+(row*cols.length+col+1)).join(',')+')').join(',')
          // A sparse later response cannot erase a previously observed value.
          // One bounded write per page also avoids a network round-trip per match.
          await client.query(`INSERT INTO deadhub_private.matches AS stored(${cols.join(',')}) VALUES ${placeholders}
            ON CONFLICT(owner_id,match_id) DO UPDATE SET started_at=excluded.started_at,
            ${RECORD_FIELDS.map(k=>`${k}=coalesce(excluded.${k},stored.${k})`).join(',')},updated_at=now()`,vals)
        }
        if (page.done) {
          await client.query(`UPDATE deadhub_private.accounts SET sync_status='success',last_success_at=now(),last_error=null,
            coverage_from=coalesce(coverage_from,window_from),coverage_until=window_until,
            window_from=null,window_until=null,cursor_match_id=null,lease_token=null,lease_until=null WHERE owner_id=$1`,[owner])
        } else {
          await client.query(`UPDATE deadhub_private.accounts SET cursor_match_id=$2,lease_until=now()+interval '90 seconds' WHERE owner_id=$1`,[owner,page.cursor])
        }
      })
    },
    async finishPartial(owner,token) {
      return tx(owner,async client=>{await locked(client,owner,token);await client.query("UPDATE deadhub_private.accounts SET sync_status='partial',lease_token=null,lease_until=null WHERE owner_id=$1",[owner])})
    },
    async fail(owner,token,code,retryAfter=60) {
      // Fencing: an expired worker must never overwrite the next worker's state.
      return tx(owner,client=>client.query(`UPDATE deadhub_private.accounts SET sync_status='error',last_error=$3,
        retry_after=now()+($4::int * interval '1 second'),lease_token=null,lease_until=null WHERE owner_id=$1 AND lease_token=$2`,[owner,token,code,Math.min(86400,Math.max(60,retryAfter))]))
    },
    async openSession(hash,owner,accountId,nonceHash,stateHash,previousHash=null) {return (await pool.query('SELECT deadhub_private.open_session($1,$2,$3,$4,$5,$6) AS ok',[hash,owner,accountId,nonceHash,stateHash,previousHash])).rows[0].ok},
    async resolveSession(hash) {return (await pool.query('SELECT * FROM deadhub_private.resolve_session($1)',[hash])).rows[0]??null},
    async closeSession(hash) {await pool.query('SELECT deadhub_private.close_session($1)',[hash])},
    close:()=>pool.end(),
  }
}
