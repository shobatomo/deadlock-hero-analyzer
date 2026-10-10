import { validateDiagnosis } from '../../../shared/diagnosis.mjs'
export async function requestDiagnosis(accountId, { signal, collect = false, refresh = false } = {}) {
    const response = await fetch('/api/diagnosis', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, ...(collect ? {collect:true,refresh} : {}) }), signal,
    })
    let data
    try { data = await response.json() } catch {
        const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        const publicType = ['application/json', 'text/html', 'text/plain'].includes(type) ? type : '不明'
        const hint = [502, 503, 504].includes(response.status)
            ? 'ローカルAPIサーバーが起動しているか確認してください。' : ''
        throw new Error(`APIから正しいJSONを受け取れませんでした。（HTTP ${response.status} / Content-Type: ${publicType}）${hint}`)
    }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'APIに接続できませんでした。')
    if (!validateDiagnosis(data)) throw new Error('診断結果の形式を確認できませんでした。')
    return data
}
