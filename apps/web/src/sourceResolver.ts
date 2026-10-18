import type { DownloadProgress } from '@sukushow/llll-preview/resourceDownload'
import type { Chart } from '@sukushow/chart/chart'
import { feverForSong, finishTimeForSong } from '@sukushow/chart/songTiming'
import { songAssets, type SongList } from '@sukushow/llll-preview/songAssets'
import type { MediaOverride, ResolvedSource, SourceMetadata, SourceState } from './songSelection'

export type SourceProgress = DownloadProgress & { resource?: 'chart' | 'credits'; cumulative?: DownloadProgress }

export type SourceDependencies = {
  loadList: () => Promise<SongList>
  loadChart: (filename: string, onProgress?: (progress: SourceProgress) => void) => Promise<Chart>
  loadCredits: (songId: string, onProgress?: (progress: SourceProgress) => void) => Promise<Partial<SourceMetadata>>
  measure?: (urls: readonly (string | null)[]) => Promise<Map<string, number>>
  includeMv?: () => boolean
  /**
   * 把 MV 的站点路径换成本地文件（返回 blob URL）。未接入本地资源时原样返回。
   *
   * 只有 MV 支持本地覆盖：原包 USM 能在浏览器内无损重封装成 MP4。BGM 与曲绘的
   * 原包格式（CRI ACB/AWB、UnityFS）浏览器不能直接消费，且站点已完整自带。
   */
  localizeMv?: (path: string | null) => Promise<string | null>
  /** 本地文件是否命中，用于跳过对 blob URL 的 HEAD 测量。 */
  isLocalUrl?: (url: string) => boolean
}

/** 同一不可变快照共享在途解析，各视图拿到独立的谱面副本。 */
export function createSourceResolver(dependencies: SourceDependencies) {
  type Entry = {
    promise: Promise<ResolvedSource>
    includeMv: boolean
    progress?: SourceProgress
    listeners: Set<(progress: SourceProgress) => void>
  }
  const entries = new WeakMap<SourceState, Entry>()
  return async (state: SourceState, onProgress?: (progress: SourceProgress) => void): Promise<ResolvedSource> => {
    const includeMv = dependencies.includeMv?.() ?? true
    let entry = entries.get(state)
    if (!entry) {
      const listeners = new Set<(progress: SourceProgress) => void>()
      const next: Entry = {
        listeners, includeMv,
        promise: resolveSource(state, { ...dependencies, includeMv: () => includeMv }, progress => {
          next.progress = progress
          for (const listener of listeners) listener(progress)
        }).catch(error => { entries.delete(state); throw error }),
      }
      entries.set(state, next)
      entry = next
    }
    if (onProgress) {
      entry.listeners.add(onProgress)
      if (entry.progress) onProgress(entry.progress)
    }
    try {
      const source = structuredClone(await entry.promise)
      if (entry.includeMv !== includeMv && source.download?.sizes && dependencies.measure) {
        const urls = [...Object.keys(source.download.sizes).filter(url => url !== source.assets.mvUrl),
          source.assets.bgmUrl, source.assets.coverUrl, includeMv ? source.assets.mvUrl : null]
          .filter((url): url is string => Boolean(url))
          // 本地 MV 是 blob URL，无法 HEAD，跳过测量。
          .filter(url => !dependencies.isLocalUrl?.(url))
        const sizes = await dependencies.measure(urls)
        source.download.sizes = Object.fromEntries(sizes)
        source.download.totalBytes = urls.every(url => sizes.has(url))
          ? [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0) : undefined
      }
      return source
    }
    finally { if (onProgress) entry.listeners.delete(onProgress) }
  }
}

function mediaUrl(override: MediaOverride, inherited: string | null): string | null {
  if (override.kind === 'inherit') return inherited
  return override.kind === 'file' ? override.url : null
}

