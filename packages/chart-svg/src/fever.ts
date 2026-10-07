/**
 * Fever 时段——口径与 `packages/llll-preview` 的 `feverFromMusicScore` 一致。
 *
 * Fever 窗口**不在谱面文件里**，来自两处主数据：
 *   - `Musics.yaml` 的 `FeverSectionNo`（1～5）指明第几段
 *   - `musicscore_<id>.csv` 的 `key_type=20` 行给出分段边界（毫秒），`key_type=99` 给出曲末
 *
 * 段表 = `[0, ...边界, 曲末]`，窗口 = `[段表[N−1], 段表[N]]`。段表共 6 个点 → 5 段，
 * 全量 236 首谱面皆然。
 *
 * 注意「曲末」取 CSV 原始顺序里**最后一个** `key_type=99`，不是时间最大的那个。
 */

export interface FeverWindow {
  /** 起始时刻（秒）。 */
  start: number;
  /** 结束时刻（秒）。 */
  end: number;
}

/** 解析 `musicscore_*.csv` 的分段边界（毫秒）。 */
export function parseSectionBoundaries(csv: string): { boundaries: number[]; musicEnd: number } {
  const rows = csv.replace(/^\ufeff/, '').trim().split(/\r?\n/).map(line => line.split(','));
  const header = rows.shift() ?? [];
  const timeCol = header.indexOf('song_time'), typeCol = header.indexOf('key_type');
  if (timeCol < 0 || typeCol < 0) throw new Error('musicscore CSV 缺 song_time / key_type 列');

  const boundaries = rows
    .filter(row => row[typeCol]?.trim() === '20')
    .map(row => Number(row[timeCol]?.trim()))
    .sort((a, b) => a - b);
  if (boundaries.length !== 4 || boundaries.some((t, i) => !Number.isFinite(t) || t <= (i ? boundaries[i - 1] : 0))) {
    throw new Error('musicscore CSV 必须有四个严格递增的分段边界');
  }

  // 客户端取 CSV 原始顺序中的最后一个 MusicEnd，不是最大时间。
  const endText = rows.filter(row => row[typeCol]?.trim() === '99').at(-1)?.[timeCol]?.trim();
  const musicEnd = endText ? Number(endText) : NaN;
  if (!Number.isFinite(musicEnd) || musicEnd <= boundaries[3]) {
    throw new Error('musicscore CSV 的 MusicEnd（key_type=99）必须晚于末段起点');
  }
  return { boundaries, musicEnd };
}

/** 由分段表与 `FeverSectionNo` 算 Fever 窗口（秒）。 */
export function feverWindow(csv: string, sectionNo: number): FeverWindow {
  if (!Number.isInteger(sectionNo) || sectionNo < 1 || sectionNo > 5) {
    throw new Error(`FeverSectionNo 必须为 1～5（收到 ${sectionNo}）`);
  }
  const { boundaries, musicEnd } = parseSectionBoundaries(csv);
  const times = [0, ...boundaries, musicEnd];
  return { start: times[sectionNo - 1] / 1000, end: times[sectionNo] / 1000 };
}

/** 某时刻是否落在 Fever 窗内（左闭右开，与 `isFeverAt` 同口径）。 */
export function isFeverAt(time: number, win: FeverWindow | null | undefined): boolean {
  return !!win && time >= win.start && time < win.end;
}
