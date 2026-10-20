/**
 * 全局设置「缓存」页的数据层。
 *
 * 站点的离线能力由 Service Worker 提供：Workbox 预缓存应用外壳与两种模式的代码，
 * 渲染资源（贴图 / 字体 / 短音效）按使用情况写入单独的运行时缓存。这里读取和清理
 * Cache Storage，并保存「离线缓存」与「歌曲资源缓存」两个开关；运行时缓存策略在
 * `src/sw.ts` 里。
 *
 * 歌曲资源（音频 / MV / 谱面 / 曲绘）体积大，默认不缓存；用户主动打开后按类型
 * 分别写入四个缓存，Service Worker 以对应缓存是否存在作为该类型的开关状态。
 */

export const OFFLINE_CACHE_STORAGE_KEY = 'sukushow:offline-cache:v1'
export const SONG_CACHE_STORAGE_KEY = 'sukushow:song-asset-cache:v1'

/** 渲染资源的运行时缓存名；与 `src/sw.ts` 保持一致。 */
export const RENDERER_CACHE_NAME = 'sukushow-renderer-assets-v1'

/** 歌曲资源的细分类型；每类一个缓存，方便分别统计与清理。 */
export type SongAssetKind = 'audio' | 'mv' | 'chart' | 'jacket'

export const SONG_CACHES: Readonly<Record<SongAssetKind, string>> = {
  audio: 'sukushow-song-audio-v1',
  mv: 'sukushow-song-mv-v1',
  chart: 'sukushow-song-chart-v1',
  jacket: 'sukushow-song-jacket-v1',
}

export const SONG_CACHE_NAMES: readonly string[] = Object.values(SONG_CACHES)

/** 歌曲资源 URL 前缀 → 缓存名；与 `src/sw.ts` 的路由保持一致。 */
export function songCacheNameOf(pathname: string): string | null {
  if (pathname.startsWith('/assets/audio/')) return SONG_CACHES.audio
  if (pathname.startsWith('/assets/mv/')) return SONG_CACHES.mv
  if (pathname.startsWith('/assets/chart/')) return SONG_CACHES.chart
  if (pathname.startsWith('/assets/jacket/')) return SONG_CACHES.jacket
  return null
}

export type CacheGroupId = 'precache' | 'renderer' | SongAssetKind | 'other'

/** 统计页里的分区：基础缓存、歌曲资源（可再细分）、其他。 */
export type CacheGroupSection = 'base' | 'song' | 'other'

export type CacheGroup = {
  id: CacheGroupId
  section: CacheGroupSection
  /** 统计行里的完整名称。 */
  label: string
  /** 状态消息里的短名称。 */
  short: string
}

export const CACHE_GROUPS: readonly CacheGroup[] = [
  { id: 'precache', section: 'base', label: '应用界面与代码', short: '应用界面缓存' },
  { id: 'renderer', section: 'base', label: '渲染资源（贴图 / 字体 / 音效）', short: '渲染资源缓存' },
  { id: 'audio', section: 'song', label: '音频', short: '歌曲音频缓存' },
  { id: 'mv', section: 'song', label: 'MV', short: '歌曲 MV 缓存' },
  { id: 'chart', section: 'song', label: '谱面', short: '歌曲谱面缓存' },
  { id: 'jacket', section: 'song', label: '曲绘', short: '歌曲曲绘缓存' },
  { id: 'other', section: 'other', label: '其他缓存', short: '其他缓存' },
]

/** 歌曲资源的分组 id，清理后需要按开关状态补回空缓存。 */
export const SONG_GROUP_IDS: readonly CacheGroupId[] = CACHE_GROUPS
  .filter((group) => group.section === 'song')
  .map((group) => group.id)

export type CacheGroupUsage = { id: CacheGroupId; label: string; entries: number; bytes: number }
export type CacheUsage = { groups: CacheGroupUsage[]; totalEntries: number; totalBytes: number }
export type StorageEstimateResult = { usageBytes?: number; quotaBytes?: number }

/** 只声明用到的方法，测试里可以换成内存实现。 */
export type CacheLike = {
  keys(): Promise<readonly Request[]>
  match(request: Request): Promise<Response | undefined>
}

export type CacheStorageLike = {
  keys(): Promise<readonly string[]>
  open(name: string): Promise<CacheLike>
  delete(name: string): Promise<boolean>
}

export type StorageEstimator = {
  storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> }
}

/** Workbox 预缓存名带版本与站点前缀（如 `workbox-precache-v2-https://…/`）。 */
export function cacheGroupOf(name: string): CacheGroupId {
  if (name.includes('precache')) return 'precache'
  if (name === RENDERER_CACHE_NAME || name.startsWith('sukushow-renderer-assets')) return 'renderer'
  for (const [kind, cacheName] of Object.entries(SONG_CACHES) as [SongAssetKind, string][]) {
    if (name === cacheName || name.startsWith(cacheName.replace(/-v\d+$/, ''))) return kind
  }
  return 'other'
}

/** 缓存里的响应没有统一的体积字段：优先读头部，缺失时退回解码后的 blob。 */
async function responseBytes(response: Response): Promise<number> {
  const header = response.headers.get('content-length')
  if (header !== null) {
    const length = Number(header)
    if (Number.isFinite(length) && length >= 0) return length
  }
  if (response.type === 'opaque' || response.type === 'opaqueredirect') return 0
  try {
    return (await response.clone().blob()).size
  } catch {
    return 0
  }
}

