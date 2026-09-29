/**
 * 导出用虚拟时钟：固定步长逐帧推进，与墙钟无关。
 *
 * 帧 i 的时刻 = t0 + i / fps（输出时间轴，含 lead-in）。时刻直接由整数帧号算出，
 * 不做浮点累加，长视频也不会漂移；时间戳（µs）同理由帧号算出，保证严格单调。
 */

/** HUD 开场卡片占用的输出时间（与 wasm HUD_INTRO_DURATION_SEC 一致）。 */
export const OPENING_CARD_DURATION_SEC = 4.0

export type ExportRange = {
  startSec: number
  endSec: number
}

/**
 * 规范化导出区间：夹到 [0, durationSec]；关闭开场卡片时起点不早于卡片结束。
 */
export function resolveExportRange(
  requested: Partial<ExportRange>,
  durationSec: number,
  includeOpening: boolean,
): ExportRange {
  const duration = Math.max(0, Number.isFinite(durationSec) ? durationSec : 0)
  const minStart = includeOpening ? 0 : Math.min(OPENING_CARD_DURATION_SEC, duration)
  let startSec = Number.isFinite(requested.startSec) ? Number(requested.startSec) : minStart
  let endSec = Number.isFinite(requested.endSec) ? Number(requested.endSec) : duration
  startSec = Math.min(Math.max(startSec, minStart), duration)
  endSec = Math.min(Math.max(endSec, startSec), duration)
  return { startSec, endSec }
}

export class VirtualClock {
  readonly fps: number
  readonly startSec: number
  readonly frameCount: number

  constructor(startSec: number, endSec: number, fps: number) {
    if (!(fps > 0)) throw new Error(`invalid fps: ${fps}`)
    this.fps = fps
    this.startSec = startSec
    this.frameCount = Math.max(0, Math.round((endSec - startSec) * fps))
  }

  /** 视频时长（秒）= 帧数 / fps。 */
  get durationSec() {
    return this.frameCount / this.fps
  }

  /** 第 index 帧对应的输出时刻（秒）。 */
  timeAt(index: number) {
    return this.startSec + index / this.fps
  }

  /** 第 index 帧的时间戳（µs，相对视频起点）。 */
  timestampUs(index: number) {
    return Math.round((index * 1_000_000) / this.fps)
  }

  /** 第 index 帧的时长（µs），相邻时间戳之差，累加后恰好等于总时长。 */
  frameDurationUs(index: number) {
    return this.timestampUs(index + 1) - this.timestampUs(index)
  }
}