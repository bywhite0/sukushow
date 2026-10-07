import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 用最小替身代替 Mediabunny 与 WebCodecs，只验证 exportVideo 对帧源的调用契约（无音轨路径）
vi.mock('mediabunny', () => {
  class BufferTarget {
    buffer: ArrayBuffer | null = new ArrayBuffer(8)
  }
  class Output {
    addVideoTrack() {}
    addAudioTrack() {}
    async start() {}
    async finalize() {}
    async cancel() {}
    async getMimeType() {
      return 'video/mp4'
    }
  }
  class EncodedVideoPacketSource {
    async add() {}
  }
  class EncodedAudioPacketSource {
    async add() {}
  }
  class Mp4OutputFormat {}
  class WebMOutputFormat {}
  const EncodedPacket = { fromEncodedChunk: (chunk: unknown) => chunk }
  return { BufferTarget, Output, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, WebMOutputFormat }
})

import { ExportCancelledError, exportVideo, type ExportAudioSources, type ExportFrameSource, type ExportRequest } from '../src/exporter'

const frames: FakeVideoFrame[] = []
let failEncode = false

class FakeVideoFrame {
  closed = false
  constructor() {
    frames.push(this)
  }
  close() {
    this.closed = true
  }
}

class FakeVideoEncoder {
  static async isConfigSupported() {
    return { supported: true }
  }
  state = 'unconfigured'
  encodeQueueSize = 0
  configure() {
    this.state = 'configured'
  }
  encode() {
    if (failEncode) throw new Error('encode failed')
  }
  async flush() {}
  close() {
    this.state = 'closed'
  }
  addEventListener() {}
}

class FakeAudioEncoder {
  // 不支持任何音频配置：导出走无音轨路径，不进入离线混音
  static async isConfigSupported() {
    return { supported: false }
  }
}

beforeEach(() => {
  frames.length = 0
  failEncode = false
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder)
  vi.stubGlobal('AudioEncoder', FakeAudioEncoder)
  vi.stubGlobal('OfflineAudioContext', class {})
  vi.stubGlobal('VideoFrame', FakeVideoFrame)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const request: ExportRequest = { container: 'mp4', width: 1280, height: 720, fps: 30, bitrateMbps: 12, startSec: -1, endSec: 0 }

const silentAudio = (): ExportAudioSources => ({ events: [], bgm: null, bgmStartSec: 0, bgmVolume: 0, soundVolume: 1, soundBuffers: new Map() })

/** 记录调用顺序的帧源；可按场景替换单个方法。 */
function recordingSource(overrides: Partial<ExportFrameSource> = {}) {
  const calls: [string, ...unknown[]][] = []
  const source: ExportFrameSource = {
    canvas: {} as HTMLCanvasElement,
    begin: (...args) => {
      calls.push(['begin', ...args])
    },
    renderAt: (t) => {
      calls.push(['renderAt', t])
    },
    collectAudio: (endSec) => {
      calls.push(['collectAudio', endSec])
      return silentAudio()
    },
    end: () => {
      calls.push(['end'])
    },
    ...overrides,
  }
  return { source, calls }
}

describe('exportVideo frame source contract', () => {
  it('begins with size, start time and fps, then renders frames on the virtual clock', async () => {
    const { source, calls } = recordingSource()
    const result = await exportVideo(source, request)
    expect(calls[0]).toEqual(['begin', 1280, 720, -1, 30])
    const times = calls.filter((call) => call[0] === 'renderAt').map((call) => call[1] as number)
    expect(times).toHaveLength(30)
    expect(times[0]).toBe(-1)
    expect(times[29]).toBeCloseTo(-1 + 29 / 30, 12)
    expect(result.frameCount).toBe(30)
    expect(frames.every((frame) => frame.closed)).toBe(true)
  })

  it('passes the clip end to collectAudio and ends the source exactly once, last', async () => {
    const { source, calls } = recordingSource()
    await exportVideo(source, request)
    const collect = calls.find((call) => call[0] === 'collectAudio')
    expect(collect?.[1]).toBeCloseTo(0, 12)
    expect(calls.filter((call) => call[0] === 'end')).toHaveLength(1)
    expect(calls.at(-1)).toEqual(['end'])
  })

  it('accepts a source that ignores the extra begin and collectAudio arguments', async () => {
    const begin = vi.fn((_width: number, _height: number) => {})
    const end = vi.fn()
    const source: ExportFrameSource = { canvas: {} as HTMLCanvasElement, begin, renderAt: () => {}, collectAudio: () => silentAudio(), end }
    await exportVideo(source, request)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('restores the source when begin throws', async () => {
    const end = vi.fn()
    const { source } = recordingSource({
      begin: () => {
        throw new Error('begin failed')
      },
      end,
    })
    await expect(exportVideo(source, request)).rejects.toThrow('begin failed')
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('honours cancellation during an async begin without rendering any frame', async () => {
    const controller = new AbortController()
    const renderAt = vi.fn()
    const end = vi.fn()
    const { source } = recordingSource({
      begin: async () => {
        controller.abort()
      },
      renderAt,
      end,
    })
    await expect(exportVideo(source, { ...request, signal: controller.signal })).rejects.toBeInstanceOf(ExportCancelledError)
    expect(renderAt).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('closes the video frame when the encoder throws', async () => {
    failEncode = true
    const end = vi.fn()
    const { source } = recordingSource({ end })
    await expect(exportVideo(source, request)).rejects.toThrow('encode failed')
    expect(frames).toHaveLength(1)
    expect(frames[0]!.closed).toBe(true)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('rejects an empty range before touching the source', async () => {
    const { source, calls } = recordingSource()
    await expect(exportVideo(source, { ...request, startSec: 5, endSec: 5 })).rejects.toThrow('导出区间为空')
    expect(calls).toEqual([])
  })
})
