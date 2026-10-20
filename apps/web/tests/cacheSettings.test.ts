import { describe, expect, it } from 'vitest'
import {
  OFFLINE_CACHE_STORAGE_KEY,
  RENDERER_CACHE_NAME,
  SONG_CACHES,
  SONG_CACHE_NAMES,
  SONG_CACHE_STORAGE_KEY,
  applySongCacheSetting,
  cacheGroupOf,
  clearAllCaches,
  clearCaches,
  clearRendererCache,
  estimateCacheStorage,
  loadOfflineCacheEnabled,
  loadSongCacheEnabled,
  measureCacheUsage,
  parseOfflineCacheEnabled,
  parseSongCacheEnabled,
  saveOfflineCacheEnabled,
  saveSongCacheEnabled,
  songCacheNameOf,
  type CacheLike,
  type CacheStorageLike,
} from '../src/cacheSettings'

/** 只实现被测代码用到的 Cache Storage 子集。 */
function fakeCacheStorage(initial: Record<string, Record<string, Response>> = {}) {
  const data = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
  const storage: CacheStorageLike & { data: typeof data } = {
    data,
    async keys() { return [...data.keys()] },
    async open(name: string): Promise<CacheLike> {
      // 与真实 Cache Storage 一致：缓存不存在时创建空缓存。
      let entries = data.get(name)
      if (!entries) {
        entries = new Map()
        data.set(name, entries)
      }
      return {
        async keys() { return [...entries.keys()].map((url) => new Request(url)) },
        async match(request: Request) { return entries.get(request.url) },
      }
    },
    async delete(name: string) { return data.delete(name) },
  }
  return storage
}

const url = (path: string) => `https://sukushow.test${path}`

describe('cacheGroupOf', () => {
  it('区分预缓存、渲染资源、歌曲资源的四个分类与其他缓存', () => {
    expect(cacheGroupOf('workbox-precache-v2-https://sukushow.test/')).toBe('precache')
    expect(cacheGroupOf(RENDERER_CACHE_NAME)).toBe('renderer')
    expect(cacheGroupOf('sukushow-renderer-assets-v2')).toBe('renderer')
    expect(cacheGroupOf(SONG_CACHES.audio)).toBe('audio')
    expect(cacheGroupOf(SONG_CACHES.mv)).toBe('mv')
    expect(cacheGroupOf(SONG_CACHES.chart)).toBe('chart')
    expect(cacheGroupOf(SONG_CACHES.jacket)).toBe('jacket')
    expect(cacheGroupOf('sukushow-song-audio-v2')).toBe('audio')
    expect(cacheGroupOf('workbox-runtime-https://sukushow.test/')).toBe('other')
  })
})

describe('songCacheNameOf', () => {
  it('按资源路径归类到对应缓存', () => {
    expect(songCacheNameOf('/assets/audio/bgm_1.ogg')).toBe(SONG_CACHES.audio)
    expect(songCacheNameOf('/assets/mv/103103/index.m3u8')).toBe(SONG_CACHES.mv)
    expect(songCacheNameOf('/assets/chart/a.bytes')).toBe(SONG_CACHES.chart)
    expect(songCacheNameOf('/assets/jacket/103103.png')).toBe(SONG_CACHES.jacket)
    expect(songCacheNameOf('/assets/mmw/font/a.ttf')).toBeNull()
    expect(songCacheNameOf('/index.html')).toBeNull()
  })
})

describe('measureCacheUsage', () => {
  it('按分组统计条目数，并优先使用响应头里的体积', async () => {
    const storage = fakeCacheStorage({
      'workbox-precache-v2-https://sukushow.test/': {
        [url('/index.html')]: new Response('shell', { headers: { 'content-length': '12' } }),
        [url('/assets/app.js')]: new Response(new Uint8Array(4), { headers: { 'content-length': '30' } }),
      },
      [RENDERER_CACHE_NAME]: {
        [url('/rg/tex.png')]: new Response(new Uint8Array(2048)),
      },
      [SONG_CACHES.audio]: {
        [url('/assets/audio/bgm_1.ogg')]: new Response(new Uint8Array(512)),
      },
      [SONG_CACHES.chart]: {
        [url('/assets/chart/rhythmgame_chart_1_01.bytes')]: new Response(new Uint8Array(1024)),
      },
    })

    const usage = await measureCacheUsage(storage)
    expect(usage.totalEntries).toBe(5)
    expect(usage.totalBytes).toBe(12 + 30 + 2048 + 512 + 1024)
    expect(usage.groups.map((group) => [group.id, group.entries, group.bytes])).toEqual([
      ['precache', 2, 42],
      ['renderer', 1, 2048],
      ['audio', 1, 512],
      ['mv', 0, 0],
      ['chart', 1, 1024],
      ['jacket', 0, 0],
      ['other', 0, 0],
    ])
  })

  it('缓存不可读时返回空统计而不抛错', async () => {
    const usage = await measureCacheUsage({
      async keys() { throw new Error('denied') },
      async open() { throw new Error('denied') },
      async delete() { return false },
    })
    expect(usage).toMatchObject({ totalEntries: 0, totalBytes: 0 })
    expect(usage.groups).toHaveLength(7)
  })

  it('跳过损坏的缓存并继续统计其他分组', async () => {
    const storage = fakeCacheStorage({
      'broken-cache': {},
      [RENDERER_CACHE_NAME]: {
        [url('/rg/tex.png')]: new Response(new Uint8Array(10)),
      },
    })
    const originalOpen = storage.open.bind(storage)
    storage.open = async (name: string) => {
      if (name === 'broken-cache') throw new Error('corrupt')
      return originalOpen(name)
    }
    const usage = await measureCacheUsage(storage)
    expect(usage.totalEntries).toBe(1)
    expect(usage.totalBytes).toBe(10)
  })
})

