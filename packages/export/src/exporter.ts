/**
 * 视频导出：帧源逐帧渲染（虚拟时钟）→ WebCodecs VideoEncoder；
 * 音效事件 + BGM → 分段 OfflineAudioContext → AudioEncoder；Mediabunny 封装成 MP4 / WebM。
 * MP4 边封装边写入 OPFS 临时文件（见 output.ts），WebM 在内存中封装。
 *
 * 只依赖 ExportFrameSource 接口：画面怎么画、音效怎么收集由各预览实现。
 */
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { VirtualClock } from './clock'
import { MIX_SEGMENT_SEC, mixFrameCount, mixSegments, renderMixSegment, type CapturedSoundEvent, type MixInput } from './audioMix'
import { createExportTarget } from './output'
import {
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  audioEncoderCandidates,
  buildVideoEncoderConfig,
  videoCodecFor,
  type AudioCodecId,
  type ContainerFormat,
  type ExportVideoSettings,
} from './presets'

/**
 * 帧源：导出对预览的最小依赖面（各预览自己实现）。
 * begin 之后按帧号顺序调用 renderAt（时刻严格递增、步长 1/fps），最后 collectAudio + end。
 */
export type ExportFrameSource = {
  /**
   * 把画布固定到导出尺寸（dpr 1），进入导出模式（虚拟时钟 + 音效收集）。
   * 需要从起点前预滚的帧源用 startSec / fps 推进到起点；能从任意时刻直接进入的帧源可以忽略。
   */
  begin(width: number, height: number, startSec: number, fps: number): void | Promise<void>
  /** 以注入时刻渲染一帧（正在播放语义）。 */
  renderAt(outputTimeSec: number): void
  /** 当前帧所在的画布；须在 renderAt 之后同一任务内取帧。 */
  readonly canvas: HTMLCanvasElement
  /**
   * 导出期间收集到的音效事件与混音素材。endSec 为视频终点（起点 + 时长），
   * 供按播放过程收集音效的帧源补齐最后一帧间隔并收尾；事件自带终点的帧源可以忽略。
   */
  collectAudio(endSec: number): ExportAudioSources
  /** 退出导出模式，恢复画布尺寸与播放位置。 */
  end(): void
}

export type ExportAudioSources = {
  events: CapturedSoundEvent[]
  bgm: AudioBuffer | null
  bgmStartSec: number
  bgmVolume: number
  soundVolume: number
  soundBuffers: ReadonlyMap<string, AudioBuffer>
  /** 循环音的循环点（见 audioMix.MixInput.loopPoints）。 */
  loopPoints?: (key: string, buffer: AudioBuffer) => { loopStart: number; loopEnd: number } | null
}

export type ExportPhase = 'video' | 'audio' | 'finalize'

export type ExportProgress = {
  phase: ExportPhase
  /** 0..1 */
  ratio: number
  framesDone: number
  frameCount: number
  /** 编码速度（帧/秒）。 */
  fps: number
  /** 相对实时的倍速（视频秒 / 墙钟秒）。 */
  realtimeFactor: number
}

export type ExportRequest = ExportVideoSettings & {
  startSec: number
  endSec: number
  signal?: AbortSignal
  onProgress?: (progress: ExportProgress) => void
}

export type ExportResult = {
  blob: Blob
  mimeType: string
  videoCodec: string
  audioCodec: AudioCodecId | null
  frameCount: number
  durationSec: number
  elapsedSec: number
  encodeFps: number
  realtimeFactor: number
  soundEventCount: number
}

export class ExportCancelledError extends Error {
  constructor() {
    super('导出已取消')
    this.name = 'ExportCancelledError'
  }
}

export function webCodecsAvailable() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined'
}

export async function isVideoConfigSupported(settings: ExportVideoSettings): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false
  try {
    const result = await VideoEncoder.isConfigSupported(buildVideoEncoderConfig(settings))
    return result.supported === true
  } catch {
    return false
  }
}

