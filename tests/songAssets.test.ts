import { describe, expect, it, vi, afterEach } from 'vitest'
import { songAssets, findSong, loadSongList, fetchBytes, type SongEntry } from '../src/llll/songAssets'

const baseSong: SongEntry = {
  id: '103103',
  orderId: 1,
  title: 'フォーチュンムービー',
  furigana: '',
  category: 'スリーズブーケ',
  unitId: '3',
  unitName: 'スリーズブーケ',
  generationsId: '3',
  jacketId: '103103',
  jacketAsset: 'image_music_thumbnail_103103',
  jacketPath: '/assets/jacket/103103.png',
  hasJacket: true,
  charts: { MASTER: 'rhythmgame_chart_103103_04.bytes' },
  difficulties: ['MASTER'],
  hasChart: true,
  soundId: '10310301',
  songTime: 0,
  playTime: 75727,
  feverSectionNo: 0,
  centerCharacterId: '',
  singerCharacterId: '',
  supportCharacterId: '',
  startTime: '',
  isVideoMode: false,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('songAssets', () => {
  it('由 soundId 推导 BGM 路径', () => {
    expect(songAssets(baseSong).bgmUrl).toBe('/assets/audio/bgm_10310301.ogg')
  })

  it('曲绘用 PNG 而非 WebP（wasm 侧 stb_image 不支持 WebP）', () => {
    expect(songAssets(baseSong).coverUrl).toBe('/assets/jacket/103103.png')
    expect(songAssets(baseSong).coverUrl).not.toMatch(/\.webp$/)
  })

  it('缺 soundId / 无曲绘时返回 null', () => {
    expect(songAssets({ ...baseSong, soundId: '' }).bgmUrl).toBeNull()
    expect(songAssets({ ...baseSong, hasJacket: false }).coverUrl).toBeNull()
  })
})

describe('loadSongList', () => {
  it('解析曲目列表并支持按 Id 查找', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        source: 'test', total: 1, withChart: 1, withJacket: 1,
        units: {}, songs: [baseSong],
      }),
    })))

    const list = await loadSongList()
    expect(list.total).toBe(1)
    const song = await findSong('103103')
    expect(song?.title).toBe('フォーチュンムービー')
    expect(await findSong('不存在')).toBeNull()
  })
})

describe('fetchBytes', () => {
  it('url 为 null 时返回 null', async () => {
    expect(await fetchBytes(null)).toBeNull()
  })

  it('HTTP 失败时返回 null 而不抛错（资源缺失不该阻断渲染）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchBytes('/assets/jacket/无此文件.png')).toBeNull()
  })

  it('成功时返回字节', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })))
    const bytes = await fetchBytes('/assets/audio/bgm_10310301.ogg')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes!)).toEqual([1, 2, 3])
  })
})
