/**
 * 导出音频：把导出期间收集到的音效事件（时间戳列表）与 BGM 离线混成一条 PCM。
 *
 * 事件口径：
 * - oneShot：在 startSec 开始，从素材 offsetSec 处播放；endSec 有限且晚于 startSec 时在该时刻截断，否则播完；
 * - loop：长按循环音，startSec ~ endSec 循环；循环点由 MixInput.loopPoints 给出，
 *   缺省用 loopPointsFor 的护边规则（素材超过 6000 帧时两端各留 3000 帧），返回 null 为整段循环；
 * - 单个事件的最终增益 = 事件 gain × soundVolume；
 * - BGM 在帧源时间轴的 bgmStartSec 处开始（音频偏移设置已折算在内）。
 */

export type CapturedSoundEvent = {
  type: 'oneShot' | 'loop'
  key: string
  gain: number
  startSec: number
  endSec: number
  offsetSec: number
}

export type ScheduledSound = {
  type: 'oneShot' | 'loop'
  key: string
  gain: number
  /** 相对导出起点的开始时刻（秒，≥0）。 */
  whenSec: number
  /** 素材内起始偏移（秒）。loop 为循环内相位偏移（相对素材开头）。 */
  offsetSec: number
  /** 相对导出起点的停止时刻（秒）；oneShot 为 -1 表示播完。 */
  stopSec: number
}

/**
 * 把输出时间轴上的事件换算到 [t0, t1) 的导出片段内。
 *
 * 起点早于 t0 的事件：oneShot 顺延素材偏移（素材已播完的丢弃），loop 从 t0 接上。
 * 起点不早于 t1 的事件丢弃。结果按开始时刻排序。
 */
export function scheduleSoundEvents(
  events: readonly CapturedSoundEvent[],
  t0: number,
  t1: number,
  durations: ReadonlyMap<string, number>,
): ScheduledSound[] {
  const out: ScheduledSound[] = []
  for (const event of events) {
    const duration = durations.get(event.key)
    if (duration === undefined || !(event.gain > 0)) continue
    if (event.startSec >= t1) continue
    if (event.type === 'oneShot') {
      const lateBy = Math.max(0, t0 - event.startSec)
      const offsetSec = Math.max(0, event.offsetSec) + lateBy
      if (offsetSec >= duration - 0.001) continue
      // 有限 endSec = 播放中被截断（例如跳转时停掉已发出的击中音）。
      const cut = Number.isFinite(event.endSec) && event.endSec > event.startSec ? event.endSec : Number.POSITIVE_INFINITY
      if (cut <= t0) continue
      out.push({
        type: 'oneShot',
        key: event.key,
        gain: event.gain,
        whenSec: Math.max(0, event.startSec - t0),
        offsetSec,
        stopSec: Number.isFinite(cut) && cut < t1 ? cut - t0 : -1,
      })
    } else {
      const endSec = Math.min(event.endSec, t1)
      if (endSec <= t0 || endSec - event.startSec <= 0.0001) continue
      const lateBy = Math.max(0, t0 - event.startSec)
      out.push({
        type: 'loop',
        key: event.key,
        gain: event.gain,
        whenSec: Math.max(0, event.startSec - t0),
        offsetSec: lateBy,
        stopSec: endSec - t0,
      })
    }
  }
  out.sort((a, b) => a.whenSec - b.whenSec)
  return out
}

/** 与实时 triggerExtendable 相同的循环护边。 */
export function loopPointsFor(lengthFrames: number, sampleRate: number): { loopStart: number; loopEnd: number } | null {
  if (lengthFrames <= 6000) return null
  const guardFrames = 3000
  return { loopStart: guardFrames / sampleRate, loopEnd: (lengthFrames - guardFrames) / sampleRate }
}

/** 循环播放到相位 phaseSec 时，对应素材内的位置（用于从中途接上的长按）。 */
export function loopPhaseToOffset(phaseSec: number, bufferDuration: number, loop: { loopStart: number; loopEnd: number } | null) {
  const loopStart = loop ? loop.loopStart : 0
  const loopEnd = loop ? loop.loopEnd : bufferDuration
  if (phaseSec < loopEnd || loopEnd - loopStart <= 1e-6) return Math.min(phaseSec, Math.max(0, bufferDuration - 0.001))
  return loopStart + ((phaseSec - loopStart) % (loopEnd - loopStart))
}

export type MixInput = {
  startSec: number
  durationSec: number
  sampleRate: number
  channels: number
  bgm: AudioBuffer | null
  /** BGM 在输出时间轴上的开始时刻。 */
  bgmStartSec: number
  bgmVolume: number
  soundVolume: number
  soundBuffers: ReadonlyMap<string, AudioBuffer>
  events: readonly CapturedSoundEvent[]
  /** 循环音的循环点；缺省用 loopPointsFor 的护边规则，返回 null 为整段循环。 */
  loopPoints?: (key: string, buffer: AudioBuffer) => { loopStart: number; loopEnd: number } | null
}

/** OfflineAudioContext 离线混音，返回整段 PCM。 */
export async function renderMix(input: MixInput): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(input.durationSec * input.sampleRate))
  const ctx = new OfflineAudioContext({ numberOfChannels: input.channels, length, sampleRate: input.sampleRate })
  const t0 = input.startSec
  const t1 = input.startSec + input.durationSec

  if (input.bgm && input.bgmVolume > 0) {
    const source = ctx.createBufferSource()
    source.buffer = input.bgm
    const gain = ctx.createGain()
    gain.gain.value = input.bgmVolume
    source.connect(gain).connect(ctx.destination)
    const lateBy = t0 - input.bgmStartSec
    if (lateBy >= 0) {
      if (lateBy < input.bgm.duration) source.start(0, lateBy)
    } else {
      source.start(-lateBy, 0)
    }
  }

  const durations = new Map<string, number>()
  for (const [key, buffer] of input.soundBuffers) durations.set(key, buffer.duration)
  const soundBus = ctx.createGain()
  soundBus.gain.value = input.soundVolume
  soundBus.connect(ctx.destination)
  for (const item of scheduleSoundEvents(input.events, t0, t1, durations)) {
    const buffer = input.soundBuffers.get(item.key)
    if (!buffer) continue
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = item.gain
    source.connect(gain).connect(soundBus)
    if (item.type === 'loop') {
      source.loop = true
      const points = input.loopPoints ? input.loopPoints(item.key, buffer) : loopPointsFor(buffer.length, buffer.sampleRate)
      if (points) {
        source.loopStart = points.loopStart
        source.loopEnd = points.loopEnd
      }
      source.start(item.whenSec, loopPhaseToOffset(item.offsetSec, buffer.duration, points))
      source.stop(item.stopSec)
    } else {
      source.start(item.whenSec, item.offsetSec)
      if (item.stopSec >= 0) source.stop(item.stopSec)
    }
  }
  return ctx.startRendering()
}