/** 选出容器可用的第一个音频编码配置；都不支持时返回 null。 */
export async function pickAudioConfig(container: ContainerFormat): Promise<{ codec: AudioCodecId; config: AudioEncoderConfig } | null> {
  if (typeof AudioEncoder === 'undefined') return null
  for (const candidate of audioEncoderCandidates(container)) {
    try {
      const result = await AudioEncoder.isConfigSupported(candidate.config)
      if (result.supported) return candidate
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

const nowSec = () => performance.now() / 1000
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
/** 等待写出的视频包上限：写盘慢于编码时在帧循环里等写入追上，编码包不在内存中堆积。 */
const MAX_PENDING_VIDEO_PACKETS = 120

export async function exportVideo(host: ExportFrameSource, request: ExportRequest): Promise<ExportResult> {
  const { signal } = request
  const throwIfAborted = () => {
    if (signal?.aborted) throw new ExportCancelledError()
  }
  if (!webCodecsAvailable()) throw new Error('当前浏览器不支持 WebCodecs，无法导出视频')

  const videoConfig = buildVideoEncoderConfig(request)
  if (!(await isVideoConfigSupported(request))) {
    throw new Error(`视频编码配置不受支持：${videoConfig.codec} ${request.width}×${request.height}@${request.fps}`)
  }
  const audioChoice = await pickAudioConfig(request.container)
  throwIfAborted()

  const clock = new VirtualClock(request.startSec, request.endSec, request.fps)
  if (clock.frameCount <= 0) throw new Error('导出区间为空')

  const exportTarget = await createExportTarget(request.container)
  const output = new Output({
    // fastStart: false：moov 写在末尾，样本随编码写出，不在内存中积累
    format: request.container === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(),
    target: exportTarget.target,
  })
  const videoSource = new EncodedVideoPacketSource(videoCodecFor(request.container))
  output.addVideoTrack(videoSource, { frameRate: request.fps })
  const audioSource = audioChoice ? new EncodedAudioPacketSource(audioChoice.codec) : null
  if (audioSource) output.addAudioTrack(audioSource)

  let encoderError: unknown = null
  // 封装按到达顺序串行写入，积压超过上限时才在帧循环里等待。MP4 写样本不等音轨，
  // WebM 写入只是入队，所以等待不会因音轨尚未开始而卡住。
  let videoChain: Promise<void> = Promise.resolve()
  let audioChain: Promise<void> = Promise.resolve()
  let pendingVideoPackets = 0
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk)
      pendingVideoPackets += 1
      videoChain = videoChain.then(async () => {
        await videoSource.add(packet, meta)
        pendingVideoPackets -= 1
      })
    },
    error: (error) => {
      encoderError = error
    },
  })
  let audioEncoder: AudioEncoder | null = null

  const started = nowSec()
  let hostActive = false
  const report = (phase: ExportPhase, ratio: number, framesDone: number) => {
    const elapsed = Math.max(1e-6, nowSec() - started)
    request.onProgress?.({
      phase,
      ratio,
      framesDone,
      frameCount: clock.frameCount,
      fps: framesDone / elapsed,
      realtimeFactor: framesDone / request.fps / elapsed,
    })
  }

  try {
    await output.start()
    videoEncoder.configure(videoConfig)
    hostActive = true
    await host.begin(request.width, request.height, clock.startSec, request.fps)
    throwIfAborted()

    const keyFrameInterval = Math.max(1, Math.round(request.fps * 2))
    let lastYield = nowSec()
    for (let index = 0; index < clock.frameCount; index += 1) {
      throwIfAborted()
      if (encoderError) throw encoderError
      host.renderAt(clock.timeAt(index))
      // WebGL 画布未开 preserveDrawingBuffer：必须在渲染后的同一任务里取帧。
      const frame = new VideoFrame(host.canvas, {
        timestamp: clock.timestampUs(index),
        duration: clock.frameDurationUs(index),
      })
      try {
        videoEncoder.encode(frame, { keyFrame: index % keyFrameInterval === 0 })
      } finally {
        frame.close()
      }
      while (videoEncoder.encodeQueueSize > 6) {
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          videoEncoder.addEventListener('dequeue', done, { once: true })
          setTimeout(done, 50)
        })
      }
      if (pendingVideoPackets > MAX_PENDING_VIDEO_PACKETS) await videoChain
      if (nowSec() - lastYield > 0.1) {
        report('video', (0.9 * (index + 1)) / clock.frameCount, index + 1)
        await yieldToUi()
        lastYield = nowSec()
      }
    }
    await videoEncoder.flush()
    if (encoderError) throw encoderError
    report('audio', 0.9, clock.frameCount)
    throwIfAborted()

    const audio = host.collectAudio(clock.startSec + clock.durationSec)
    host.end()
    hostActive = false

    if (audioSource && audioChoice) {
      const mix: MixInput = {
        startSec: clock.startSec,
        durationSec: clock.durationSec,
        sampleRate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        bgm: audio.bgm,
        bgmStartSec: audio.bgmStartSec,
        bgmVolume: audio.bgmVolume,
        soundVolume: audio.soundVolume,
        soundBuffers: audio.soundBuffers,
        events: audio.events,
        loopPoints: audio.loopPoints,
      }
      const encoder = new AudioEncoder({
        output: (chunk, meta) => {
          const packet = EncodedPacket.fromEncodedChunk(chunk)
          audioChain = audioChain.then(() => audioSource.add(packet, meta))
        },
        error: (error) => {
          encoderError = error
        },
      })
      audioEncoder = encoder
      encoder.configure(audioChoice.config)
      // 逐段混音、编码，每段 PCM 编码后即释放
      const totalFrames = mixFrameCount(clock.durationSec, AUDIO_SAMPLE_RATE)
      for (const segment of mixSegments(totalFrames, MIX_SEGMENT_SEC * AUDIO_SAMPLE_RATE)) {
        throwIfAborted()
        const pcm = await renderMixSegment(mix, segment.startFrame, segment.frameCount)
        throwIfAborted()
        await encodeAudioBuffer(encoder, pcm, segment.startFrame, throwIfAborted)
        if (encoderError) throw encoderError
        report('audio', 0.9 + (0.07 * (segment.startFrame + segment.frameCount)) / totalFrames, clock.frameCount)
      }
      await encoder.flush()
      if (encoderError) throw encoderError
    }

    report('finalize', 0.97, clock.frameCount)
    await Promise.all([videoChain, audioChain])
    throwIfAborted()
    await output.finalize()
    const mimeType = await output.getMimeType()
    const blob = await exportTarget.result(mimeType)
    const elapsedSec = nowSec() - started
    report('finalize', 1, clock.frameCount)
    return {
      blob,
      mimeType,
      videoCodec: videoConfig.codec,
      audioCodec: audioChoice?.codec ?? null,
      frameCount: clock.frameCount,
      durationSec: clock.durationSec,
      elapsedSec,
      encodeFps: clock.frameCount / elapsedSec,
      realtimeFactor: clock.durationSec / elapsedSec,
      soundEventCount: audio.events.length,
    }
  } catch (error) {
    try {
      await output.cancel()
    } catch {
      // ignore
    }
    await exportTarget.discard()
    throw error
  } finally {
    if (hostActive) host.end()
    if (videoEncoder.state !== 'closed') videoEncoder.close()
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close()
  }
}

/** 把一段 PCM 切成 AudioData 送入编码器；时间戳从该段在片段中的起始帧 startFrame 起算。 */
async function encodeAudioBuffer(encoder: AudioEncoder, buffer: AudioBuffer, startFrame: number, throwIfAborted: () => void) {
  const chunkFrames = 4800
  const channels = buffer.numberOfChannels
  const planes = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel))
  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    throwIfAborted()
    const frames = Math.min(chunkFrames, buffer.length - offset)
    const data = new Float32Array(frames * channels)
    for (let channel = 0; channel < channels; channel += 1) {
      data.set(planes[channel].subarray(offset, offset + frames), channel * frames)
    }
    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: buffer.sampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round(((startFrame + offset) * 1_000_000) / buffer.sampleRate),
      data,
    })
    try {
      encoder.encode(audioData)
    } finally {
      audioData.close()
    }
    if (encoder.encodeQueueSize > 32) await yieldToUi()
  }
}