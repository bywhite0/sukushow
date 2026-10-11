export function chargeNotesInWindow(times: readonly number[], window: { start: number; end: number } | null): number[] {
  if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.end <= window.start) return []
  return times.filter(t => Number.isFinite(t) && t >= window.start && t < window.end).sort((a, b) => a - b)
}

export class FeverChargeTimeline {
  private readonly times: number[]
  private frames: { progress: number; flashStart: number | null }[] = []
  private progress = 0
  private next = 0
  private crossed: number | null = null

  constructor(times: readonly number[]) { this.times = times.filter(Number.isFinite).slice().sort((a, b) => a - b) }

  at(time: number): { progress: number; flashStart: number | null } {
    if (!Number.isFinite(time) || !this.times.length || time < this.times[0]) return { progress: 0, flashStart: null }
    const origin = Math.floor(this.times[0] * 60)
    const frame = Math.min(Math.floor(time * 60 + 1e-8), Math.ceil(this.times[this.times.length - 1] * 60) + 120) - origin
    for (let f = this.frames.length; f <= frame; f++) {
      const now = (origin + f) / 60
      while (this.next < this.times.length && this.times[this.next] <= now + 1e-9) this.next++
      const target = this.next / this.times.length
      this.progress += (target - this.progress) * .3
      if (this.progress > .7 && this.crossed === null) this.crossed = now
      this.frames.push({ progress: this.progress, flashStart: this.crossed })
    }
    return this.frames[frame] ?? { progress: 0, flashStart: null }
  }
}

/** 输入为按时间升序排列的 Fever 前音符；与 native 的 70% 阈值一致。 */
export function feverChargeStart(times: readonly number[]): number {
  return times.length ? times[0] : -1
}

/** 闪光在严格超过 Fever 阈值时触发；不能复用 Chance 的 >= 起点。 */
export function feverFlashStart(times: readonly number[]): number | null {
  return times.length ? times[Math.floor(times.length * 0.7)] : null
}
