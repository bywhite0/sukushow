/**
 * Fever 时段查询。
 *
 * 时段**不在谱面里**：llll 的 `{Notes, Bpms}` 没有分段字段，分段来自歌曲主数据
 * `Musics.FeverSectionNo` 与 `cache/plain/musicscore_<Id>.csv` 的分段事件
 * （`key_type=20` 四个边界 / `key_type=99` 曲终）。
 *
 * 索引由 `scripts/gen-fever-metadata.mjs` 生成，口径与自家 `llll-preview-web`
 * 的 `feverFromMusicScore` 完全一致，已逐首（236/236）比对通过。
 */
import feverIndex from './feverMetadata.json'

export type FeverWindow = { start: number; end: number }

const index = feverIndex as Record<string, FeverWindow>

/** 按曲目 Id 取 Fever 时段；无数据返回 null（不估算）。 */
export function feverForSong(songId: string | null | undefined): FeverWindow | null {
  if (!songId) return null
  const window = index[String(songId)]
  return window ? { ...window } : null
}

/** 当前时刻是否在 Fever 内。区间取 [start, end)，与客户端同口径。 */
export function isFeverAt(timeSec: number, window: FeverWindow | null): boolean {
  if (!window) return false
  return timeSec >= window.start && timeSec < window.end
}