function summarize(groups: Map<CacheGroupId, CacheGroupUsage>): CacheUsage {
  const ordered = CACHE_GROUPS.map(({ id, label }) => {
    const usage = groups.get(id)!
    return { id, label, entries: usage.entries, bytes: usage.bytes }
  })
  return {
    groups: ordered,
    totalEntries: ordered.reduce((sum, group) => sum + group.entries, 0),
    totalBytes: ordered.reduce((sum, group) => sum + group.bytes, 0),
  }
}

/**
 * 统计每个缓存分组的条目数与体积。
 *
 * 打不开或读不出的条目按 0 计，不影响其余分组；清理操作仍按缓存名整体删除。
 */
export async function measureCacheUsage(storage: CacheStorageLike): Promise<CacheUsage> {
  const groups = new Map<CacheGroupId, CacheGroupUsage>(
    CACHE_GROUPS.map(({ id, label }) => [id, { id, label, entries: 0, bytes: 0 }]),
  )
  let names: readonly string[]
  try {
    names = await storage.keys()
  } catch {
    return summarize(groups)
  }
  await Promise.all(names.map(async (name) => {
    const group = groups.get(cacheGroupOf(name))
    if (!group) return
    try {
      const cache = await storage.open(name)
      const requests = await cache.keys()
      group.entries += requests.length
      const sizes = await Promise.all(requests.map(async (request) => {
        try {
          const response = await cache.match(request)
          return response ? await responseBytes(response) : 0
        } catch {
          return 0
        }
      }))
      group.bytes += sizes.reduce((sum, size) => sum + size, 0)
    } catch {
      // 单个缓存损坏时跳过，不阻断整页统计。
    }
  }))
  return summarize(groups)
}

/** 按分组清理缓存，返回实际删除的缓存数量（一个分组可能对应多个缓存名）。 */
export async function clearCaches(
  storage: CacheStorageLike,
  groups: readonly CacheGroupId[] = CACHE_GROUPS.map((group) => group.id),
): Promise<number> {
  const wanted = new Set(groups)
  let names: readonly string[]
  try {
    names = await storage.keys()
  } catch {
    return 0
  }
  const results = await Promise.all(names
    .filter((name) => wanted.has(cacheGroupOf(name)))
    .map(async (name) => {
      try {
        return await storage.delete(name)
      } catch {
        return false
      }
    }))
  return results.filter(Boolean).length
}

/** 只清理渲染资源缓存，保留应用外壳的离线能力。 */
export function clearRendererCache(storage: CacheStorageLike): Promise<number> {
  return clearCaches(storage, ['renderer'])
}

export function clearAllCaches(storage: CacheStorageLike): Promise<number> {
  return clearCaches(storage)
}

/** 浏览器为本站估算的已用空间与配额；不支持时返回空对象。 */
export async function estimateCacheStorage(
  target: StorageEstimator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): Promise<StorageEstimateResult> {
  try {
    const estimate = await target?.storage?.estimate?.()
    return { usageBytes: estimate?.usage, quotaBytes: estimate?.quota }
  } catch {
    return {}
  }
}

/** 默认开启；只有明确存过关闭值时才视为关闭。 */
export function parseOfflineCacheEnabled(raw: string | null): boolean {
  if (raw === null) return true
  const value = raw.trim().toLowerCase()
  return !(value === '0' || value === 'false' || value === 'off')
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadOfflineCacheEnabled(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): boolean {
  try {
    return parseOfflineCacheEnabled(storage?.getItem(OFFLINE_CACHE_STORAGE_KEY) ?? null)
  } catch {
    return true
  }
}

/** 返回是否写入成功；浏览器禁用存储时仍然应用本次选择。 */
export function saveOfflineCacheEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(OFFLINE_CACHE_STORAGE_KEY, enabled ? 'on' : 'off')
    return true
  } catch {
    return false
  }
}

/** 歌曲资源缓存默认关闭；只有明确存过开启值时才视为开启。 */
export function parseSongCacheEnabled(raw: string | null): boolean {
  if (raw === null) return false
  const value = raw.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

export function loadSongCacheEnabled(storage: Pick<Storage, 'getItem'> | null = defaultStorage()): boolean {
  try {
    return parseSongCacheEnabled(storage?.getItem(SONG_CACHE_STORAGE_KEY) ?? null)
  } catch {
    return false
  }
}

export function saveSongCacheEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> | null = defaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(SONG_CACHE_STORAGE_KEY, enabled ? 'on' : 'off')
    return true
  } catch {
    return false
  }
}

/**
 * 让 Cache Storage 与「歌曲资源缓存」开关保持一致：开启时确保四个分类缓存存在
 * （空缓存也代表该类开启，Service Worker 以对应缓存的存在与否决定是否缓存），
 * 关闭时删除全部四个缓存。
 */
export async function applySongCacheSetting(
  storage: CacheStorageLike,
  enabled: boolean = loadSongCacheEnabled(),
): Promise<void> {
  try {
    for (const cacheName of SONG_CACHE_NAMES) {
      if (enabled) await storage.open(cacheName)
      else await storage.delete(cacheName)
    }
  } catch {
    // 存储不可用时保持现状，页面仍可在线使用。
  }
}
