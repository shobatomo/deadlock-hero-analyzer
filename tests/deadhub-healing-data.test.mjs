// Synthetic bulk responses only; 2462 is inspired by an existing saved sample.
// That sample contains normalized snapshots, NOT a verified bulk final_stats response.
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {projectRecord,createRecordProvider} from '../public-app/backend/deadhub/provider.js'
import {daySummary} from '../public-app/shared/deadhub.mjs'
const range={accountId:'1',from:'2026-10-01T00:00:00Z',until:'2026-11-01T00:00:00Z',cursor:null}
const raw=final_stats=>({match_id:99,start_time:'2026-10-05 12:31:21',duration_s:2375,winning_team:'Team0',match_outcome:'TeamWin',
  players:[{account_id:1,hero_id:15,team:'Team0',kills:4,deaths:2,assists:3,final_stats}]})
const project=row=>projectRecord(row,range.accountId,range.from,range.until)

test('healing is exactly the owned player final_stats value, without adding other healing fields',()=>{
  const row=raw({player_healing:2462,self_healing:2000,teammate_healing:462})
  row.players.unshift({account_id:2,final_stats:{player_healing:900000}})
  assert.equal(project(row).player_healing,2462)
})

test('missing final healing never falls back to other healing fields, history maxima or history sums',()=>{
  for(const finalStats of [undefined,null,{}, {self_healing:2462,teammate_healing:2462}]){
    const row=raw(finalStats)
    row.players[0].stats=[{player_healing:1000},{player_healing:2462}]
    row.players[0].player_healing=2462
    assert.equal(project(row).player_healing,null)
  }
  const row=raw({player_healing:0});row.players[0].stats=[{player_healing:2462}]
  assert.equal(project(row).player_healing,0)
})

test('valid numeric strings and zero survive; invalid and missing healing stay null',()=>{
  for(const [value,expected] of [[0,0],['0',0],['2462',2462],[4294967295,4294967295],
    [null,null],[undefined,null],[-1,null],[1.5,null],['',null],['1.5',null],['NaN',null],
    [false,null],[Infinity,null],[Number.MAX_SAFE_INTEGER+1,null]]){
    assert.equal(project(raw({player_healing:value})).player_healing,expected)
  }
})

test('existing bulk request includes healing with no extra API or item requests',async()=>{
  let requests=0
  const provider=createRecordProvider({fetchImpl:async url=>{
    requests++;assert.equal(url.origin+url.pathname,'https://api.deadlock-api.com/v1/matches/metadata')
    assert.equal(url.searchParams.get('include_player_final_stats'),'true')
    assert.equal(url.searchParams.get('only_filtered_players'),'true')
    assert.equal(url.searchParams.has('match_ids'),false)
    return Response.json([raw({player_healing:2462})])
  },itemCatalog:()=>{throw Error('Unexpected item request')}})
  const result=await provider.page(range)
  assert.equal(result.records[0].player_healing,2462);assert.equal(result.done,true);assert.equal(requests,1)
})

test('daily healing distinguishes all missing, observed zero, complete and partial totals',()=>{
  for(const [values,expected] of [
    [[],{value:null,known:0,total:0}],[[null,undefined],{value:null,known:0,total:2}],
    [[0],{value:0,known:1,total:1}],[[2462,0],{value:2462,known:2,total:2}],
    [[2462,null,0],{value:2462,known:2,total:3}],[[0,null],{value:0,known:1,total:2}],
  ])assert.deepEqual(daySummary(values.map(player_healing=>({player_healing}))).player_healing,expected)
})
