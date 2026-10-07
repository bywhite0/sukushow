/**
 * 导出用虚拟时钟：固定步长逐帧推进，与墙钟无关。
 *
 * 帧 i 的时刻 = t0 + i / fps（走带时间轴）。时刻直接由整数帧号算出，
 * 不做浮点累加，长视频也不会漂移；时间戳（µs）同理由帧号算出，保证严格单调。
 *
 * 移植自 PJSK 实现 的导出模块（src/export/clock.ts），去掉了 pjsk 专用的开场卡片常量：
 * 可导出的最早时刻由调用方给出（llll：开场过场开启时为 −START_CLIP_DURATION，否则 0）。
 * 该模块与视图无关，供统一前端的导出流程复用。
 */

export type ExportRange = {
  startSec: number
  endSec: number
}

/**
 * 规范化导出区间：夹到 [minStartSec, durationSec]，终点不早于起点。
 */
export function resolveExportRange(
  requested: Partial<ExportRange>,
  durationSec: number,
  minStartSec = 0,
): ExportRange {
  const duration = Number.isFinite(durationSec) ? durationSec : 0
  const minStart = Math.min(Number.isFinite(minStartSec) ? minStartSec : 0, duration)
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

  /** 第 index 帧对应的走带时刻（秒）。 */
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
