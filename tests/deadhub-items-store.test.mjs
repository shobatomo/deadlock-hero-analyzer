// Offline SQL-contract mock; no database server or credentials.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createSteamAuth,ownerForAccount} from '../public-app/backend/deadhub/auth.js'
const owners=[ownerForAccount('1'),ownerForAccount('2')]
const stamp='2026-10-16T00:00:00.000Z'
const inventory=[{id:1,name:'装備A',image:null}]
const row=items=>({match_id:'99',started_at:stamp,hero_id:15,won:true,kills:4,deaths:0,assists:2,hero_damage:6000,duration_s:600,final_items:items})
function mockStore(){
 let saved=new Map(),connections=0;const calls=[]
 const pool={async connect(){
  connections++;let owner,working
  return {release(){},async query(sql,values=[]){
   calls.push({sql,values})
   if(sql==='BEGIN'){working=new Map([...saved].map(([k,v])=>[k,structuredClone(v)]));return {rows:[]}}
   if(sql==='COMMIT'){saved=working;return {rows:[]}}
   if(sql==='ROLLBACK')return {rows:[]}
   if(sql.startsWith('SELECT set_config')){owner=values[0];return {rows:[]}}
   assert.equal(values[0],owner,'Every operation binds the transaction owner')
   if(sql.startsWith('SELECT * FROM deadhub_private.accounts'))return {rows:[{owner_id:owner,steam_account_id:String(owners.indexOf(owner)+1),lease_token:owner,lease_until:new Date(Date.now()+60000),cursor_match_id:null,sync_status:'success'}]}
   if(sql.startsWith('INSERT INTO deadhub_private.matches')){
    assert.match(sql,/ON CONFLICT\(owner_id,match_id\)/)
    assert.match(sql,/final_items=coalesce\(excluded.final_items,stored.final_items\)/)
    const cols=sql.match(/AS stored\(([^)]+)\)/)[1].split(',')
    assert.equal(values.length%cols.length,0)
    for(let offset=0;offset<values.length;offset+=cols.length){
     const item=Object.fromEntries(cols.map((col,i)=>[col,values[offset+i]]))
     assert.equal(item.owner_id,owner)
     assert.ok(item.final_items===null||typeof item.final_items==='string','JSON must be encoded, not a pg array')
     item.final_items=item.final_items===null?null:JSON.parse(item.final_items)
     const key=owner+':'+item.match_id,previous=working.get(key)
     working.set(key,previous?Object.fromEntries(Object.keys(item).map(k=>[k,item[k]??previous[k]])):item)
    }
    return {rows:[]}
   }
   if(sql.startsWith('UPDATE deadhub_private.accounts'))return {rows:[]}
   const rows=[...working.values()].filter(r=>r.owner_id===owner)
   if(sql.startsWith('SELECT count(*)'))return {rows:[{count:rows.length,first:rows[0]?.started_at??null,last:rows.at(-1)?.started_at??null}]}
   if(sql.startsWith('SELECT match_id')){
    assert.match(sql,/duration_s,final_items,fetched_at/)
    assert.match(sql,/WHERE owner_id=\$1 AND started_at >= \$2 AND started_at < \$3/)
    return {rows:rows.filter(r=>r.started_at>=values[1]&&r.started_at<values[2]).map(({owner_id,...r})=>({...r,fetched_at:stamp,updated_at:stamp}))}
   }
   throw Error('Unexpected SQL contract')
  }}
 }}
 return {store:createRecordStore(pool),calls,get size(){return saved.size},get connections(){return connections}}
}
const save=(store,owner,items)=>store.savePage(owner,{token:owner,cursor:null},{records:[row(items)],done:true})
test('same owner/match upserts once, late missing/error inventory preserves saved items and statistics',async()=>{
 const f=mockStore(),owner=owners[0]
 await save(f.store,owner,inventory)
 for(const missing of [undefined,null,[{id:-1}]])await save(f.store,owner,missing)
 const value=await f.store.snapshot(owner,'2026-10')
 assert.equal(f.size,1);assert.equal(value.observed.count,1)
 assert.deepEqual(value.matches[0].final_items,inventory);assert.equal(value.matches[0].kills,4)
 assert.equal(value.matches[0].owner_id,undefined)
 assert.ok(f.calls.some(q=>q.sql.includes('INSERT')&&q.values.at(-1)===JSON.stringify(inventory)))
})
test('explicit empty inventory can replace known items, later unknown cannot erase that empty observation',async()=>{
 const f=mockStore(),owner=owners[0]
 await save(f.store,owner,inventory);await save(f.store,owner,[]);await save(f.store,owner,null)
 assert.deepEqual((await f.store.snapshot(owner,'2026-10')).matches[0].final_items,[])
})
test('new unknown inventory stays null and a later successful resync fills it',async()=>{
 const f=mockStore(),owner=owners[0]
 await save(f.store,owner,null);assert.equal((await f.store.snapshot(owner,'2026-10')).matches[0].final_items,null)
 await save(f.store,owner,inventory);assert.deepEqual((await f.store.snapshot(owner,'2026-10')).matches[0].final_items,inventory)
})
test('same match ID under different owners remains separated and every SQL transaction sets owner context',async()=>{
 const f=mockStore(),other=[{id:2,name:'別の所持品',image:null}]
 await save(f.store,owners[0],inventory);await save(f.store,owners[1],other);await save(f.store,owners[0],null)
 assert.equal(f.size,2)
 assert.deepEqual((await f.store.snapshot(owners[0],'2026-10')).matches[0].final_items,inventory)
 assert.deepEqual((await f.store.snapshot(owners[1],'2026-10')).matches[0].final_items,other)
 assert.equal(f.calls.filter(q=>q.sql.startsWith('SELECT set_config')).length,5)
 const before=f.connections;await assert.rejects(f.store.snapshot('not-owner','2026-10'),e=>e.code==='unauthorized');assert.equal(f.connections,before)
})
function route(app,url,cookie=''){
 return new Promise((resolve,reject)=>{
  const req=new IncomingMessage(new Socket()),res=new ServerResponse(req)
  req.method='GET';req.url=url;req.headers={cookie};req.push(null)
  const timer=setTimeout(()=>reject(Error('Router timeout')),1000)
  res.end=function(chunk){clearTimeout(timer);resolve({status:this.statusCode,headers:this.getHeaders(),body:JSON.parse(Buffer.from(chunk??'{}').toString())});return this}
  app.handle(req,res,e=>{clearTimeout(timer);reject(e??Error('Unhandled route'))})
 })
}
test('existing real auth boundary protects item records and ignores client-supplied owner/account IDs',async()=>{
 let reads=0,session=null
 const auth=createSteamAuth({store:{resolveSession:async()=>session},origin:'https://dummy.example.test',allowedAccounts:['1']})
 const app=createDeadhubApp({auth,sync:async()=>{},store:{snapshot:async(owner,month)=>{
  reads++;assert.equal(owner,owners[0]);assert.equal(month,'2026-10');return {matches:[row(inventory)]}
 }}})
 const url='/api/deadhub/records?month=2026-10&owner='+owners[1]+'&account_id=2'
 assert.equal((await route(app,url)).status,401);assert.equal(reads,0)
 session={steam_account_id:'1',owner_id:owners[0]}
 const response=await route(app,url,'__Host-deadhub_session='+'a'.repeat(43))
 assert.equal(response.status,200);assert.equal(reads,1);assert.equal(response.headers['cache-control'],'private, no-store')
 assert.deepEqual(response.body.matches[0].final_items,inventory)
})
