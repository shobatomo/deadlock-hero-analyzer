import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
import {buildHeroTrend} from '../public-app/shared/record-trends.mjs'
import {trendHistory,trendHistoryQuery} from '../public-app/shared/trend-history.mjs'
import {historyFixture,historyRows} from './fixtures/deadhub-trend-history.mjs'

test('every stored match is reachable by bounded pages; cross-month/year five-match windows equal the full series',()=>{
 const rows=historyRows(),expected=buildHeroTrend(rows,{month:null,heroId:'15',metric:'kills'}).points
 const collected=[]
 for(let page=1;page<=3;page++){
  const data=trendHistory(historyFixture({rows,page}));assert.ok(data.matches.length<=204)
  const points=buildHeroTrend(data.matches,{month:null,heroId:'15',metric:'kills'}).points.slice(data.context_count)
  collected.push(...points)
 }
 assert.deepEqual(collected.map(({row,value,average})=>[row.match_id,value,average]),expected.map(({row,value,average})=>[row.match_id,value,average]))
 assert.equal(collected.length,405);assert.equal(collected[0].value,0);assert.equal(collected[4].average,2.8)
 assert.equal(collected[200].average,null);assert.equal(collected[202].average,201)
 const monthly=buildHeroTrend(rows,{month:'2026-01',heroId:'15',metric:'kills'})
 assert.equal(monthly.points[0].average,null)
})
test('empty, missing, zero and absent selected hero remain distinct; malformed or truncated responses fail',()=>{
 assert.equal(trendHistory(historyFixture({rows:[],heroId:null})).match_count,0)
 assert.equal(trendHistory(historyFixture({heroId:'4'})).selected_count,0)
 for(const mutate of [x=>x.matches.pop(),x=>x.matches.push(x.matches[0]),x=>x.match_count++,x=>x.context_count=0,
  x=>x.matches.reverse(),x=>x.matches[0].hero_id=4,x=>x.matches[0].kills=-1,x=>x.maxima.kills=Infinity,x=>x.first_started_at='bad',x=>x.page=0]){
  const data=historyFixture({page:2});mutate(data);assert.throws(()=>trendHistory(data))
 }
})
test('query only accepts bounded integer pages and real integer hero IDs',()=>{
 assert.deepEqual(trendHistoryQuery(),{heroId:null,page:1})
 assert.deepEqual(trendHistoryQuery({hero_id:'2147483647',page:'2'}),{heroId:'2147483647',page:2})
 for(const query of [{page:'0'},{page:'-1'},{page:'1.1'},{page:'1e3'},{page:['1']},{page:'99999999999999999999'},{hero_id:'0'},{hero_id:['15']},{hero_id:'2147483648'},{hero_id:'15 OR TRUE'}])assert.throws(()=>trendHistoryQuery(query))
})
function route(app,url,headers={}){return new Promise((resolve,reject)=>{
 const req=new IncomingMessage(new Socket()),res=new ServerResponse(req);req.method='GET';req.url=url;req.headers=headers
 res.end=function(chunk){resolve({status:this.statusCode,headers:this.getHeaders(),body:JSON.parse(Buffer.from(chunk??'{}').toString())});return this}
 app.handle(req,res,e=>reject(e??Error('Unhandled route')));req.push(null)
})}
test('verified sessions own the read; forged targets/month/limit cannot alter owner or trigger game APIs',async()=>{
 const tokens=['a'.repeat(43),'b'.repeat(43)],reads=[],sessions=new Map(tokens.map((token,i)=>[hashToken(token),{owner_id:ownerForAccount(String(i+1)),steam_account_id:String(i+1)}]))
 const store={resolveSession:async hash=>sessions.get(hash)??null,trendHistory:async(owner,query)=>{reads.push({owner,query});return historyFixture()}}
 const auth=createSteamAuth({store,origin:'https://records.example.test',allowedAccounts:['1','2'],fetchImpl:()=>{throw Error('External API forbidden')}})
 const app=createDeadhubApp({store,auth,sync:()=>{throw Error('Sync forbidden')}})
 for(let i=0;i<2;i++){
  const target=ownerForAccount(String(2-i)),r=await route(app,`/api/deadhub/trend-history?hero_id=15&page=1&owner_id=${target}&user_id=${target}&month=2026-01&limit=999999`,{cookie:'__Host-deadhub_session='+tokens[i],'x-owner-id':target})
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'private, no-store');assert.equal(r.headers['access-control-allow-origin'],undefined)
  assert.deepEqual(reads[i],{owner:ownerForAccount(String(i+1)),query:{hero_id:'15',page:'1'}})
  assert.ok(!JSON.stringify(r.body).includes(target))
 }
 for(const cookie of [undefined,'invalid','c'.repeat(43)])assert.equal((await route(app,'/api/deadhub/trend-history',{...(cookie?{cookie:'__Host-deadhub_session='+cookie}:{})})).status,401)
 assert.equal(reads.length,2)
})
test('read-only snapshot rolls back failures, rejects invalid owners/query before DB use, and errors leave calendar route usable',async()=>{
 let connects=0;const commands=[]
 const store=createRecordStore({connect:async()=>{connects++;return {query:async sql=>{commands.push(sql);if(sql.includes('FROM deadhub_private.matches'))throw Error('PRIVATE_DETAIL');return {rows:[]}},release:()=>commands.push('RELEASE')}}})
 await assert.rejects(store.trendHistory('invalid'),e=>e.code==='unauthorized')
 await assert.rejects(store.trendHistory(ownerForAccount('1'),{page:'0'}),e=>e.status===400);assert.equal(connects,0)
 await assert.rejects(store.trendHistory(ownerForAccount('1')),/PRIVATE_DETAIL/)
 assert.equal(commands[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.deepEqual(commands.slice(-2),['ROLLBACK','RELEASE'])
 const app=createDeadhubApp({store:{trendHistory:async()=>{throw Error('PRIVATE_DETAIL')},snapshot:async()=>({matches:[]})},auth:{identify:async()=>({owner:ownerForAccount('1')})},sync:()=>{throw Error('Sync forbidden')}})
 const failure=await route(app,'/api/deadhub/trend-history');assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(failure),/PRIVATE_DETAIL/)
 assert.equal((await route(app,'/api/deadhub/records?month=2026-01')).status,200)
})
