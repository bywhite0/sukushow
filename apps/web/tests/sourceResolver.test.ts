import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChart } from '@sukushow/chart/chart'
import type { SongList } from '@sukushow/llll-preview/songAssets'
import { SongSelectionStore } from '../src/songSelection'
import { createSourceResolver, resolveSource } from '../src/sourceResolver'

const list = JSON.parse(readFileSync(new URL('../public/song-list.json', import.meta.url), 'utf8')) as SongList
const chart = () => parseChart({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })
const dependencies = {
  loadList: async () => list,
  loadChart: async () => chart(),
  loadCredits: async () => ({ vocal: '演唱者', composer: '作曲者' }),
}

describe('有效来源解析', () => {
  it('同一快照共享解析和进度，结果谱面仍分别隔离', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    let requests = 0
    let release!: () => void
    const gate = new Promise<void>(done => { release = done })
    const resolve = createSourceResolver({ ...dependencies, loadChart: async (_filename, report) => {
      requests++
      report?.({ phase: 'download', downloadedBytes: 12, totalBytes: 24 })
      await gate
      report?.({ phase: 'ready', downloadedBytes: 24, totalBytes: 24 })
      return chart()
    } })
    const firstProgress: unknown[] = [], secondProgress: unknown[] = []
    const first = resolve(store.getSource(), value => firstProgress.push(value))
    const second = resolve(store.getSource(), value => secondProgress.push(value))
    release()
    const [a, b] = await Promise.all([first, second])
    expect(requests).toBe(1)
    expect(firstProgress).toEqual(secondProgress)
    expect(firstProgress).toHaveLength(3)
    a.chart!.notes[0].time = 999
    expect(b.chart!.notes[0].time).toBe(1)
    store.updateMetadata({ title: '最新标题' })
    expect((await resolve(store.getSource())).metadata.title).toBe('最新标题')
    expect(requests).toBe(2)
  })
  it('失败的共享解析可以重试，不能缓存为永久失败', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    let attempts = 0
    const resolve = createSourceResolver({ ...dependencies, loadChart: async () => {
      if (++attempts === 1) throw new Error('offline')
      return chart()
    } })
    await expect(resolve(store.getSource())).rejects.toThrow('offline')
    expect((await resolve(store.getSource())).chart?.notes).toHaveLength(1)
    expect(attempts).toBe(2)
  })
  it('独立自制谱不依赖曲库或官方谱面，使用文件名和自身偏移', async () => {
    const store = new SongSelectionStore()
    const input = chart()
    input.offset = 0.125
    store.openCustom(input, 'local.json')
    const unavailable = async (): Promise<never> => { throw new Error('offline') }
    const result = await resolveSource(store.getSource(), {
      loadList: unavailable, loadChart: unavailable, loadCredits: unavailable,
    })
    expect(result).toMatchObject({ custom: true, songId: null, chartSongId: null, level: null,
      metadata: { title: 'local.json', offsetMs: 125, fever: null, finishTime: null },
      assets: { bgmUrl: null, coverUrl: null, mvUrl: null } })
    expect(result.chart?.notes).toHaveLength(1)
  })
  it('无谱歌曲仍解析媒体，不加载伪谱面', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '104119', difficulty: null }, list)
    const result = await resolveSource(store.getSource(), { ...dependencies,
      loadChart: async () => { throw new Error('不应下载谱面') },
    })
    expect(result.chart).toBeNull()
    expect(result.metadata.title).toContain('SAKURA')
    expect(result.assets.bgmUrl).toBe('/assets/audio/bgm_10411901.ogg')
  })
  it('借谱文件使用 105101，音频和演唱资料使用实际版本', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103112', difficulty: 'HARD' }, list)
    const result = await resolveSource(store.getSource(), { ...dependencies,
      loadChart: async filename => {
        if (filename !== 'rhythmgame_chart_105101_02.bytes') throw new Error('错误谱面')
        return chart()
      },
      loadCredits: async id => ({ vocal: id === '103112' ? '原版演唱' : '错误演唱' }),
    })
    // 定数取自谱面所属曲目（105101），不是所选演唱版本（103112）。
    expect(result).toMatchObject({ chartSongId: '105101', level: 20, metadata: { title: 'Dream Believers', difficulty: 'HARD', vocal: '原版演唱' }, assets: { bgmUrl: '/assets/audio/bgm_10311201.ogg' } })
    expect(result.chart?.notes).toHaveLength(1)
  })
  it('明确清除媒体和 Fever 不被继承值补回，本地视频使用真实时长', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    store.openCustom(chart(), 'local.json')
    store.updateMedia('cover', { kind: 'none' })
    store.updateMedia('audio', { kind: 'none' })
    store.updateMedia('mv', { kind: 'file', url: 'blob:video', name: 'a.webm', durationSec: 12.5 })
    store.updateMetadata({ title: '自制标题', fever: null, finishTime: 0, composer: null })
    const result = await resolveSource(store.getSource(), dependencies)
    expect(result.assets).toEqual({ bgmUrl: null, coverUrl: null, mvUrl: 'blob:video', mvStartSec: 0, mvDurationSec: 12.5 })
    expect(result.metadata).toMatchObject({ title: '自制标题', fever: null, finishTime: 0, composer: null })
  })
  it('可选 credits 失败不阻止谱面解析', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    const result = await resolveSource(store.getSource(), { ...dependencies,
      loadCredits: async () => { throw new Error('credits offline') },
    })
    expect(result.chart?.notes).toHaveLength(1)
    expect(result.metadata.composer).toBeNull()
    expect(result.metadata.finishTime).toBe(78.545)
  })
  it('视图修改谱面不改变共享来源，并保留谱面内部引用', async () => {
    const store = new SongSelectionStore()
    store.openCustom(chart(), 'local.json')
    const first = await resolveSource(store.getSource(), dependencies)
    first.chart!.duration = 999
    first.chart!.notes[0]!.time = 999
    const second = await resolveSource(store.getSource(), dependencies)
    expect(second.chart!.duration).toBe(3)
    expect(second.chart!.notes[0]!.time).toBe(1)
    expect(second.chart!.roots[0]).toBe(second.chart!.notes[0])
  })
  it('官方谱面解析期间透传下载进度，调用方能在视图应用前显示状态', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    const progress: unknown[] = []
    await resolveSource(store.getSource(), {
      ...dependencies,
      loadChart: async (_filename, report) => {
        report?.({ phase: 'download', downloadedBytes: 12, totalBytes: 24 })
        report?.({ phase: 'ready', downloadedBytes: 24, totalBytes: 24 })
        return chart()
      },
    }, state => progress.push(state))
    expect(progress).toEqual([
      { resource: 'chart', phase: 'download', downloadedBytes: 12, totalBytes: 24 },
      { resource: 'chart', phase: 'ready', downloadedBytes: 24, totalBytes: 24 },
      { resource: 'credits', phase: 'download', downloadedBytes: 0 },
    ])
  })
  it('曲目资料下载透传资源名称和实际字节进度', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    const progress: unknown[] = []
    await resolveSource(store.getSource(), { ...dependencies, loadCredits: async (_id, report) => {
      report?.({ phase: 'download', downloadedBytes: 10, totalBytes: 30 })
      report?.({ phase: 'ready', downloadedBytes: 30, totalBytes: 30 })
      return { composer: '作曲者' }
    } }, value => progress.push(value))
    expect(progress).toEqual([
      { resource: 'credits', phase: 'download', downloadedBytes: 0 },
      { resource: 'credits', phase: 'download', downloadedBytes: 10, totalBytes: 30 },
      { resource: 'credits', phase: 'ready', downloadedBytes: 30, totalBytes: 30 },
    ])
  })
  it('下载前测量全部资源，资料与谱面共用固定分母且保留真实累计', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    const events: string[] = []
    const progress: any[] = []
    const result = await resolveSource(store.getSource(), {
      ...dependencies,
      includeMv: () => false,
      measure: async urls => {
        events.push('measure')
        expect(urls).toContain('/assets/chart/rhythmgame_chart_103103_04.bytes')
        expect(urls).toContain('/song-credits.json')
        expect(urls).toContain('/assets/audio/bgm_10310301.ogg')
        expect(urls).not.toContain('/assets/mv/103103/index.m3u8')
        return new Map([['/assets/chart/rhythmgame_chart_103103_04.bytes', 24],
          ['/song-credits.json', 30], ['/assets/audio/bgm_10310301.ogg', 100], ['/assets/jacket/103103.png', 0]])
      },
      loadChart: async (_filename, report) => {
        events.push('chart'); report?.({ phase: 'ready', downloadedBytes: 24, totalBytes: 24 }); return chart()
      },
      loadCredits: async (_id, report) => {
        events.push('credits'); report?.({ phase: 'ready', downloadedBytes: 30, totalBytes: 30 }); return {}
      },
    }, value => progress.push(value))
    expect(events).toEqual(['measure', 'chart', 'credits'])
    expect(progress.filter(value => value.cumulative).map(value => value.cumulative.totalBytes)).toEqual([154, 154, 154])
    expect(progress.at(-1).cumulative.downloadedBytes).toBe(54)
    expect(result.download).toMatchObject({ downloadedBytes: 54, totalBytes: 154 })
  })
  it('资料阶段开始保留谱面累计，未知资源大小不冒充完整总量', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    const progress: any[] = []
    const result = await resolveSource(store.getSource(), {
      ...dependencies,
      includeMv: () => false,
      measure: async () => new Map([['/assets/chart/rhythmgame_chart_103103_04.bytes', 24]]),
      loadChart: async (_filename, report) => {
        report?.({ phase: 'ready', downloadedBytes: 24, totalBytes: 24 }); return chart()
      },
    }, value => progress.push(value))
    const start = progress.find(value => value.resource === 'credits')
    expect(start.cumulative.downloadedBytes).toBe(24)
    expect(start.cumulative.totalBytes).toBeUndefined()
    expect(result.download?.downloadedBytes).toBe(24)
    expect(result.download?.totalBytes).toBeUndefined()
  })
  it('同一来源改变 MV 开关只重新测量，不重复下载谱面或资料', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    let includeMv = false, charts = 0, credits = 0
    const measured: (string | null)[][] = []
    const resolve = createSourceResolver({ ...dependencies,
      includeMv: () => includeMv,
      measure: async urls => {
        measured.push([...urls])
        return new Map(urls.filter((url): url is string => Boolean(url)).map(url => [url, 10]))
      },
      loadChart: async (_filename, report) => {
        charts++; report?.({ phase: 'ready', downloadedBytes: 10, totalBytes: 10 }); return chart()
      },
      loadCredits: async (_id, report) => {
        credits++; report?.({ phase: 'ready', downloadedBytes: 10, totalBytes: 10 }); return {}
      },
    })
    const first = await resolve(store.getSource())
    includeMv = true
    const second = await resolve(store.getSource())
    expect(first.download?.totalBytes).toBe(40)
    expect(second.download?.totalBytes).toBe(50)
    expect(second.download?.sizes?.['/assets/mv/103103/index.m3u8']).toBe(10)
    expect(charts).toBe(1)
    expect(credits).toBe(1)
    expect(measured).toHaveLength(2)
    includeMv = false
    expect((await resolve(store.getSource())).download?.totalBytes).toBe(40)
  })
  it('官方谱面加载失败不返回旧谱或默认谱', async () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    await expect(resolveSource(store.getSource(), { ...dependencies,
      loadChart: async () => { throw new Error('chart 404') },
    })).rejects.toThrow('chart 404')
  })
})
