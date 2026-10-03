/** PJSK 视图设置持久化；字段对应 native 的 `setPlayerPreviewConfig`。 */

export const SETTINGS_STORAGE_KEY = 'llll-pjsk-preview:settings:v1'

export type PreviewSettings = {
  /** 下落速度，对应 wasm 的 noteSpeed（1..12） */
  noteSpeed: number
  /** 音频偏移（毫秒），正值让音频晚于谱面开始 */
  offsetMs: number
  /** 左右镜像 */
  mirror: boolean
  /** 同时押线 */
  lines: boolean
  flickAnimation: boolean
  holdAnimation: boolean
  /** 0 = Notes 01，1 = Notes 02 */
  noteSkin: 0 | 1
  /** 特效配置档，0 或 1 */
  effectProfile: 0 | 1
  /** 上隐（百分比 0..100） */
  stageCover: number
  /** 舞台不透明度（百分比 0..100） */
  stageOpacity: number
  /** 背景亮度（百分比 0..100） */
  backgroundBrightness: number
  /** 长条透明度（百分比 0..100） */
  holdAlpha: number
  /** Guide 浓度（百分比 0..100） */
  guideAlpha: number
  /** 特效不透明度（百分比 0..100） */
  effectOpacity: number
  /** Fever 显示（只影响特效，不改变逻辑状态） */
  feverDisplay: boolean
  /**
   * SuperFever 视觉开关。
   *
   * ⚠ llll 侧没有 superfever 的原版判定依据（PJSK 靠多人局人数），
   * 故由用户指定：开启后充能满（progress >= 1.0）即切到 super 版配色。
   */
  superFever: boolean
  /** BGM 音量（百分比 0..100） */
  bgmVolume: number
  /** 音效音量（百分比 0..100） */
  soundVolume: number
  rate: number
}

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  noteSpeed: 10.5,
  offsetMs: 0,
  mirror: false,
  lines: true,
  flickAnimation: true,
  holdAnimation: true,
  noteSkin: 0,
  effectProfile: 0,
  stageCover: 0,
  stageOpacity: 100,
  backgroundBrightness: 100,
  holdAlpha: 74,
  guideAlpha: 50,
  effectOpacity: 100,
  feverDisplay: true,
  superFever: false,
  bgmVolume: 100,
  soundVolume: 100,
  rate: 1,
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export function sanitizePreviewSettings(raw: unknown): PreviewSettings {
  const d = DEFAULT_PREVIEW_SETTINGS
  if (!raw || typeof raw !== 'object') return { ...d }
  const o = raw as Record<string, unknown>
  const num = (key: string, fallback: number) => {
    const value = o[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  const bool = (key: string, fallback: boolean) => {
    const value = o[key]
    return typeof value === 'boolean' ? value : fallback
  }
  const rateValue = num('rate', d.rate)

  return {
    noteSpeed: clamp(num('noteSpeed', d.noteSpeed), 1, 12),
    offsetMs: clamp(num('offsetMs', d.offsetMs), -10_000, 10_000),
    mirror: bool('mirror', d.mirror),
    lines: bool('lines', d.lines),
    flickAnimation: bool('flickAnimation', d.flickAnimation),
    holdAnimation: bool('holdAnimation', d.holdAnimation),
    noteSkin: num('noteSkin', d.noteSkin) === 1 ? 1 : 0,
    effectProfile: num('effectProfile', d.effectProfile) === 1 ? 1 : 0,
    stageCover: clamp(num('stageCover', d.stageCover), 0, 100),
    stageOpacity: clamp(num('stageOpacity', d.stageOpacity), 0, 100),
    backgroundBrightness: clamp(num('backgroundBrightness', d.backgroundBrightness), 0, 100),
    holdAlpha: clamp(num('holdAlpha', d.holdAlpha), 0, 100),
    guideAlpha: clamp(num('guideAlpha', d.guideAlpha), 0, 100),
    effectOpacity: clamp(num('effectOpacity', d.effectOpacity), 0, 100),
    feverDisplay: bool('feverDisplay', d.feverDisplay),
    superFever: bool('superFever', d.superFever),
    bgmVolume: clamp(num('bgmVolume', d.bgmVolume), 0, 100),
    soundVolume: clamp(num('soundVolume', d.soundVolume), 0, 100),
    rate: [0.5, 0.75, 1, 1.25, 1.5, 2].includes(rateValue) ? rateValue : d.rate,
  }
}

export function loadPreviewSettings(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): PreviewSettings {
  if (!storage) return { ...DEFAULT_PREVIEW_SETTINGS }
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREVIEW_SETTINGS }
    return sanitizePreviewSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREVIEW_SETTINGS }
  }
}

export function savePreviewSettings(
  settings: PreviewSettings,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
): void {
  if (!storage) return
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sanitizePreviewSettings(settings)))
  } catch {
    /* quota / private mode */
  }
}
