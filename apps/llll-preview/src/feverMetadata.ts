import type { FeverWindow } from './fever';

export type FeverIndex = Record<string, FeverWindow>;

export function parseFeverWindow(startText: string, endText: string): FeverWindow | null {
  if (!startText.trim() && !endText.trim()) return null;
  const start = Number(startText), end = Number(endText);
  if (!startText.trim() || !endText.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    throw new Error('Fever 时段需满足 0 ≤ 开始 < 结束（秒）；同时留空则关闭。');
  }
  return { start, end };
}

export function feverForFilename(filename: string, index: FeverIndex): FeverWindow | null {
  const id = /^rhythmgame_chart_(\d+)_\d+\.(?:bytes|json)$/i.exec(filename)?.[1];
  const win = id ? index[id] : undefined;
  return win ? { ...win } : null;
}

/** 原始 musicscore CSV 的 20 事件为分段边界；时间单位为毫秒。 */
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
  // 客户端取 CSV 原始顺序中的最后一个 MusicEnd，不取最大时间。
  const endText = rows.filter(row => row[typeColumn]?.trim() === '99').at(-1)?.[timeColumn]?.trim();
  const musicEnd = endText ? Number(endText) : NaN;
  if (sectionNo === 5 && (!Number.isFinite(musicEnd) || musicEnd <= boundaries[3])) {
    throw new Error('第五段需要晚于末段起点的 MusicEnd（key_type=99）');
  }
  const times = [0, ...boundaries, musicEnd];
  return { start: times[sectionNo - 1] / 1000, end: times[sectionNo] / 1000 };
}
