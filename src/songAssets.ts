/**
 * 曲目资源解析：由曲目 Id 推导 BGM 与曲绘的本地路径。
 *
 * 资源由 `scripts/link-assets.py` 从本地副本链接进 `public/assets/`，
 * 不进版本库（体积大且非本项目可再分发）。
 *
 * 命名对应关系（均来自 4L masterdata）：
 *   曲绘  public/assets/jacket/<JacketId>.png           288x288 RGBA
 *   BGM   public/assets/audio/bgm_<SoundId>.ogg
 *
 * 注意 JacketId 与 SoundId 都**不一定**等于曲目 Id：
 * 多数曲目三者相同，但翻唱 / 改编版本会另开 Id，故这里一律以
 * 曲目列表（public/song-list.json）的字段为准，不做拼接猜测。
 */

/** public/song-list.json 里的单首曲目。 */
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

const BGM_BASE = '/assets/audio'
const JACKET_BASE = '/assets/jacket'

/** 曲目列表在 public 下的落盘位置。 */
export const SONG_LIST_URL = '/song-list.json'
/** 加载曲目列表（带进程内缓存）。 */
let songListPromise: Promise<SongList> | null = null

export function loadSongList(): Promise<SongList> {
  songListPromise ??= fetch(SONG_LIST_URL).then(async (response) => {
    if (!response.ok) {
      throw new Error(`曲目列表加载失败（${response.status}）：${SONG_LIST_URL}`)
    }
    return await response.json() as SongList
  })
  return songListPromise
}

/** 由曲目条目推导 BGM / 曲绘 URL。 */
export function songAssets(song: SongEntry): SongAssets {
  return {
    bgmUrl: song.soundId ? `${BGM_BASE}/bgm_${song.soundId}.ogg` : null,
    // 曲绘用 4L 原始 PNG（288×288 RGBA）。
    coverUrl: song.hasJacket ? `${JACKET_BASE}/${song.jacketId}.png` : null,
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
export async function findSong(id: string): Promise<SongEntry | null> {
  const list = await loadSongList()
  return list.songs.find((song) => song.id === id) ?? null
}

/** 下载二进制资源；失败时返回 null（资源缺失不该阻断渲染）。 */
export async function fetchBytes(url: string | null): Promise<Uint8Array | null> {
  if (!url) {
    return null
  }
  try {
    const response = await fetch(url)
    if (!response.ok) {
      console.warn(`[llll-preview] 资源缺失（${response.status}）：${url}`)
      return null
    }
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    console.warn('[llll-preview] 资源下载失败：', url, error)
    return null
  }
}
