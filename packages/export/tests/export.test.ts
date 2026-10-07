import { describe, expect, it } from 'vitest'
import { VirtualClock, resolveExportRange, type OpeningSpan } from '../src/clock'
import { loopPhaseToOffset, loopPointsFor, mixFrameCount, mixSegments, scheduleSoundEvents, type CapturedSoundEvent } from '../src/audioMix'
import {
  RESOLUTION_PRESETS,
  audioEncoderCandidates,
  avcCodecString,
  buildVideoEncoderConfig,
  defaultBitrateMbps,
  exportFileName,
  h264Level,
  vp9CodecString,
} from '../src/presets'

describe('VirtualClock', () => {
  it('frame times come from the integer index (no drift)', () => {
    const clock = new VirtualClock(10, 70, 60)
    expect(clock.frameCount).toBe(3600)
    expect(clock.timeAt(0)).toBe(10)
    expect(clock.timeAt(3599)).toBeCloseTo(10 + 3599 / 60, 12)
    expect(clock.durationSec).toBe(60)
  })

  it('timestamps are strictly increasing and durations sum to the total', () => {
    const clock = new VirtualClock(0, 3, 30)
    expect(clock.frameCount).toBe(90)
    let sum = 0
    for (let i = 0; i < clock.frameCount; i += 1) {
      expect(clock.timestampUs(i + 1)).toBeGreaterThan(clock.timestampUs(i))
      sum += clock.frameDurationUs(i)
    }
    expect(sum).toBe(3_000_000)
    expect(clock.timestampUs(1)).toBe(33333)
  })

  it('rounds partial frames and rejects invalid fps', () => {
    expect(new VirtualClock(0, 1.01, 30).frameCount).toBe(30)
    expect(new VirtualClock(5, 4, 30).frameCount).toBe(0)
    expect(() => new VirtualClock(0, 1, 0)).toThrow()
  })
})

describe('resolveExportRange', () => {
  // 两种写死的开场：走带时间轴上负时刻的开场过场，输出时间轴开头的开场卡片
  const intro: OpeningSpan = { startSec: -3.6666667461395264, endSec: 0 }
  const card: OpeningSpan = { startSec: 0, endSec: 4 }

  it('defaults to the opening start when the opening is included', () => {
    expect(resolveExportRange({}, 120, card, true)).toEqual({ startSec: 0, endSec: 120 })
    expect(resolveExportRange({}, 120, intro, true)).toEqual({ startSec: intro.startSec, endSec: 120 })
  })

  it('starts from the opening end when the opening is excluded', () => {
    expect(resolveExportRange({}, 120, card, false)).toEqual({ startSec: 4, endSec: 120 })
    expect(resolveExportRange({ startSec: 0 }, 120, card, false).startSec).toBe(4)
    expect(resolveExportRange({ startSec: -2 }, 120, intro, false).startSec).toBe(0)
  })

  it('clamps starts below the floor and keeps starts inside the range', () => {
    expect(resolveExportRange({ startSec: -10 }, 120, intro, true).startSec).toBe(intro.startSec)
    expect(resolveExportRange({ startSec: -3.667 }, 120, intro, true).startSec).toBe(intro.startSec)
    expect(resolveExportRange({ startSec: 30 }, 120, intro, true).startSec).toBe(30)
    expect(resolveExportRange({ startSec: 30 }, 120, card, false).startSec).toBe(30)
  })

  it('clamps to duration and never ends before the start', () => {
    expect(resolveExportRange({ startSec: -3, endSec: 999 }, 120, card, true)).toEqual({ startSec: 0, endSec: 120 })
    expect(resolveExportRange({ startSec: 50, endSec: 40 }, 120, card, true)).toEqual({ startSec: 50, endSec: 50 })
  })

  it('handles songs shorter than the opening and invalid durations', () => {
    expect(resolveExportRange({}, 2, card, false)).toEqual({ startSec: 2, endSec: 2 })
    expect(resolveExportRange({}, Number.NaN, card, true)).toEqual({ startSec: 0, endSec: 0 })
  })
})

