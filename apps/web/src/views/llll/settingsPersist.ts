/** Persist preview sidebar / transport settings in localStorage. */

import {
  FLAT_JUDGE_DEFAULT, FLAT_JUDGE_MAX, FLAT_JUDGE_MIN, FLAT_TRACK_DEFAULT, FLAT_TRACK_MAX, FLAT_TRACK_MIN,
} from '@sukushow/llll-preview/flatView';
import {
  ARC_CENTER_DEFAULT, ARC_CENTER_MAX, ARC_CENTER_MIN, ARC_RADIUS_DEFAULT, ARC_RADIUS_MAX, ARC_RADIUS_MIN,
} from '@sukushow/llll-preview/arcView';
import { RG_OPTION_DEFAULTS, RG_OPTION_RANGES } from '@sukushow/llll-preview/rgOptions';
import { DEFAULT_ASPECT, isAspectId, type AspectId } from './aspectRatio';
import { DEFAULT_PLAY_KEY_LAYOUT, sanitizePlayKeyLayout, type PlayKeyLayout } from './playKeys';

export const SETTINGS_STORAGE_KEY = 'llll-preview-web:settings:v1';

export type PreviewSettings = {
  /** ConfigResolver.Speed (= noteSpeed×0.1), range 1..20 */
  speed: number;
  offsetMs: number;
  /** 游玩模式的判定偏移（毫秒）：负值 = 判定提前，只影响手动判定的触摸时刻。 */
  playOffsetMs: number;
  /** 游玩模式的键盘键位：分区键与 Air 键（见 `playKeys.ts`）。 */
  playKeys: PlayKeyLayout;
  /** VolumeMusic 0..1 */
  volume: number;
  volumeNoteTap: number;
  volumeSe: number;
  volumeVoice: number;
  mirror: boolean;
  lines: boolean;
  noteStartZ: number;
  laneWidth: number;
  laneDarkness: number;
  backgroundDarkness: number;
  gridCount: number;
  targetFPS: number;
  judgementY: number;
  fastSlowY: number;
  enablePerfectPlus: boolean;
  enableApContinue: boolean;
  enableMusicVideo: boolean;
  enableRhythmSkillView: boolean;
  enableSkillCutin: boolean;
  enableFeverDisplay: boolean;
  /** 从头开播时先放开场过场（RhythmGameStart）。 */
  enableStartAnimation: boolean;
  /** 曲终横幅档位（GetResultIndex：0 AP、1 FC、2 Clear、3 Finish）；自动演奏恒为 AP，其余仅供预览。 */
  comboResult: 0 | 1 | 2 | 3;
  judgementOutput: number;
  fastSlow: number;
  totalAppeal: number;
  musicMasteryLevel: number;
  rankPreview: 'none' | 'D' | 'C' | 'B' | 'A' | 'S';
  techScore: 0 | 1 | 2;
  rate: number;
  /** Preview hit FX: current=直冲天上(+rotol/拖尾); limited=限速; full=限速+rotol+拖尾. */
  hitEffect: 'off' | 'current' | 'limited' | 'full';
  /** 预览窗口固定比例（顶栏按钮组）；free = 跟随窗口。 */
  aspectRatio: AspectId;
  /** 2D 俯视模式的轨道宽度（舞台宽的百分比）；越大相机越近、读谱窗口越短。 */
  flatTrackWidth: number;
  /** 2D 判定线位置（舞台高的百分比）；判定线贴图 / 边线近端 / 下落窗口一起移动。 */
  flatJudgeLine: number;
  /** SIF 半圆模式的判定弧半径（占 min(舞台宽, 16:9×舞台高) 的百分比）。 */
  sifRadius: number;
  /** SIF 半圆模式的圆心高度（舞台高的百分比）；圆心上下移动时相机跟着走。 */
  sifCenterY: number;
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  speed: RG_OPTION_DEFAULTS.speed,
  offsetMs: 0,
  playOffsetMs: 0,
  playKeys: DEFAULT_PLAY_KEY_LAYOUT,
  volume: 0.7,
  volumeNoteTap: 1,
  volumeSe: 1,
  volumeVoice: 1,
  mirror: RG_OPTION_DEFAULTS.isMirror,
  lines: RG_OPTION_DEFAULTS.enableSameTimeLine,
  noteStartZ: RG_OPTION_DEFAULTS.noteStartZ,
  laneWidth: RG_OPTION_DEFAULTS.laneWidth,
  laneDarkness: RG_OPTION_DEFAULTS.laneDarkness,
  backgroundDarkness: RG_OPTION_DEFAULTS.backgroundDarkness,
  gridCount: RG_OPTION_DEFAULTS.gridCount,
  targetFPS: RG_OPTION_DEFAULTS.targetFPS,
  judgementY: RG_OPTION_DEFAULTS.judgementY,
  fastSlowY: RG_OPTION_DEFAULTS.fastSlowY,
  enablePerfectPlus: RG_OPTION_DEFAULTS.enablePerfectPlus,
  enableApContinue: RG_OPTION_DEFAULTS.enableApContinue,
  enableMusicVideo: RG_OPTION_DEFAULTS.enableMusicVideo,
  enableRhythmSkillView: RG_OPTION_DEFAULTS.enableRhythmSkillView,
  enableSkillCutin: RG_OPTION_DEFAULTS.enableSkillCutin,
  enableFeverDisplay: RG_OPTION_DEFAULTS.enableFeverDisplay,
  enableStartAnimation: true,
  comboResult: 0,
  judgementOutput: RG_OPTION_DEFAULTS.judgementOutput,
  fastSlow: RG_OPTION_DEFAULTS.fastSlowThreshold,
  totalAppeal: 350_000,
  musicMasteryLevel: 0,
  rankPreview: 'none',
  techScore: RG_OPTION_DEFAULTS.technicalScoreDisplay,
  rate: 1,
  hitEffect: 'current',
  aspectRatio: DEFAULT_ASPECT,
  flatTrackWidth: FLAT_TRACK_DEFAULT,
  flatJudgeLine: FLAT_JUDGE_DEFAULT,
  sifRadius: ARC_RADIUS_DEFAULT,
  sifCenterY: ARC_CENTER_DEFAULT,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sanitizePreviewSettings(raw: unknown): PreviewSettings {
  const d = DEFAULT_PREVIEW_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };
  const o = raw as Record<string, unknown>;
  const num = (k: string, fallback: number) => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const bool = (k: string, fallback: boolean) => {
    const v = o[k];
    return typeof v === 'boolean' ? v : fallback;
  };
  const rank = o.rankPreview;
  const rankPreview =
    rank === 'D' || rank === 'C' || rank === 'B' || rank === 'A' || rank === 'S' || rank === 'none'
      ? rank
      : d.rankPreview;
  const tech = num('techScore', d.techScore);
  const speedRaw = num('speed', d.speed);
  // Migrate old default 6 → keep value but clamp to game range 1..20
  return {
    speed: clamp(speedRaw, 1, 20),
    offsetMs: clamp(num('offsetMs', d.offsetMs), -10_000, 10_000),
    playOffsetMs: clamp(Math.trunc(num('playOffsetMs', d.playOffsetMs)), -200, 200),
    playKeys: sanitizePlayKeyLayout(o.playKeys),
    volume: clamp(num('volume', d.volume), 0, 1),
    volumeNoteTap: clamp(num('volumeNoteTap', d.volumeNoteTap), 0, 1),
    volumeSe: clamp(num('volumeSe', d.volumeSe), 0, 1),
    volumeVoice: clamp(num('volumeVoice', d.volumeVoice), 0, 1),
    mirror: bool('mirror', d.mirror),
    lines: bool('lines', d.lines),
    noteStartZ: clamp(Math.trunc(num('noteStartZ', d.noteStartZ)), RG_OPTION_RANGES.noteStartZ.min, RG_OPTION_RANGES.noteStartZ.max),
    laneWidth: clamp(Math.trunc(num('laneWidth', d.laneWidth)), RG_OPTION_RANGES.laneWidth.min, RG_OPTION_RANGES.laneWidth.max),
    laneDarkness: clamp(Math.trunc(num('laneDarkness', d.laneDarkness)), RG_OPTION_RANGES.laneDarkness.min, RG_OPTION_RANGES.laneDarkness.max),
    backgroundDarkness: clamp(Math.trunc(num('backgroundDarkness', d.backgroundDarkness)), RG_OPTION_RANGES.backgroundDarkness.min, RG_OPTION_RANGES.backgroundDarkness.max),
    gridCount: clamp(Math.trunc(num('gridCount', d.gridCount)), 0, 5),
    targetFPS: clamp(Math.trunc(num('targetFPS', d.targetFPS)), 0, 1),
    judgementY: clamp(Math.trunc(num('judgementY', d.judgementY)), 1, 10),
    fastSlowY: clamp(Math.trunc(num('fastSlowY', d.fastSlowY)), 1, 10),
    enablePerfectPlus: bool('enablePerfectPlus', d.enablePerfectPlus),
    enableApContinue: bool('enableApContinue', d.enableApContinue),
    enableMusicVideo: bool('enableMusicVideo', d.enableMusicVideo),
    enableRhythmSkillView: bool('enableRhythmSkillView', d.enableRhythmSkillView),
    enableSkillCutin: bool('enableSkillCutin', d.enableSkillCutin),
    enableFeverDisplay: bool('enableFeverDisplay', d.enableFeverDisplay),
    enableStartAnimation: bool('enableStartAnimation', d.enableStartAnimation),
    comboResult: (() => { const v = Math.trunc(num('comboResult', d.comboResult)); return (v === 1 || v === 2 || v === 3 ? v : 0) as 0 | 1 | 2 | 3; })(),
    judgementOutput: clamp(Math.trunc(num('judgementOutput', d.judgementOutput)), 0, 6),
    fastSlow: clamp(Math.trunc(num('fastSlow', d.fastSlow)), 0, 2),
    totalAppeal: clamp(num('totalAppeal', d.totalAppeal), 1000, 2_000_000),
    musicMasteryLevel: clamp(Math.trunc(num('musicMasteryLevel', d.musicMasteryLevel)), 0, 50),
    rankPreview,
    techScore: (tech === 1 || tech === 2 ? tech : 0) as 0 | 1 | 2,
    rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(num('rate', d.rate))
      ? num('rate', d.rate)
      : d.rate,
    hitEffect: o.hitEffect === 'off' || o.hitEffect === 'current' || o.hitEffect === 'limited' || o.hitEffect === 'full' ? o.hitEffect : d.hitEffect,
    aspectRatio: isAspectId(o.aspectRatio) ? o.aspectRatio : d.aspectRatio,
    flatTrackWidth: clamp(Math.trunc(num('flatTrackWidth', d.flatTrackWidth)), FLAT_TRACK_MIN, FLAT_TRACK_MAX),
    flatJudgeLine: clamp(Math.trunc(num('flatJudgeLine', d.flatJudgeLine)), FLAT_JUDGE_MIN, FLAT_JUDGE_MAX),
    sifRadius: clamp(Math.trunc(num('sifRadius', d.sifRadius)), ARC_RADIUS_MIN, ARC_RADIUS_MAX),
    sifCenterY: clamp(Math.trunc(num('sifCenterY', d.sifCenterY)), ARC_CENTER_MIN, ARC_CENTER_MAX),
  };
}

export function loadPreviewSettings(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): PreviewSettings {
  if (!storage) return { ...DEFAULT_PREVIEW_SETTINGS };
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREVIEW_SETTINGS };
    return sanitizePreviewSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREVIEW_SETTINGS };
  }
}

export function savePreviewSettings(
  settings: PreviewSettings,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizePreviewSettings(settings)));
  } catch {
    /* quota / private mode */
  }
}
