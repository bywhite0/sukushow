import { cachedJsonResource, readResponseBytes, type DownloadProgress } from './resourceDownload'
import mvTimings from './mv-timing.json'

/**
 * 曲目资源解析：由曲目 Id 推导 BGM 与曲绘的本地路径。
 *
 * 资源位于统一前端的 `apps/web/public/assets/`。
 *
 * 命名对应关系（均来自 4L masterdata）：
 *   曲绘  apps/web/public/assets/jacket/<JacketId>.png           288x288 RGBA
 *   BGM   apps/web/public/assets/audio/bgm_<SoundId>.ogg
 *
 * 注意 JacketId 与 SoundId 都**不一定**等于曲目 Id：
 * 多数曲目三者相同，但翻唱 / 改编版本会另开 Id，故这里一律以
 * 曲目列表（apps/web/public/song-list.json）的字段为准，不做拼接猜测。
 */

/** apps/web/public/song-list.json 里的单首曲目。 */
export type SongEntry = {
  id: string
  orderId: number
  title: string
  furigana: string
  category: string
  unitId: string
  unitName: string
  generationsId: string
  jacketId: string
  jacketAsset: string
  jacketPath: string
  hasJacket: boolean
  charts: Record<string, string>
  difficulties: string[]
  /** 难度 → 等级，取自 masterdata/MusicScores.yaml（游戏读它）。 */
  levels?: Record<string, number>
  /** 难度 → 最大连击数，同上。 */
  maxCombos?: Record<string, number>
  hasChart: boolean
  soundId: string
  songTime: number
  playTime: number
  feverSectionNo: number
  centerCharacterId: string
  singerCharacterId: string
  supportCharacterId: string
  startTime: string
  isVideoMode: boolean
}

export type SongList = {
  source: string
  total: number
  withChart: number
  withJacket: number
  units: Record<string, string>
  songs: SongEntry[]
}

export type SongAssets = {
  /** BGM 的 URL；无对应资源时为 null。 */
  bgmUrl: string | null
  /** 曲绘的 URL；无对应资源时为 null。 */
  coverUrl: string | null
  /** 浏览器可播放的曲目 MV；没有视频模式时为 null。 */
  mvUrl: string | null
  /** 原包 Cri Mana Track 首个片段的起点与时长（秒）。 */
  mvStartSec: number
  mvDurationSec: number
}

export type BinaryLoadProgress = DownloadProgress

const BGM_BASE = '/assets/audio'
const JACKET_BASE = '/assets/jacket'

/** 曲目列表在 public 下的落盘位置。 */
export const SONG_LIST_URL = '/song-list.json'
/** 加载曲目列表（带进程内缓存）。 */
const loadCachedSongList = cachedJsonResource<SongList>(SONG_LIST_URL, '曲目列表')

export type SongListLoadProgress = {
  phase: 'download' | 'ready'
  downloadedBytes?: number
  totalBytes?: number
}

export function loadSongList(onProgress?: (progress: SongListLoadProgress) => void): Promise<SongList> {
  return loadCachedSongList(onProgress)
}

/** 由曲目条目推导 BGM / 曲绘 URL。 */
export function songAssets(song: SongEntry): SongAssets {
  const timing = song.isVideoMode ? (mvTimings as Record<string, number[]>)[song.id] : null
  return {
    bgmUrl: song.soundId ? `${BGM_BASE}/bgm_${song.soundId}.ogg` : null,
    // 曲绘用 4L 原始 PNG（288×288 RGBA）。
    coverUrl: song.hasJacket ? `${JACKET_BASE}/${song.jacketId}.png` : null,
    mvUrl: timing ? `/assets/mv/${song.id}.mp4` : null,
    mvStartSec: timing?.[0] ?? 0,
    mvDurationSec: timing?.[1] ?? 0,
  }
}

/** 按谱面文件名（rhythmgame_chart_<id>_<n>.bytes）反查曲目与难度。 */
export function findSongByChartFile(list: SongList, filename: string): { song: SongEntry; difficulty: string } | null {
  for (const song of list.songs) {
    for (const [difficulty, file] of Object.entries(song.charts)) {
      if (file === filename) return { song, difficulty }
    }
  }
  return null
}

/** 按曲目 Id 查找。 */
export async function findSong(id: string, onProgress?: (progress: SongListLoadProgress) => void): Promise<SongEntry | null> {
  const list = await loadSongList(onProgress)
  return list.songs.find((song) => song.id === id) ?? null
}

/** 下载二进制资源；失败时返回 null（资源缺失不该阻断渲染）。 */
export async function fetchBytes(url: string | null, onProgress?: (progress: BinaryLoadProgress) => void): Promise<Uint8Array | null> {
  if (!url) {
    return null
  }
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[llll-preview] 资源缺失（${response.status}）：${url}`)
      return null
    }
    const contentType = response.headers?.get?.('content-type') ?? ''
    if (contentType.includes('text/html')) {
      console.warn(`[llll-preview] 资源路径返回了 HTML：${url}`)
      return null
    }
    const bytes = await readResponseBytes(response, onProgress)
    return bytes
  } catch (error) {
    console.warn('[llll-preview] 资源下载失败：', url, error)
    return null
  }
}
