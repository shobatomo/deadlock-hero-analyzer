import {tokyoDay} from './deadhub.mjs'

export const statisticFields=['kills','deaths','assists','hero_damage','player_healing','duration_s']
const count=value=>{
  if(typeof value!=='string'||! /^(0|[1-9]\d{0,39})$/.test(value))throw Error('Invalid statistics count')
  return value
}
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid statistics timestamp')
  return new Date(value).toISOString()
}
// Keep integer aggregates as decimal strings: PostgreSQL SUM(bigint) can exceed
// JavaScript's exact integer range. Both server and browser validate this shape.
export function recordStatistics(value){
  if(value?.scope!=='saved_all_time'||value.time_zone!=='Asia/Tokyo')throw Error('Invalid statistics scope')
  const matches=count(value.match_count),total=BigInt(matches)
  const outcomes=Object.fromEntries(['wins','losses','unknown'].map(key=>[key,count(value.outcomes?.[key])]))
  if(Object.values(outcomes).reduce((sum,n)=>sum+BigInt(n),0n)!==total)throw Error('Invalid statistics outcomes')
  const first=total?timestamp(value.first_started_at):null,last=total?timestamp(value.last_started_at):null
  if((!total&&(value.first_started_at!==null||value.last_started_at!==null))||(total&&first>last))throw Error('Invalid statistics range')
  const metrics=Object.fromEntries(statisticFields.map(key=>{
    const metric=value.metrics?.[key],known=count(metric?.known)
    if(BigInt(known)>total)throw Error('Invalid statistics coverage')
    const sum=known==='0'?null:count(metric?.sum)
    if(known==='0'&&metric?.sum!==null)throw Error('Invalid missing statistics value')
    return [key,{sum,known}]
  }))
  return {scope:'saved_all_time',time_zone:'Asia/Tokyo',observed_at:timestamp(value.observed_at),match_count:matches,first_started_at:first,last_started_at:last,outcomes,metrics}
}
export const statisticNumber=value=>BigInt(value).toLocaleString('ja-JP')
export function statisticRatio(numerator,denominator){
  if(denominator==='0')return null
  const n=BigInt(numerator),d=BigInt(denominator),tenths=(n*10n+d/2n)/d
  return statisticNumber(tenths/10n)+'.'+tenths%10n
}
export function statisticDuration(value){
  const seconds=BigInt(value)
  return `${statisticNumber(seconds/3600n)}時間${seconds%3600n/60n}分${seconds%60n}秒`
}
export const statisticDay=value=>tokyoDay(value).replaceAll('-','/')+' JST'
