import manifest from './heroes.json' with {type:'json'}
export {manifest}
export const eligibleHeroes=manifest.heroes.filter(hero=>hero.normal_eligible)
export const enabledHeroIds=eligibleHeroes.filter(hero=>hero.reference_enabled).map(hero=>hero.id)
export const regressionHeroIds=manifest.regression_ids
export const heroName=id=>manifest.heroes.find(hero=>hero.id===String(id))?.name ?? `Hero ${id}`
export const candidateVersion=enabledHeroIds.join(',')
