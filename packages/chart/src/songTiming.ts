/**
 * 曲目时间索引：按曲目 Id 查 Fever 时段、FeverChance 代理窗口与曲终时刻（秒）。
 *
 * 索引由 `scripts/build-song-timing.ts` 从主数据 `Musics.yaml` 与 `musicscore_<Id>.csv` 生成：
 * - Fever：`feverFromMusicScore` 的窗口。
 * - FeverChance：llll 没有这个概念，取 Fever 前一段作代理值，只用于视觉近似；
 *   Fever 是第一段时没有前一段，为 null。
 * - 曲终 FinishTime：`Musics.PlayTime / 1000`。节奏游戏在当前时刻达到它时进入结算，
 *   与 CSV 的 MusicEnd 不一定相等。
 * 未收录的曲目一律返回 null，不估算。
 */

import type { FeverWindow } from './fever';
import songTiming from './songTiming.json';

export interface SongTimingEntry {
  start: number;
  end: number;
  chanceStart: number | null;
  chanceEnd: number | null;
  finishTime: number;
}

export type SongTimingIndex = Record<string, SongTimingEntry>;

const INDEX = songTiming as SongTimingIndex;

type SongId = string | number | null | undefined;

function entry(songId: SongId, index: SongTimingIndex): SongTimingEntry | undefined {
  return songId === null || songId === undefined || songId === '' ? undefined : index[String(songId)];
}

export function feverForSong(songId: SongId, index = INDEX): FeverWindow | null {
  const e = entry(songId, index);
  return e ? { start: e.start, end: e.end } : null;
}

export function feverChanceForSong(songId: SongId, index = INDEX): FeverWindow | null {
  const e = entry(songId, index);
  return e && e.chanceStart !== null && e.chanceEnd !== null ? { start: e.chanceStart, end: e.chanceEnd } : null;
}

export function finishTimeForSong(songId: SongId, index = INDEX): number | null {
  return entry(songId, index)?.finishTime ?? null;
}
