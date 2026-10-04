/**
 * 曲目资源解析：由曲目 Id 推导 BGM 与曲绘的本地路径。
 *
 * 资源位于统一前端的 `apps/web/public/assets/`。
 *
 * 命名对应关系（均来自 4L masterdata）：
 *   曲绘  apps/web/public/assets/jacket/<JacketId>.webp          288x288 RGBA
 *   BGM   apps/web/public/assets/audio/bgm_<SoundId>.ogg
 *
 * 注意 JacketId 与 SoundId 都**不一定**等于曲目 Id：
 * 多数曲目三者相同，但翻唱 / 改编版本会另开 Id，故这里一律以
 * 曲目列表（apps/web/public/song-list.json）的字段为准，不做拼接猜测。
 */

import { cachedJsonResource, readResponseBytes, type DownloadProgress } from '../../../llll-preview/src/resourceDownload'

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
}

export type BinaryLoadProgress = DownloadProgress

const BGM_BASE = '/assets/audio'
const JACKET_BASE = '/assets/jacket'

/** 曲目列表在 public 下的落盘位置。 */
export const SONG_LIST_URL = '/song-list.json'
/** 曲目详情（词曲编 + vocal）的落盘位置。 */
export const SONG_CREDITS_URL = '/song-credits.json'

/**
 * 曲目详情：词曲编来自 wikiwiki，vocal 来自 masterdata。
 *
 * vocal = center + singer（center 是 C 位、singer 是其余演唱者，
 * 两者互斥），只取 singer 会漏掉 C 位。
 */
export type SongCredits = {
  id: string
  title: string
  lyricist: string | null
  composer: string | null
  arranger: string | null
  stringsArranger: string | null
  center: string | null
  singer: string[]
  support: string[]
  vocal: string[]
  vocalCount: number
  wikiPage: string | null
}

type SongCreditsFile = {
  total: number
  coverage: Record<string, number>
  /** wiki 与 masterdata 的 center 差异。center 一律以 masterdata 为准（游戏读它）。 */
  centerConflicts: {
    id: string
    title: string
    /** 采用值，即 masterdata 的 C 位。 */
    value: string
    /** wiki 的不同说法，仅存档备查。 */
    wikiSays: string
    authority: 'masterdata'
  }[]
  songs: SongCredits[]
}

const loadCachedSongCredits = cachedJsonResource<SongCreditsFile>(SONG_CREDITS_URL, '曲目详情')

/** 加载曲目详情（带进程内缓存）。 */
export function loadSongCredits(onProgress?: (progress: DownloadProgress) => void): Promise<SongCreditsFile> {
  return loadCachedSongCredits(onProgress)
}

/** 按曲目 Id 查词曲编 / vocal。 */
export async function findSongCredits(id: string, onProgress?: (progress: DownloadProgress) => void): Promise<SongCredits | null> {
  const file = await loadSongCredits(onProgress)
  return file.songs.find((song) => song.id === id) ?? null
}

/** 把词曲编 / vocal 拼成 HUD 的 metadata 片段。 */
export function creditsToMetadata(credits: SongCredits | null): {
  lyricist: string | null
  composer: string | null
  arranger: string | null
  vocal: string | null
} {
  if (!credits) {
    return { lyricist: null, composer: null, arranger: null, vocal: null }
  }
  // 编曲缺失时退回弦编曲，避免 HUD 显示空占位。
  const arranger = credits.arranger ?? credits.stringsArranger
  return {
    lyricist: credits.lyricist,
    composer: credits.composer,
    arranger,
    vocal: credits.vocal.length > 0 ? credits.vocal.join('、') : null,
  }
}

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
  return {
    bgmUrl: song.soundId ? `${BGM_BASE}/bgm_${song.soundId}.ogg` : null,
    // 曲绘用 PNG：wasm 侧走 stb_image，它不支持 WebP。
    coverUrl: song.hasJacket ? `${JACKET_BASE}/${song.jacketId}.png` : null,
  }
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
      console.warn(`[llll-pjsk] 资源缺失（${response.status}）：${url}`)
      return null
    }
    const contentType = response.headers?.get?.('content-type') ?? ''
    if (contentType.includes('text/html')) {
      console.warn(`[llll-pjsk] 资源路径返回了 HTML：${url}`)
      return null
    }
    const bytes = await readResponseBytes(response, onProgress)
    return bytes
  } catch (error) {
    console.warn('[llll-pjsk] 资源下载失败：', url, error)
    return null
  }
}
