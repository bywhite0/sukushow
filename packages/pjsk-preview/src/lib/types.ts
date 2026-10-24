export type PreviewRuntimeConfig = {
  mirror: boolean
  flickAnimation: boolean
  holdAnimation: boolean
  simultaneousLine: boolean
  effectProfile: 0 | 1
  noteSkin: 0 | 1
  noteSpeed: number
  holdAlpha: number
  guideAlpha: number
  stageCover: number
  stageOpacity: number
  backgroundBrightness: number
  effectOpacity: number
  bgmVolume: number
  soundVolume: number
}

/**
 * 谱面文本格式：
 *   - `llll`：llll 原生谱面（{Notes, Bpms}），本项目主路线
 *   - `custom-score-json`：wasm 直接消费的 MusicScoreMakerData（适配层产物）
 *   - `sus`：参考项目遗留格式，本仓库不支持（保留类型以免下游断言炸掉）
 */
export type ScoreTextFormat = 'llll' | 'custom-score-json' | 'sus'

export type TransportState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error'

export type SessionMetadata = {
  title: string | null
  lyricist: string | null
  composer: string | null
  arranger: string | null
  vocal: string | null
  difficulty: string | null
  customScoreInfo: boolean
  scoreTitle: string | null
  scoreCreator: string | null
}

export type WasmPlayerSnapshot = {
  currentTimeSec: number
  durationSec: number
  chartEndSec: number
  sourceOffsetSec: number
  effectiveLeadInSec: number
  audioStartDelaySec: number
  apStartSec: number
  transportState: TransportState
  requiresGesture: boolean
  hasAudio: boolean
  warnings: string
}