export async function resolveSource(state: SourceState, dependencies: SourceDependencies,
  onProgress?: (progress: SourceProgress) => void): Promise<ResolvedSource> {
  const downloaded = new Map<string, number>()
  let sizes: Map<string, number> | undefined
  let totalBytes: number | undefined
  const report = (resource: 'chart' | 'credits', progress: SourceProgress) => {
    downloaded.set(resource, progress.downloadedBytes)
    const cumulative = sizes ? { phase: progress.phase,
      downloadedBytes: [...downloaded.values()].reduce((sum, bytes) => sum + bytes, 0),
      totalBytes } : undefined
    onProgress?.({ ...progress, resource, ...(cumulative ? { cumulative } : {}) })
  }
  const list = state.songId || state.chart.kind === 'official' ? await dependencies.loadList() : null
  const song = list?.songs.find(item => item.id === state.songId) ?? null
  if (state.songId && !song) throw new Error(`曲目列表里没有 Id ${state.songId}`)
  const chartSongId = state.chart.kind === 'official' ? state.chart.songId : null
  const inherited = song ? songAssets(song) : {
    bgmUrl: null, coverUrl: null, mvUrl: null, mvStartSec: 0, mvDurationSec: 0,
  }
  // 只有 MV 支持本地覆盖（原包 USM 可在浏览器内无损重封装）；BGM 与曲绘
  // 的原包格式浏览器不能直接消费，站点已完整自带，保持站点路径。
  const localizeMv = dependencies.localizeMv ?? (async (path: string | null) => path)
  const [bgmUrl, coverUrl] = [mediaUrl(state.media.audio, inherited.bgmUrl),
    mediaUrl(state.media.cover, inherited.coverUrl)]
  const mvUrl = await localizeMv(mediaUrl(state.media.mv, inherited.mvUrl))
  const mediaUrls = [bgmUrl, coverUrl, dependencies.includeMv?.() === false ? null : mvUrl]
  if (dependencies.measure && song) {
    const chartSong = list?.songs.find(item => item.id === chartSongId)
    const filename = state.chart.kind === 'official' ? chartSong?.charts[state.chart.difficulty] : null
    const urls = [filename ? `/assets/chart/${filename}` : null, '/song-credits.json', ...mediaUrls]
    // blob URL 无法 HEAD；本地命中的 MV 不参与测量，进度按未知处理。
    sizes = await dependencies.measure(urls.filter(url => !url || !dependencies.isLocalUrl?.(url)))
    if (urls.every(url => !url || sizes!.has(url) || dependencies.isLocalUrl?.(url)))
      totalBytes = [...sizes.values()].reduce((sum, bytes) => sum + bytes, 0)
  }
  let chart: Chart | null = null
  if (state.chart.kind === 'custom') chart = structuredClone(state.chart.chart)
  if (state.chart.kind === 'official') {
    const source = list?.songs.find(item => item.id === chartSongId)
    const filename = source?.charts[state.chart.difficulty]
    if (!filename) throw new Error(`曲目 ${chartSongId} 没有难度 ${state.chart.difficulty} 的谱面`)
    chart = structuredClone(await dependencies.loadChart(filename, progress => report('chart', progress)))
  }

  // 词曲资料是可选信息；其请求失败不能替换或阻止已选谱面。
  if (song) report('credits', { phase: 'download', downloadedBytes: 0 })
  const credits = song ? await dependencies.loadCredits(song.id, progress =>
    report('credits', progress)).catch(() => ({})) : {}
  const metadata: SourceMetadata = {
    title: song?.title ?? (state.chart.kind === 'custom' ? state.chart.filename : '未选择谱面'),
    difficulty: state.chart.kind === 'official' ? state.chart.difficulty : null,
    scoreCreator: null, lyricist: null, composer: null, arranger: null, vocal: null,
    offsetMs: (chart?.offset ?? 0) * 1000,
    fever: feverForSong(chartSongId ?? song?.id),
    finishTime: finishTimeForSong(song?.id),
    ...credits, ...state.metadata,
  }
  const mv = state.media.mv
  // 继承歌曲资源时（含本地库提供的原包完整电影）沿用 mv-timing 的起点与时长，
  // 否则 MV 会从头播、和谱面对不上。单曲覆盖仍从 0 秒开始。
  return {
    revision: state.revision, identity: state.identity, songId: state.songId,
    chart, chartSongId, custom: state.chart.kind === 'custom', metadata,
    download: { downloadedBytes: [...downloaded.values()].reduce((sum, bytes) => sum + bytes, 0),
      totalBytes: sizes ? totalBytes
        : [...downloaded.values()].reduce((sum, bytes) => sum + bytes, 0),
      ...(sizes ? { sizes: Object.fromEntries(sizes) } : {}) },
    assets: {
      bgmUrl,
      coverUrl,
      mvUrl,
      mvStartSec: mv.kind === 'inherit' ? inherited.mvStartSec : 0,
      mvDurationSec: mv.kind === 'inherit' ? inherited.mvDurationSec : mv.kind === 'file' ? mv.durationSec ?? 0 : 0,
    },
  }
}
