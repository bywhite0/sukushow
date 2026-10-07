import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 用最小替身代替 Mediabunny 与 WebCodecs，只验证 exportVideo 对帧源、写入目标与音频分段的调用契约
const mux = vi.hoisted(() => ({ targets: [] as unknown[] }))

vi.mock('mediabunny', () => {
  class BufferTarget {
    buffer: ArrayBuffer | null = new ArrayBuffer(8)
  }
  class StreamTarget {
    constructor(
      public writable: unknown,
      public options: unknown,
    ) {}
  }
  class Output {
    constructor(options: { target: unknown }) {
      mux.targets.push(options.target)
    }
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
  return { BufferTarget, StreamTarget, Output, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket, Mp4OutputFormat, WebMOutputFormat }
})

import { BufferTarget, StreamTarget } from 'mediabunny'
import { ExportCancelledError, exportVideo, type ExportAudioSources, type ExportFrameSource, type ExportRequest } from '../src/exporter'

const frames: FakeVideoFrame[] = []
const audioData: FakeAudioData[] = []
const mixLengths: number[] = []
let failEncode = false
let audioSupported = false

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
  // 默认不支持任何音频配置：导出走无音轨路径
  static async isConfigSupported() {
    return { supported: audioSupported }
  }
  state = 'unconfigured'
  encodeQueueSize = 0
  configure() {
    this.state = 'configured'
  }
  encode() {}
  async flush() {}
  close() {
    this.state = 'closed'
  }
}

class FakeAudioData {
  closed = false
  readonly timestamp: number
  readonly numberOfFrames: number
  constructor(init: { timestamp: number; numberOfFrames: number }) {
    this.timestamp = init.timestamp
    this.numberOfFrames = init.numberOfFrames
    audioData.push(this)
  }
  close() {
    this.closed = true
  }
}

class FakeOfflineAudioContext {
  destination = {}
  constructor(private readonly options: { numberOfChannels: number; length: number; sampleRate: number }) {
    mixLengths.push(options.length)
  }
  createGain() {
    return { gain: { value: 1 }, connect: (node: unknown) => node }
  }
  createBufferSource() {
    return { connect: (node: unknown) => node, start() {}, stop() {} }
  }
  async startRendering() {
    const { length, numberOfChannels, sampleRate } = this.options
    const planes = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
    return { length, numberOfChannels, sampleRate, getChannelData: (channel: number) => planes[channel] }
  }
}

/** 浏览器 OPFS 的最小替身：一个目录、一个可写文件。 */
function fakeOpfs() {
  const writable = { kind: 'writable' }
  const file = new Blob(['mp4-bytes'])
  const handle = { createWritable: vi.fn(async () => writable), getFile: vi.fn(async () => file) }
  const dir = { getFileHandle: vi.fn(async () => handle), removeEntry: vi.fn(async () => {}) }
  const root = { getDirectoryHandle: vi.fn(async () => dir) }
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } })
  return { writable, handle, dir, root }
}

beforeEach(() => {
  frames.length = 0
  audioData.length = 0
  mixLengths.length = 0
  mux.targets.length = 0
  failEncode = false
  audioSupported = false
  vi.stubGlobal('VideoEncoder', FakeVideoEncoder)
  vi.stubGlobal('AudioEncoder', FakeAudioEncoder)
  vi.stubGlobal('AudioData', FakeAudioData)
  vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext)
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

describe('exportVideo output target', () => {
  it('streams MP4 into the OPFS temp file and returns that file', async () => {
    const opfs = fakeOpfs()
    const result = await exportVideo(recordingSource().source, request)
    const target = mux.targets[0] as InstanceType<typeof StreamTarget> & { writable: unknown; options: unknown }
    expect(target).toBeInstanceOf(StreamTarget)
    expect(target.writable).toBe(opfs.writable)
    expect(target.options).toEqual({ chunked: true })
    expect(opfs.root.getDirectoryHandle).toHaveBeenCalledWith('sukushow-export', { create: true })
    expect(opfs.dir.getFileHandle).toHaveBeenCalledWith('export.mp4', { create: true })
    expect(result.blob.size).toBe('mp4-bytes'.length)
    expect(result.blob.type).toBe('video/mp4')
    expect(opfs.dir.removeEntry).not.toHaveBeenCalled()
  })

  it('keeps WebM in memory even when OPFS is available', async () => {
    const opfs = fakeOpfs()
    await exportVideo(recordingSource().source, { ...request, container: 'webm' })
    expect(mux.targets[0]).toBeInstanceOf(BufferTarget)
    expect(opfs.handle.createWritable).not.toHaveBeenCalled()
  })

  it('removes the temp file when an MP4 export fails', async () => {
    const opfs = fakeOpfs()
    const { source } = recordingSource({
      begin: () => {
        throw new Error('begin failed')
      },
    })
    await expect(exportVideo(source, request)).rejects.toThrow('begin failed')
    expect(opfs.dir.removeEntry).toHaveBeenCalledWith('export.mp4')
  })

  it('falls back to memory when OPFS is unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const result = await exportVideo(recordingSource().source, request)
    expect(mux.targets[0]).toBeInstanceOf(BufferTarget)
    expect(result.blob.size).toBe(8)
  })
})

describe('exportVideo audio', () => {
  it('mixes and encodes audio in contiguous 10 s segments and releases every chunk', async () => {
    audioSupported = true
    vi.stubGlobal('navigator', {})
    const result = await exportVideo(recordingSource().source, { ...request, startSec: 0, endSec: 25 })
    expect(result.audioCodec).toBe('aac')
    expect(mixLengths).toEqual([480_000, 480_000, 240_000])
    expect(audioData).toHaveLength(250)
    audioData.forEach((data, index) => {
      expect(data.timestamp).toBe(index * 100_000)
      expect(data.numberOfFrames).toBe(4800)
    })
    expect(audioData.every((data) => data.closed)).toBe(true)
  })
})
