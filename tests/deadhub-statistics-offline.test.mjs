import {test} from 'node:test'
import assert from 'node:assert/strict'
import {IncomingMessage,ServerResponse} from 'node:http'
import {Socket} from 'node:net'
import {createDeadhubApp} from '../public-app/backend/deadhub/app.js'
import {createRecordStore} from '../public-app/backend/deadhub/store.js'
import {createSteamAuth,ownerForAccount,hashToken} from '../public-app/backend/deadhub/auth.js'
import {recordStatistics,statisticRatio,statisticNumber,statisticDuration,statisticDay} from '../public-app/shared/record-statistics.mjs'
import {statisticsFixture} from './fixtures/deadhub-statistics.mjs'

test('empty, missing and observed zero stay distinct; averages use known values and JST dates',()=>{
 for(const mode of ['empty','missing','zero','mixed']){
  const data=recordStatistics(statisticsFixture(mode))
  assert.equal(data.metrics.kills.sum,mode==='mixed'?'6':mode==='zero'?'0':null)
  assert.equal(data.match_count,mode==='empty'?'0':mode==='mixed'?'4':'2')
 }
 assert.equal(statisticRatio('6','3'),'2.0');assert.equal(statisticRatio('3','2'),'1.5')
 assert.equal(statisticRatio('0','2'),'0.0');assert.equal(statisticRatio('0','0'),null)
 assert.equal(statisticRatio('100','2'),'50.0');assert.equal(statisticRatio('100','3'),'33.3')
 assert.equal(statisticDuration('5400'),'1時間30分0秒');assert.equal(statisticDuration('0'),'0時間0分0秒')
 assert.equal(statisticDay('2025-12-31T15:00:00Z'),'2026/01/01 JST')
 assert.equal(statisticDay('2025-12-31T14:59:59Z'),'2025/12/31 JST')
})
test('large integer totals are exact, not rounded through JavaScript Number',()=>{
 const fixture=statisticsFixture();fixture.metrics.hero_damage.sum='9007199254740993'
 const data=recordStatistics(fixture)
 assert.equal(statisticNumber(data.metrics.hero_damage.sum),'9,007,199,254,740,993')
 assert.equal(statisticRatio(data.metrics.hero_damage.sum,'3'),'3,002,399,751,580,331.0')
})
test('malformed totals, coverage, outcomes and ranges fail closed rather than displaying zero',()=>{
 for(const mutate of [x=>x.scope='current_month',x=>x.match_count=4,x=>x.outcomes.unknown='3',x=>x.metrics.kills.known='5',
  x=>x.metrics.kills.sum=null,x=>x.metrics.kills.sum='NaN',x=>x.metrics.kills.sum='-1',
  x=>x.metrics.kills={sum:'0',known:'0'},x=>x.last_started_at=x.first_started_at.replace('2025','2024')]){
  const value=statisticsFixture();mutate(value);assert.throws(()=>recordStatistics(value))
 }
})
function route(app,url,headers={}){
 return new Promise((resolve,reject)=>{
  const req=new IncomingMessage(new Socket()),res=new ServerResponse(req)
  req.method='GET';req.url=url;req.headers=headers
  const timer=setTimeout(()=>reject(Error('Fixture route timeout')),1500)
  res.end=function(chunk){clearTimeout(timer);resolve({status:this.statusCode,headers:this.getHeaders(),body:JSON.parse(Buffer.from(chunk??'{}').toString())});return this}
  app.handle(req,res,e=>{clearTimeout(timer);reject(e??Error('Unhandled route'))});req.push(null)
 })
}
test('statistics reuse verified sessions, ignore forged IDs, and never fetch or synchronize',async()=>{
 const tokens=['a'.repeat(43),'b'.repeat(43)],sessions=new Map(tokens.map((token,i)=>[hashToken(token),{owner_id:ownerForAccount(String(i+1)),steam_account_id:String(i+1)}])),reads=[]
 const store={resolveSession:async hash=>sessions.get(hash)??null,statistics:async owner=>{reads.push(owner);return statisticsFixture(owner===ownerForAccount('1')?'mixed':'zero')}}
 const auth=createSteamAuth({store,origin:'https://records.example.test',allowedAccounts:['1','2'],fetchImpl:()=>{throw Error('External API forbidden')}})
 const app=createDeadhubApp({store,auth,sync:()=>{throw Error('Sync forbidden')}})
 for(let i=0;i<2;i++){
  const target=ownerForAccount(String(2-i)),result=await route(app,'/api/deadhub/statistics?owner_id='+target+'&user_id='+target+'&account_id='+(2-i)+'&month=2020-01&hero_id=999',
   {cookie:'__Host-deadhub_session='+tokens[i],'x-owner-id':target,origin:'https://other.example.test'})
  assert.equal(result.status,200);assert.equal(result.body.match_count,i?'2':'4')
  assert.equal(result.headers['cache-control'],'private, no-store');assert.equal(result.headers['access-control-allow-origin'],undefined)
  assert.ok(!JSON.stringify(result.body).includes(target));assert.equal(result.body.matches,undefined)
 }
 assert.deepEqual(reads,[ownerForAccount('1'),ownerForAccount('2')])
 for(const headers of [{},{cookie:'__Host-deadhub_session='+'c'.repeat(43)},{cookie:'__Host-deadhub_session=invalid'}])assert.equal((await route(app,'/api/deadhub/statistics?owner_id='+ownerForAccount('1'),headers)).status,401)
 assert.equal(reads.length,2)
 sessions.delete(hashToken(tokens[0]));assert.equal((await route(app,'/api/deadhub/statistics',{cookie:'__Host-deadhub_session='+tokens[0]})).status,401)
 assert.equal(reads.length,2)
})
test('aggregate query failure returns a generic private error without changing records',async()=>{
 let snapshots=0
 const app=createDeadhubApp({store:{statistics:async()=>{throw Error('PRIVATE_DATABASE_DETAILS')},snapshot:async()=>{snapshots++;return {matches:[]}}},
  auth:{origin:'https://records.example.test',identify:async()=>({owner:ownerForAccount('1'),steamId:'synthetic'})},sync:()=>{throw Error('Sync forbidden')}})
 const failed=await route(app,'/api/deadhub/statistics');assert.equal(failed.status,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE_DATABASE/)
 assert.equal(failed.headers['cache-control'],'private, no-store');assert.equal((await route(app,'/api/deadhub/records?month=2026-01')).status,200);assert.equal(snapshots,1)
})
test('aggregate store rejects invalid owner before connecting and rolls back failed reads',async()=>{
 let connects=0;const commands=[]
 const store=createRecordStore({connect:async()=>{connects++;return {query:async(sql)=>{commands.push(sql);if(sql.includes('FROM deadhub_private.matches'))throw Error('query failed');return {rows:[]}},release:()=>commands.push('RELEASE')}}})
 await assert.rejects(store.statistics('untrusted'),e=>e.code==='unauthorized');assert.equal(connects,0)
 await assert.rejects(store.statistics(ownerForAccount('1')),/query failed/)
 assert.equal(commands[0],'BEGIN');assert.match(commands[1],/set_config/);assert.deepEqual(commands.slice(-2),['ROLLBACK','RELEASE'])
})