describe('clearCaches', () => {
  it('只删除指定分组，并返回删除的缓存数量', async () => {
    const storage = fakeCacheStorage({
      'workbox-precache-v2-https://sukushow.test/': {},
      [RENDERER_CACHE_NAME]: {},
      ...Object.fromEntries(SONG_CACHE_NAMES.map((name) => [name, {}])),
      'workbox-runtime-https://sukushow.test/': {},
    })
    await expect(clearRendererCache(storage)).resolves.toBe(1)
    expect([...storage.data.keys()]).toEqual([
      'workbox-precache-v2-https://sukushow.test/',
      ...SONG_CACHE_NAMES,
      'workbox-runtime-https://sukushow.test/',
    ])

    // 只清理歌曲资源里的音频与谱面，MV 与曲绘保留。
    await expect(clearCaches(storage, ['audio', 'chart'])).resolves.toBe(2)
    expect([...storage.data.keys()]).toEqual([
      'workbox-precache-v2-https://sukushow.test/',
      SONG_CACHES.mv,
      SONG_CACHES.jacket,
      'workbox-runtime-https://sukushow.test/',
    ])

    await expect(clearCaches(storage, ['precache', 'other', 'mv', 'jacket'])).resolves.toBe(4)
    expect([...storage.data.keys()]).toEqual([])
  })

  it('清理全部缓存', async () => {
    const storage = fakeCacheStorage({
      'workbox-precache-v2-https://sukushow.test/': {},
      [RENDERER_CACHE_NAME]: {},
      ...Object.fromEntries(SONG_CACHE_NAMES.map((name) => [name, {}])),
    })
    await expect(clearAllCaches(storage)).resolves.toBe(6)
    expect(storage.data.size).toBe(0)
  })
})

describe('离线缓存开关', () => {
  it('默认开启，只有明确的关闭值才视为关闭', () => {
    expect(parseOfflineCacheEnabled(null)).toBe(true)
    expect(parseOfflineCacheEnabled('on')).toBe(true)
    expect(parseOfflineCacheEnabled('off')).toBe(false)
    expect(parseOfflineCacheEnabled('0')).toBe(false)
    expect(parseOfflineCacheEnabled('FALSE')).toBe(false)
    expect(parseOfflineCacheEnabled(' off ')).toBe(false)
  })

  it('通过 localStorage 读取与保存', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }

    expect(loadOfflineCacheEnabled(storage)).toBe(true)
    expect(saveOfflineCacheEnabled(false, storage)).toBe(true)
    expect(values.get(OFFLINE_CACHE_STORAGE_KEY)).toBe('off')
    expect(loadOfflineCacheEnabled(storage)).toBe(false)
    expect(saveOfflineCacheEnabled(true, storage)).toBe(true)
    expect(loadOfflineCacheEnabled(storage)).toBe(true)
  })

  it('存储不可用时仍返回当前选择', () => {
    expect(loadOfflineCacheEnabled(null)).toBe(true)
    expect(saveOfflineCacheEnabled(false, null)).toBe(false)
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadOfflineCacheEnabled(throwing)).toBe(true)
    expect(saveOfflineCacheEnabled(true, throwing)).toBe(false)
  })
})

describe('歌曲资源缓存开关', () => {
  it('默认关闭，只有明确的开启值才视为开启', () => {
    expect(parseSongCacheEnabled(null)).toBe(false)
    expect(parseSongCacheEnabled('on')).toBe(true)
    expect(parseSongCacheEnabled('1')).toBe(true)
    expect(parseSongCacheEnabled('TRUE')).toBe(true)
    expect(parseSongCacheEnabled(' on ')).toBe(true)
    expect(parseSongCacheEnabled('off')).toBe(false)
    expect(parseSongCacheEnabled('0')).toBe(false)
  })

  it('通过 localStorage 读取与保存', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }

    expect(loadSongCacheEnabled(storage)).toBe(false)
    expect(saveSongCacheEnabled(true, storage)).toBe(true)
    expect(values.get(SONG_CACHE_STORAGE_KEY)).toBe('on')
    expect(loadSongCacheEnabled(storage)).toBe(true)
    expect(saveSongCacheEnabled(false, storage)).toBe(true)
    expect(loadSongCacheEnabled(storage)).toBe(false)
  })

  it('存储不可用时按关闭处理', () => {
    expect(loadSongCacheEnabled(null)).toBe(false)
    expect(saveSongCacheEnabled(true, null)).toBe(false)
    const throwing = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    }
    expect(loadSongCacheEnabled(throwing)).toBe(false)
    expect(saveSongCacheEnabled(true, throwing)).toBe(false)
  })

  it('开启时创建四个分类的空缓存，关闭时全部删除', async () => {
    const storage = fakeCacheStorage()
    await applySongCacheSetting(storage, true)
    expect([...storage.data.keys()]).toEqual([...SONG_CACHE_NAMES])
    for (const cacheName of SONG_CACHE_NAMES) {
      expect(await storage.open(cacheName).then((cache) => cache.keys())).toEqual([])
    }

    await applySongCacheSetting(storage, false)
    expect(storage.data.size).toBe(0)
  })
})

describe('estimateCacheStorage', () => {
  it('读取浏览器估算值，不支持时返回空对象', async () => {
    await expect(estimateCacheStorage({ storage: { estimate: async () => ({ usage: 10, quota: 100 }) } }))
      .resolves.toEqual({ usageBytes: 10, quotaBytes: 100 })
    await expect(estimateCacheStorage(undefined)).resolves.toEqual({})
    await expect(estimateCacheStorage({ storage: { estimate: async () => { throw new Error('denied') } } }))
      .resolves.toEqual({})
  })
})
