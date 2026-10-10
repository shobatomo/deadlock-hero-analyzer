import {manifest} from './heroes.mjs'
const MAX_COMPARISON_ROWS=manifest.heroes.length*4
const OFFSET = 76561197960265728n
const MAX_ACCOUNT = 2147483647n

export function normalizeAccountId(input) {
    if (typeof input !== 'string' || !/^[0-9]{1,17}$/.test(input)) throw new Error('Invalid ID')
    const number = BigInt(input)
    let account = number
    if (input.length === 17) {
        if ((number >> 56n) !== 1n || ((number >> 52n) & 15n) !== 1n
            || ((number >> 32n) & 1048575n) !== 1n) throw new Error('Not a public individual SteamID')
        account = number & 4294967295n
    }
    if (account <= 0n || account > MAX_ACCOUNT) throw new Error('Outside API account range')
    return account.toString()
}

export function accountIdToSteamId(input) {
    return (OFFSET + BigInt(normalizeAccountId(input))).toString()
}

export function validateAccountId(input) {
    try { normalizeAccountId(input); return true } catch { return false }
}

export function validateDirectComparison(value) {
    const keys=['player_mean','population_median','top_mean','player_relative','top_relative']
    return value?.experimental === true && typeof value.top_definition === 'string'
        && typeof value.weighting === 'string' && typeof value.uncertainty === 'string'
        && (value.comparison_assumption == null || typeof value.comparison_assumption === 'string')
        && (value.descriptive_differences == null || (Array.isArray(value.descriptive_differences) && value.descriptive_differences.length <= MAX_COMPARISON_ROWS && value.descriptive_differences.every(row =>
            typeof row.hero_id === 'string' && /^[0-9]+$/.test(row.hero_id) && typeof row.feature === 'string' && typeof row.label === 'string'
            && ['player_relative','top_relative','difference'].every(key => Number.isFinite(row[key])))))
        && Array.isArray(value.rows) && value.rows.length <= MAX_COMPARISON_ROWS && value.rows.every(row =>
            typeof row.hero_id === 'string' && /^[0-9]+$/.test(row.hero_id)
            && typeof row.feature === 'string' && typeof row.label === 'string'
            && keys.every(key => row[key] === null || Number.isFinite(row[key])))
}

export function validateRoleDiagnosis(value) {
    const finite = x => typeof x === 'number' && Number.isFinite(x)
    return value && ['ready','withheld'].includes(value.status)
        && typeof value.formula_version === 'string' && finite(value.coverage) && value.coverage >= 0 && value.coverage <= 1
        && Array.isArray(value.reasons) && value.reasons.every(r => typeof r === 'string')
        && Array.isArray(value.axes) && value.axes.length <= 20 && value.axes.every(a => typeof a.id === 'string' && typeof a.label === 'string' && typeof a.measured === 'boolean' && (a.measured ? finite(a.player_relative) : a.player_relative === null))
        && Array.isArray(value.recommendations) && value.recommendations.length <= 3
        && (value.status === 'withheld' ? value.recommendations.length === 0 && value.reasons.length > 0 : value.recommendations.length > 0)
        && value.recommendations.every(r => typeof r.hero_id === 'string' && /^[0-9]+$/.test(r.hero_id) && finite(r.distance) && r.distance >= 0 && typeof r.reason === 'string' && Array.isArray(r.axis_gaps) && r.axis_gaps.every(g => typeof g.axis === 'string' && typeof g.label === 'string' && ['player_relative','top_relative','squared_gap'].every(k => finite(g[k]))))
}

export function validateDiagnosis(value) {
    if (value?.five_axis && !validateRoleDiagnosis(value.five_axis)) return false
    if (value?.direct_comparison && !validateDirectComparison(value.direct_comparison)) return false
    if (!value || !['withheld', 'ready'].includes(value.status)
        || !Array.isArray(value.reasons) || !value.reasons.every(reason => typeof reason === 'string')
        || !Array.isArray(value.recommendations)) return false
    if (value.status === 'withheld') return value.recommendations.length === 0 && value.reasons.length > 0
    return value.recommendations.length > 0 && value.recommendations.every(row =>
        typeof row.hero_id === 'string' && /^[0-9]+$/.test(row.hero_id)
        && Number.isFinite(row.distance) && row.distance >= 0)
}