import {itemId} from '../../../../shared/final-items.mjs'

const unresolved = /\{[^{}]*\}|%[a-zA-Z_][\w:]*%|#[a-zA-Z_][\w:]*/
const list = value => Array.isArray(value) ? value : []
const titles = {innate:'基本効果', passive:'パッシブ', active:'アクティブ'}

// Parse in an inert document; only text is ever returned to React.
export function plainItemText(value) {
  if (typeof value !== 'string' || value.length > 32000) return ''
  const doc = new DOMParser().parseFromString(value, 'text/html')
  doc.querySelectorAll('script,style,svg,math,iframe,object,embed,template,noscript').forEach(node => node.remove())
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  doc.querySelectorAll('p,div,li').forEach(node => node.append('\n'))
  return (doc.body.textContent ?? '').replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function clean(value) {
  const text = plainItemText(value)
  return unresolved.test(text) ? '' : text
}

function propertyRow(property, uncertainContext) {
  if (!property || typeof property !== 'object') return null
  const label = clean(property.label) || clean(property.postvalue_label)
  let value = typeof property.value === 'number' && Number.isFinite(property.value)
    ? String(property.value) : clean(property.value)
  if (!label || !value || value.length > 120) return null
  const prefix = property.prefix === '{s:sign}' ? (parseFloat(value) > 0 ? '+' : '') : clean(property.prefix)
  const postfix = clean(property.postfix)
  if ((property.prefix && !prefix && property.prefix !== '{s:sign}') || (property.postfix && !postfix)) return null
  if (prefix && !value.startsWith(prefix) && !/^[+−-]/.test(value)) value = prefix + value
  // Values can already contain a distance unit while postfix completes the speed
  // unit (Frenzy: 4m + " m／秒"). Preserve the more specific unit without doubling m.
  const unit = value.match(/(%|m(?:[／/](?:s|秒))?|s|秒)$/)?.[0]
  const normalizeUnit = text => text.replace(/\s/g, '').replaceAll('／', '/').replaceAll('秒', 's')
  const suffix = normalizeUnit(postfix), existing = normalizeUnit(unit ?? '')
  if (postfix && unit && existing === 'm' && suffix === 'm/s') value = value.slice(0, -unit.length) + postfix
  else if (postfix && !unit && !value.endsWith(postfix)) value += postfix
  const conditional = clean(property.conditional)
  const unknownCondition = uncertainContext || (property.conditional && !conditional)
  const condition = conditional || (unknownCondition ? '条件の詳細は未取得' :
    list(property.usage_flags).includes('ConditionallyApplied') ? '条件付き' : '')
  return {label, value, condition}
}

export function projectItemDetails(raw) {
  const sections = [], seenText = new Set()
  let incomplete = false
  const properties = raw?.properties ?? {}
  for (const section of list(raw?.tooltip_sections).slice(0, 20)) {
    const blocks = [], seenKeys = new Set()
    for (const attr of list(section?.section_attributes).slice(0, 30)) {
      const text = clean(attr?.loc_string)
      const uncertain = Boolean(attr?.loc_string && !text)
      if (uncertain) incomplete = true
      const rows = []
      // Only tooltip references are shown. Never enumerate the property dictionary.
      for (const group of ['properties','important_properties','elevated_properties','important_properties_with_icon']) {
        for (const reference of list(attr?.[group]).slice(0, 40)) {
          const key = typeof reference === 'string' ? reference : group === 'important_properties_with_icon' ? reference?.name : null
          if (typeof key !== 'string' || seenKeys.has(key)) continue
          seenKeys.add(key)
          const property = Object.hasOwn(properties, key) ? properties[key] : null
          const row = propertyRow(property && {...property, label:property.label || reference?.localized_name}, uncertain)
          if (row) rows.push(row)
          else incomplete = true
        }
      }
      if (text) seenText.add(text)
      if (text || rows.length) blocks.push({text, rows})
    }
    if (blocks.length) sections.push({title:titles[section.section_type] ?? '効果', blocks})
  }
  const description = raw?.description
  for (const key of ['desc','desc2','passive','active']) {
    const source = typeof description === 'string' ? (key === 'desc' ? description : '') : description?.[key]
    const text = clean(source)
    if (source && !text) incomplete = true
    if (text && !seenText.has(text)) {
      seenText.add(text)
      sections.push({title:titles[key] ?? '説明', blocks:[{text, rows:[]}]})
    }
  }
  return {sections, incomplete}
}

export function createItemDetailsLoader({fetchImpl = (...args) => fetch(...args), now = Date.now} = {}) {
  const cache = new Map()
  return async function load(id, {signal} = {}) {
    if (itemId(id) === null) throw Error('invalid_item')
    signal?.throwIfAborted()
    const saved = cache.get(id)
    if (saved && saved.expires > now()) {
      if (!saved.value) throw Error('details_unavailable')
      return saved.value
    }
    try {
      const response = await fetchImpl(`https://api.deadlock-api.com/v1/assets/items/${id}?language=japanese`, {
        signal, credentials:'omit', referrerPolicy:'no-referrer', redirect:'error',
      })
      signal?.throwIfAborted()
      if (!response.ok) throw Error('details_unavailable')
      const reader = response.body.getReader(), chunks = []
      let size = 0
      try {
        while (true) {
          const {done, value} = await reader.read()
          signal?.throwIfAborted()
          if (done) break
          size += value.byteLength
          if (size > 512 * 1024) throw Error('details_too_large')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const raw = JSON.parse(new TextDecoder().decode(bytes))
      if (raw?.id !== id || raw?.type !== 'upgrade') throw Error('invalid_details')
      const value = projectItemDetails(raw)
      signal?.throwIfAborted()
      cache.set(id, {value, expires:now() + 6 * 3600000})
      if (cache.size > 100) cache.delete(cache.keys().next().value)
      return value
    } catch (error) {
      if (!signal?.aborted) {
        cache.set(id, {value:null, expires:now() + 60000})
        if (cache.size > 100) cache.delete(cache.keys().next().value)
      }
      throw error
    }
  }
}

export const loadItemDetails = createItemDetailsLoader()
