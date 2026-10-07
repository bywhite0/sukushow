/**
 * Fever 时段查询。
 *
 * 时段**不在谱面里**：llll 的 `{Notes, Bpms}` 没有分段字段，分段来自歌曲主数据
 * `Musics.FeverSectionNo` 与 `cache/plain/musicscore_<Id>.csv` 的分段事件
 * （`key_type=20` 四个边界 / `key_type=99` 曲终）。
 *
 * 索引由 `scripts/gen-fever-metadata.mjs` 生成，口径与 `packages/llll-preview`
 * 的 `feverFromMusicScore` 完全一致，已逐首（236/236）比对通过。
 *
 * ⚠ 口径依据（反汇编 llll `libil2cpp.so` 的 `FeverResolver.Inject`）：
 *   `startTime = sectionNo === 1 ? 0 : sections[sectionNo - 2].time`
 *   `endTime   = sectionNo === 5 ? MusicEndTime : sections[sectionNo - 1].time`
 *   （`sections` = CSV 的 `key_type=20` 行；`MusicEndTime` 取 `key_type=99` 的最后一条）
 */
import feverIndex from './feverMetadata.json'

export type FeverWindow = { start: number; end: number }

/**
 * FeverChance 窗口。
 *
 * ⚠ **这是代理值，不是 llll 源数据**：llll 没有 chance 概念
 * （`musicscore_*.csv` 的 `key_type` 只有 1/10/20/99）。
 * 取值 = 「Fever 段之前那一段」，即 `[times[n-2], times[n-1])`，
 * 因此恒有 `chance.end === fever.start`。
 * 仅用于视觉近似，勿当作游戏内真实分段。
 */
export type FeverChanceWindow = { start: number; end: number }

type Entry = {
  start: number
  end: number
  chanceStart: number | null
  chanceEnd: number | null
}

const index = feverIndex as Record<string, Entry>

/** 按曲目 Id 取 Fever 时段；无数据返回 null（不估算）。 */
export function feverForSong(songId: string | null | undefined): FeverWindow | null {
  if (!songId) return null
  const window = index[String(songId)]
  return window ? { start: window.start, end: window.end } : null
}

/**
 * 按曲目 Id 取 FeverChance 代理窗口；无数据或该曲没有前一段时返回 null。
 *
 * ⚠ 代理值——见 `FeverChanceWindow` 的说明。
 */
export function feverChanceForSong(
  songId: string | null | undefined,
): FeverChanceWindow | null {
  if (!songId) return null
  const window = index[String(songId)]
  if (!window || window.chanceStart === null || window.chanceEnd === null) return null
  return { start: window.chanceStart, end: window.chanceEnd }
}

/** 当前时刻是否在 Fever 内。区间取 [start, end)，与客户端同口径。 */
export function isFeverAt(timeSec: number, window: FeverWindow | null): boolean {
  if (!window) return false
  return timeSec >= window.start && timeSec < window.end
}