describe('scheduleSoundEvents', () => {
  const durations = new Map([
    ['tap', 0.5],
    ['hold', 2.0],
    ['allPerfect', 10.28],
  ])
  const oneShot = (key: string, startSec: number, gain = 1): CapturedSoundEvent => ({ type: 'oneShot', key, gain, startSec, endSec: -1, offsetSec: 0 })
  const loop = (startSec: number, endSec: number): CapturedSoundEvent => ({ type: 'loop', key: 'hold', gain: 0.8, startSec, endSec, offsetSec: 0 })

  it('maps output time onto the clip and sorts', () => {
    const out = scheduleSoundEvents([oneShot('tap', 12), oneShot('tap', 10.5)], 10, 20, durations)
    expect(out.map((item) => item.whenSec)).toEqual([0.5, 2])
    expect(out[0]).toMatchObject({ type: 'oneShot', offsetSec: 0, stopSec: -1 })
  })

  it('carries one-shots that started before t0 into the sample offset and drops finished ones', () => {
    const out = scheduleSoundEvents([oneShot('allPerfect', 7), oneShot('tap', 9)], 10, 20, durations)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'allPerfect', whenSec: 0 })
    expect(out[0]!.offsetSec).toBeCloseTo(3, 9)
  })

  it('drops events at/after t1, silent gains and unknown keys', () => {
    const out = scheduleSoundEvents([oneShot('tap', 20), oneShot('tap', 11, 0), oneShot('nope', 11)], 10, 20, durations)
    expect(out).toEqual([])
  })

  it('clips loops to the range and resumes loops already running at t0', () => {
    const out = scheduleSoundEvents([loop(8, 12), loop(15, 25), loop(5, 9)], 10, 20, durations)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: 'loop', whenSec: 0, offsetSec: 2, stopSec: 2 })
    expect(out[1]).toMatchObject({ type: 'loop', whenSec: 5, offsetSec: 0, stopSec: 10 })
  })

  it('cuts one-shots that were stopped mid-way (seek) and drops those stopped before t0', () => {
    const cut = (startSec: number, endSec: number): CapturedSoundEvent => ({ type: 'oneShot', key: 'allPerfect', gain: 1, startSec, endSec, offsetSec: 0 })
    const out = scheduleSoundEvents([cut(9, 12), cut(8, 9.5)], 10, 20, durations)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ whenSec: 0, stopSec: 2 })
    expect(out[0]!.offsetSec).toBeCloseTo(1, 9)
  })

  it('plays one-shots to the end when endSec is -1 or +Infinity', () => {
    const open = (endSec: number): CapturedSoundEvent => ({ type: 'oneShot', key: 'tap', gain: 1, startSec: 11, endSec, offsetSec: 0 })
    const out = scheduleSoundEvents([open(-1), open(Number.POSITIVE_INFINITY)], 10, 20, durations)
    expect(out.map((item) => item.stopSec)).toEqual([-1, -1])
  })

  it('plays the whole buffer when loop points are null', () => {
    expect(loopPhaseToOffset(2.5, 2, null)).toBeCloseTo(0.5, 9)
    expect(loopPhaseToOffset(0.25, 2, null)).toBeCloseTo(0.25, 9)
  })

  it('uses the same guarded loop points as live playback', () => {
    expect(loopPointsFor(6000, 48000)).toBeNull()
    expect(loopPointsFor(48000, 48000)).toEqual({ loopStart: 3000 / 48000, loopEnd: 45000 / 48000 })
    const points = { loopStart: 0.1, loopEnd: 0.9 }
    expect(loopPhaseToOffset(0.5, 1, points)).toBeCloseTo(0.5, 9)
    expect(loopPhaseToOffset(1.3, 1, points)).toBeCloseTo(0.1 + (1.2 % 0.8), 9)
  })
})

describe('mix segments', () => {
  it('counts the clip frames like the whole-clip render', () => {
    expect(mixFrameCount(25, 48000)).toBe(1_200_000)
    expect(mixFrameCount(0.2, 48000)).toBe(9600)
    expect(mixFrameCount(0, 48000)).toBe(1)
  })

  it('covers the clip with contiguous integer-frame segments', () => {
    const segments = mixSegments(1_200_000, 480_000)
    expect(segments).toEqual([
      { startFrame: 0, frameCount: 480_000 },
      { startFrame: 480_000, frameCount: 480_000 },
      { startFrame: 960_000, frameCount: 240_000 },
    ])
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.startFrame).toBe(segments[i - 1]!.startFrame + segments[i - 1]!.frameCount)
    }
  })

  it('uses a single segment for short clips and never returns empty segments', () => {
    expect(mixSegments(9600, 480_000)).toEqual([{ startFrame: 0, frameCount: 9600 }])
    expect(mixSegments(1_000, 0.5)).toHaveLength(1000)
    expect(mixSegments(0, 480_000)).toEqual([])
  })
})

