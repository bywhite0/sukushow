/** Persist preview sidebar / transport settings in localStorage. */

import { RG_OPTION_DEFAULTS, RG_OPTION_RANGES } from './rgOptions';

export const SETTINGS_STORAGE_KEY = 'llll-preview-web:settings:v1';

export type PreviewSettings = {
  /** ConfigResolver.Speed (= noteSpeed×0.1), range 1..20 */
  speed: number;
  offsetMs: number;
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
  judgementOutput: number;
  fastSlow: number;
  totalAppeal: number;
  musicMasteryLevel: number;
  rankPreview: 'none' | 'D' | 'C' | 'B' | 'A' | 'S';
  techScore: 0 | 1 | 2;
  rate: number;
  /** Preview hit FX: current=直冲天上(+rotol/拖尾); limited=限速; full=限速+rotol+拖尾. */
  hitEffect: 'off' | 'current' | 'limited' | 'full';
  /** MusicsRecord.FeverSectionNo (1-based); preview default 3. */
  feverSectionNo: number;
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  speed: RG_OPTION_DEFAULTS.speed,
  offsetMs: 0,
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
  judgementOutput: RG_OPTION_DEFAULTS.judgementOutput,
  fastSlow: RG_OPTION_DEFAULTS.fastSlowThreshold,
  totalAppeal: 350_000,
  musicMasteryLevel: 0,
  rankPreview: 'none',
  techScore: RG_OPTION_DEFAULTS.technicalScoreDisplay,
  rate: 1,
  hitEffect: 'current',
  feverSectionNo: 3,
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
    feverSectionNo: clamp(Math.trunc(num('feverSectionNo', d.feverSectionNo)), 1, 8),
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
