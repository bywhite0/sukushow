/**
 * Fever 时段。
 *
 * 时段不在谱面里，来自歌曲主数据：`Musics.FeverSectionNo` 指明第几段，`musicscore_<Id>.csv`
 * 的 `key_type=20` 行给出四个分段边界，`key_type=99` 行给出 MusicEnd，时间单位都是毫秒。
 * 客户端的取法（依据见 `docs/evidence.md`）：
 *   - 段表 = `[0, ...四个边界（按时间升序）, MusicEnd]`，第 n 段 = `[段表[n−1], 段表[n])`；
 *   - MusicEnd 取 CSV 原始行序里**最后一条** `key_type=99`，不取时间最大的那条，也不用 `Musics.PlayTime`。
 * 只有第五段的终点用到 MusicEnd。
 */

export type FeverWindow = { start: number; end: number };

/** 当前时刻是否在 Fever 内。区间取 `[start, end)`，与客户端同口径。 */
export function isFeverAt(time: number, win: FeverWindow | null | undefined): boolean {
  if (!win) return false;
  return time >= win.start && time < win.end;
}

/** 解析手动输入的起止秒数；两项都留空表示关闭 Fever。 */
export function parseFeverWindow(startText: string, endText: string): FeverWindow | null {
  if (!startText.trim() && !endText.trim()) return null;
  const start = Number(startText), end = Number(endText);
  if (!startText.trim() || !endText.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Fever 时段需满足 0 ≤ 开始 < 结束（秒）；同时留空则关闭。');
  }
  return { start, end };
}

/**
 * 由 `musicscore_<Id>.csv` 与 `FeverSectionNo` 算 Fever 时段（秒）。
 *
 * 四个边界必须严格递增，第五段要求 MusicEnd 晚于末段起点。这是预览器的校验，客户端不做：
 * 数据不合格时直接报错，不估算。
 */
export function feverFromMusicScore(csv: string, sectionNo: number): FeverWindow {
  if (!Number.isInteger(sectionNo) || sectionNo < 1 || sectionNo > 5) throw new Error('FeverSectionNo 必须为 1～5');
  const rows = csv.replace(/^﻿/, '').trim().split(/\r?\n/).map(line => line.split(','));
  const header = rows.shift() ?? [];
  const timeColumn = header.indexOf('song_time'), typeColumn = header.indexOf('key_type');
  if (timeColumn < 0 || typeColumn < 0) throw new Error('CSV 缺少 song_time / key_type');
  const boundaries = rows.filter(row => row[typeColumn]?.trim() === '20').map(row => {
    const value = row[timeColumn]?.trim();
    return value ? Number(value) : NaN;
  }).sort((a, b) => a - b);
  if (boundaries.length !== 4 || boundaries.some((t, i) => !Number.isFinite(t) || t <= (i ? boundaries[i - 1] : 0))) {
    throw new Error('CSV 必须包含四个严格递增的分段边界');
  }
  const endText = rows.filter(row => row[typeColumn]?.trim() === '99').at(-1)?.[timeColumn]?.trim();
  const musicEnd = endText ? Number(endText) : NaN;
  if (sectionNo === 5 && (!Number.isFinite(musicEnd) || musicEnd <= boundaries[3])) {
    throw new Error('第五段需要晚于末段起点的 MusicEnd（key_type=99）');
  }
  const times = [0, ...boundaries, musicEnd];
  return { start: times[sectionNo - 1] / 1000, end: times[sectionNo] / 1000 };
}