describe('presets', () => {
  it('contains the requested resolutions', () => {
    expect(RESOLUTION_PRESETS.map((preset) => `${preset.group} ${preset.width}x${preset.height}`)).toEqual([
      '16:9 1280x720',
      '16:9 1920x1080',
      '16:9 3840x2160',
      '19.5:9 2340x1080',
      '20:9 2400x1080',
      '16:10 1920x1200',
      '16:10 2560x1600',
      '4:3 1440x1080',
      '4:3 2048x1536',
    ])
    for (const preset of RESOLUTION_PRESETS) {
      expect(preset.width % 2).toBe(0)
      expect(preset.height % 2).toBe(0)
    }
  })

  it('picks default bitrates around 12 / 20 / 45 Mbps', () => {
    expect(defaultBitrateMbps(1280, 720, 30)).toBe(12)
    expect(defaultBitrateMbps(1920, 1080, 30)).toBe(12)
    expect(defaultBitrateMbps(1920, 1080, 60)).toBe(20)
    expect(defaultBitrateMbps(2560, 1600, 30)).toBe(20)
    expect(defaultBitrateMbps(3840, 2160, 30)).toBe(45)
  })

  it('chooses H.264 levels from the frame-size / macroblock-rate / bitrate limits', () => {
    expect(h264Level(1280, 720, 30, 12e6)).toBe(31)
    expect(h264Level(1280, 720, 60, 20e6)).toBe(32)
    expect(h264Level(1920, 1080, 30, 12e6)).toBe(40)
    expect(h264Level(1920, 1080, 30, 45e6)).toBe(41)
    expect(h264Level(1920, 1080, 60, 20e6)).toBe(42)
    expect(h264Level(2400, 1080, 30, 12e6)).toBe(50)
    expect(h264Level(3840, 2160, 30, 45e6)).toBe(51)
    expect(h264Level(3840, 2160, 60, 45e6)).toBe(52)
    expect(avcCodecString(1920, 1080, 60, 20e6)).toBe('avc1.64002A')
  })

  it('chooses VP9 levels from picture size and sample rate', () => {
    expect(vp9CodecString(1280, 720, 30)).toBe('vp09.00.31.08')
    expect(vp9CodecString(1920, 1080, 60)).toBe('vp09.00.41.08')
    expect(vp9CodecString(3840, 2160, 30)).toBe('vp09.00.50.08')
    expect(vp9CodecString(3840, 2160, 60)).toBe('vp09.00.51.08')
  })

  it('builds encoder configs per container', () => {
    const mp4 = buildVideoEncoderConfig({ container: 'mp4', width: 1280, height: 720, fps: 30, bitrateMbps: 12 })
    expect(mp4).toMatchObject({ codec: 'avc1.64001F', width: 1280, height: 720, framerate: 30, bitrate: 12_000_000, avc: { format: 'avc' } })
    const webm = buildVideoEncoderConfig({ container: 'webm', width: 1280, height: 720, fps: 30, bitrateMbps: 12 })
    expect(webm.codec).toBe('vp09.00.31.08')
    expect(webm.avc).toBeUndefined()
    expect(audioEncoderCandidates('mp4').map((item) => item.codec)).toEqual(['aac', 'opus'])
    expect(audioEncoderCandidates('webm').map((item) => item.codec)).toEqual(['opus'])
  })

  it('makes safe file names with the caller fallback', () => {
    expect(exportFileName('a/b:c', { container: 'mp4', width: 1280, height: 720, fps: 30, bitrateMbps: 12 }, 'llll-preview')).toBe('a_b_c_1280x720_30fps.mp4')
    expect(exportFileName('  ', { container: 'webm', width: 1920, height: 1080, fps: 60, bitrateMbps: 20 }, 'llll-preview')).toBe('llll-preview_1920x1080_60fps.webm')
    expect(exportFileName('', { container: 'mp4', width: 1280, height: 720, fps: 30, bitrateMbps: 12 }, 'pjsk-preview')).toBe('pjsk-preview_1280x720_30fps.mp4')
  })
})