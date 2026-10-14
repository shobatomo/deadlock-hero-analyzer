// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest'
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import RecommendationFeedback from './RecommendationFeedback'
import {FEEDBACK_CHOICES, FEEDBACK_QUESTION} from '../../../shared/feedback.mjs'
import {sendFeedback} from '../lib/feedback'
import PublicDiagnosis from './PublicDiagnosis'
import {MemoryRouter} from 'react-router-dom'
import {requestDiagnosis} from '../lib/api'
vi.mock('../lib/api',()=>({requestDiagnosis:vi.fn()}))
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.mocked(requestDiagnosis).mockReset()})
const available=async()=>true
async function choose(){await waitFor(()=>expect(screen.getByRole('radio',{name:FEEDBACK_CHOICES[0]}).disabled).toBe(false));fireEvent.click(screen.getByRole('radio',{name:FEEDBACK_CHOICES[0]}))}
describe('optional recommendation feedback',()=>{
 it('disconnected stays disabled and cannot send',async()=>{
  const submit=vi.fn();render(<RecommendationFeedback available={async()=>false} submit={submit}/>)
  expect(screen.getByText(FEEDBACK_QUESTION)).toBeTruthy()
  expect(screen.getAllByRole('radio').map(r=>r.value)).toEqual(FEEDBACK_CHOICES)
  expect(screen.getByRole('button').disabled).toBe(true)
  fireEvent.submit(screen.getByRole('button').closest('form'));expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('status').textContent).toContain('送信されません')
 })
 it('requires selection, suppresses concurrent submit and locks after confirmed storage',async()=>{
  let resolve;const submit=vi.fn(()=>new Promise(r=>{resolve=r}))
  render(<RecommendationFeedback available={available} submit={submit}/>);await choose()
  const form=screen.getByRole('button').closest('form')
  fireEvent.submit(form);fireEvent.submit(form)
  expect(submit).toHaveBeenCalledExactlyOnceWith(FEEDBACK_CHOICES[0]);expect(screen.getByRole('status').textContent).toContain('送信しています')
  resolve({status:'stored'});await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('集計に保存しました'))
  fireEvent.submit(form);expect(submit).toHaveBeenCalledTimes(1);expect(screen.getByRole('button').disabled).toBe(true)
 })
 it('allows explicit retry after confirmed noncommit',async()=>{
  const submit=vi.fn().mockResolvedValueOnce({status:'not_stored',retryable:true}).mockResolvedValueOnce({status:'stored'})
  render(<RecommendationFeedback available={available} submit={submit}/>);await choose();fireEvent.click(screen.getByRole('button'))
  await waitFor(()=>expect(screen.getByRole('button').textContent).toBe('もう一度送信する'))
  expect(screen.getByRole('status').textContent).toContain('保存されませんでした')
  fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(submit).toHaveBeenCalledTimes(2))
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('集計に保存しました'))
 })
 it.each([undefined,{status:'unknown',retryable:false}])('locks uncertain result without false success: %s',async(result)=>{
  render(<RecommendationFeedback available={available} submit={async()=>result}/>);await choose();fireEvent.click(screen.getByRole('button'))
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('保存できたか確認できません'))
  expect(screen.getByRole('button').disabled).toBe(true)
 })
 it('does not claim success for thrown network errors',async()=>{
  render(<RecommendationFeedback available={available} submit={async()=>{throw new Error('network')}}/>);await choose();fireEvent.click(screen.getByRole('button'))
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('保存できたか確認できません'))
 })
 it('transmits only choice with no cookies or referrer; rejects unconfirmed HTTP responses',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:'stored'})}).mockResolvedValueOnce({ok:true,json:async()=>({enabled:true})}).mockRejectedValueOnce(new Error('network'))
  vi.stubGlobal('fetch',fetch)
  expect(await sendFeedback(FEEDBACK_CHOICES[0])).toEqual({status:'stored'})
  const [url,options]=fetch.mock.calls[0]
  expect(url).toBe('/api/feedback');expect(JSON.parse(options.body)).toEqual({choice:FEEDBACK_CHOICES[0]})
  expect(options.credentials).toBe('omit');expect(options.referrerPolicy).toBe('no-referrer')
  expect(await sendFeedback(FEEDBACK_CHOICES[0])).toEqual({status:'unknown',retryable:false})
  expect(await sendFeedback(FEEDBACK_CHOICES[0])).toEqual({status:'unknown',retryable:false})
 })
})

describe('diagnosis remains independent of optional feedback',()=>{
 function diagnosis(account='1'){render(<MemoryRouter><PublicDiagnosis account={account}/></MemoryRouter>)}
 it('missing input and idle state do not request feedback or obstruct diagnosis',()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);diagnosis(null)
  expect(screen.getByText('もう一度IDを入力してください')).toBeTruthy()
  expect(screen.queryByRole('region',{name:'任意のフィードバック'})).toBeNull()
  expect(requestDiagnosis).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled()
 })
 it('acquisition failure retains retry and never exposes feedback',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.mocked(requestDiagnosis).mockRejectedValue(new Error('取得失敗モック'))
  diagnosis();fireEvent.click(screen.getByRole('button',{name:/プレイ記録を取得しておすすめを見る/}))
  await screen.findByText('取得失敗モック')
  expect(screen.getByRole('button',{name:/もう一度取得する/}).disabled).toBe(false)
  expect(screen.queryByRole('region',{name:'任意のフィードバック'})).toBeNull();expect(fetch).not.toHaveBeenCalled()
 })
 it('cancellation still aborts acquisition and allows diagnosis retry',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  vi.mocked(requestDiagnosis).mockImplementation((account,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})))
  diagnosis();fireEvent.click(screen.getByRole('button',{name:/プレイ記録を取得しておすすめを見る/}))
  fireEvent.click(screen.getByRole('button',{name:'中止する'}));await screen.findByText('取得を中止しました。もう一度取得できます。')
  expect(requestDiagnosis.mock.calls[0][1].signal.aborted).toBe(true)
  expect(screen.getByRole('button',{name:/もう一度取得する/}).disabled).toBe(false)
  expect(screen.queryByRole('region',{name:'任意のフィードバック'})).toBeNull();expect(fetch).not.toHaveBeenCalled()
 })
 it('insufficient records keep explanation and skip optional feedback entirely',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
  vi.mocked(requestDiagnosis).mockResolvedValue({five_axis:{status:'insufficient',recommendations:[],axes:[],reasons:[],coverage:0}})
  diagnosis();fireEvent.click(screen.getByRole('button',{name:/プレイ記録を取得しておすすめを見る/}))
  await screen.findByText('今回は候補を出せませんでした')
  expect(screen.queryByRole('region',{name:'任意のフィードバック'})).toBeNull();expect(fetch).not.toHaveBeenCalled()
 })
})

it('discloses conditional anonymous counts without claiming collection is currently enabled',()=>{
 render(<MemoryRouter><PublicDiagnosis account="1"/></MemoryRouter>)
 expect(screen.getByText('匿名の利用計測について')).toBeTruthy()
 expect(screen.getByText(/無効時にはこの集計を行いません/)).toBeTruthy()
 expect(screen.getByText(/実人数や個人ごとの離脱率は測りません/)).toBeTruthy()
})
