/** Persist preview sidebar / transport settings in localStorage. */

export const SETTINGS_STORAGE_KEY = 'llll-preview-web:settings:v1';

export type PreviewSettings = {
  speed: number;
  offsetMs: number;
  volume: number;
  mirror: boolean;
  lines: boolean;
  enablePerfectPlus: boolean;
  judgementOutput: number;
  fastSlow: number;
  totalAppeal: number;
  musicMasteryLevel: number;
  rankPreview: 'none' | 'D' | 'C' | 'B' | 'A' | 'S';
  techScore: 0 | 1 | 2;
  rate: number;
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  speed: 6,
  offsetMs: 0,
  volume: 0.7,
  mirror: false,
  lines: true,
  enablePerfectPlus: false,
  judgementOutput: 0,
  fastSlow: 0,
  totalAppeal: 350_000,
  musicMasteryLevel: 0,
  rankPreview: 'none',
  techScore: 0,
  rate: 1,
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
  return {
    speed: clamp(num('speed', d.speed), 1, 15),
    offsetMs: clamp(num('offsetMs', d.offsetMs), -10_000, 10_000),
    volume: clamp(num('volume', d.volume), 0, 1),
    mirror: bool('mirror', d.mirror),
    lines: bool('lines', d.lines),
    enablePerfectPlus: bool('enablePerfectPlus', d.enablePerfectPlus),
    judgementOutput: clamp(Math.trunc(num('judgementOutput', d.judgementOutput)), 0, 6),
    fastSlow: clamp(Math.trunc(num('fastSlow', d.fastSlow)), 0, 2),
    totalAppeal: clamp(num('totalAppeal', d.totalAppeal), 1000, 2_000_000),
    musicMasteryLevel: clamp(Math.trunc(num('musicMasteryLevel', d.musicMasteryLevel)), 0, 50),
    rankPreview,
    techScore: (tech === 1 || tech === 2 ? tech : 0) as 0 | 1 | 2,
    rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(num('rate', d.rate))
      ? num('rate', d.rate)
      : d.rate,
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
