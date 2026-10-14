// @vitest-environment jsdom
import {afterEach,describe,expect,it} from 'vitest'
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react'
import FiveAxisSummary from './FiveAxisSummary'
import approved from '../../../shared/hero-guides-approved.json'
import guides from '../../../shared/hero-guides.json'
import {manifest,enabledHeroIds,heroName} from '../../../shared/heroes.mjs'
afterEach(cleanup)
const result=ids=>({status:'ready',recommendations:ids.map(hero_id=>({hero_id,distance:0.1,axis_gaps:[],reason:'fixtureの候補'})),coverage:1,formula_version:'fixture',axes:[],reasons:[],warnings:[]})
it('approved fixture matches exactly all39 normal IDs and displayed names, preserving Graves exclusion',()=>{
 const ids=manifest.heroes.filter(h=>h.normal_eligible).map(h=>h.id)
 expect(Object.keys(approved).sort()).toEqual(ids.sort());expect(ids).toHaveLength(39)
 for(const [id,copy] of Object.entries(approved)){
  expect(copy.name.replace('&amp;','&')).toBe(heroName(id))
  expect(guides.heroes[id].first_step_title).toBe(copy.title)
  expect(guides.heroes[id].first_step).toBe(copy.body)
 }
 expect(enabledHeroIds).not.toContain('76')
 expect(manifest.heroes.find(h=>h.id==='76').reference_enabled).toBe(false)
})
describe('approved full copy renders without omission',()=>{
 for(const [id,copy] of Object.entries(approved))it(`${id} ${copy.name}`,()=>{
  render(<FiveAxisSummary result={result([id])}/>);const button=screen.getByRole('button',{name:'試し方を見る'})
  expect(screen.queryByRole('status')).toBeNull();fireEvent.click(button)
  const tip=screen.getByRole('status');expect(within(tip).getByText(copy.title,{selector:'strong'}).textContent).toBe(copy.title)
  expect(within(tip).getByText(copy.body).textContent).toBe(copy.body)
  expect(button.getAttribute('aria-expanded')).toBe('true');expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(button);expect(screen.queryByRole('status')).toBeNull();expect(button.getAttribute('aria-expanded')).toBe('false')
 })
})
it('cards expand independently and retain existing references and source links',()=>{
 render(<FiveAxisSummary result={result(['3','15','65'])}/>);const buttons=screen.getAllByRole('button',{name:'試し方を見る'})
 fireEvent.click(buttons[0]);fireEvent.click(buttons[2]);expect(screen.getAllByRole('status')).toHaveLength(2)
 fireEvent.click(buttons[0]);expect(screen.getAllByRole('status')).toHaveLength(1)
 expect(screen.getByRole('link',{name:'Valve公式更新記録'}).getAttribute('href')).toBe(guides.official_changelog)
 expect(screen.getByText(guides.heroes['3'].description)).toBeTruthy()
})
it('unknown future hero keeps original safe fallback',()=>{
 render(<FiveAxisSummary result={result(['999'])}/>);fireEvent.click(screen.getByRole('button',{name:'試し方を見る'}))
 expect(screen.getByText('Hero 999でやってみよう')).toBeTruthy()
 expect(screen.getByText('まずは練習で、移動・通常攻撃・アビリティを試してみよう。')).toBeTruthy()
})
