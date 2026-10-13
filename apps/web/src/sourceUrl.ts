import type { CatalogChoice } from './songVersions'

export type InitialSource =
  | { kind: 'catalog'; songId: string; difficulty: string | null; offsetMs: number }
  | { kind: 'url'; url: string; title: string | null; offsetMs: number }

const CHART_KEYS = ['chart', 'llll', 'llllChart', 'json', 'customScoreJson', 'scoreJson']
const CONFIG_KEYS = ['config', 'cfg']

function configPayload(params: URLSearchParams): Record<string, unknown> | null {
  const key = CONFIG_KEYS.find(name => params.has(name))
  if (!key) return null
  const raw = params.get(key)!
  const candidates = [raw]
  try { candidates.push(decodeURIComponent(raw)) } catch { /* 保留原字符串继续验证。 */ }
  try {
    const encoded = raw.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
    const decoded = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)))
    candidates.push(decoded)
    try { candidates.push(decodeURIComponent(decoded)) } catch { /* 已有未转义候选。 */ }
  } catch { /* 非 base64 配置仍可直接解析 JSON。 */ }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch { /* 尝试下一种编码。 */ }
  }
  throw new Error('config 参数不是有效配置')
}

function first(values: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = values[key]
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim()
  }
  return null
}

export function readInitialSource(url: URL): InitialSource {
  const params = url.searchParams
  const config = params.has('song') ? null : configPayload(params)
  const query = Object.fromEntries(params)
  const offset = first(config ?? {}, ['o', 'offset']) ?? params.get('offset')
  const offsetMs = offset === null || offset.trim() === '' ? 0 : Number(offset)
  if (!Number.isFinite(offsetMs)) throw new Error('offset 必须是有限数值')
  if (params.has('song')) {
    const songId = params.get('song')!.trim()
    if (!songId) throw new Error('song 参数不能为空')
    return { kind: 'catalog', songId, difficulty: params.get('difficulty'), offsetMs }
  }
  const chart = first(config ?? {}, [...CHART_KEYS, 'j']) ?? first(query, CHART_KEYS)
  if (chart) {
    const info = config?.info ?? config?.i
    const scoreInfo = info && typeof info === 'object' ? info as Record<string, unknown> : {}
    const title = first(config ?? {}, ['t', 'title', 'songTitle', 'musicTitle'])
      ?? first(query, ['title', 'songTitle', 'musicTitle'])
      ?? first(scoreInfo, ['title', 'scoreTitle', 'name'])
      ?? first(config ?? {}, ['st', 'scoreTitle', 'chartTitle'])
      ?? first(query, ['scoreTitle', 'chartTitle'])
    return { kind: 'url', url: chart, title, offsetMs }
  }
  if (config || CHART_KEYS.some(key => params.has(key))) throw new Error('谱面 URL 不能为空')
  return { kind: 'catalog', songId: '103103', difficulty: params.get('difficulty'), offsetMs }
}

export function withCatalogChoice(url: URL, choice: CatalogChoice): URL {
  const next = new URL(url)
  for (const key of [...CHART_KEYS, ...CONFIG_KEYS]) next.searchParams.delete(key)
  next.searchParams.set('song', choice.songId)
  if (choice.difficulty) next.searchParams.set('difficulty', choice.difficulty)
  else next.searchParams.delete('difficulty')
  return next
}
