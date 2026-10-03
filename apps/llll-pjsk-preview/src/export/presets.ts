/**
 * 视频导出预设：分辨率 / 帧率 / 码率 / 容器，以及对应的 WebCodecs codec 字符串。
 *
 * codec 字符串要带正确的 level，否则 isConfigSupported 在高分辨率上会误报不支持
 * （或编码器按过低 level 拒绝）。level 按各自规范的上限表自动选取。
 */

export type AspectGroup = '16:9' | '19.5:9' | '20:9' | '16:10' | '4:3'

export type ResolutionPreset = {
  id: string
  group: AspectGroup
  width: number
  height: number
  label: string
}

export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { id: '720p', group: '16:9', width: 1280, height: 720, label: '1280×720' },
  { id: '1080p', group: '16:9', width: 1920, height: 1080, label: '1920×1080' },
  { id: '2160p', group: '16:9', width: 3840, height: 2160, label: '3840×2160 (4K)' },
  { id: '2340x1080', group: '19.5:9', width: 2340, height: 1080, label: '2340×1080' },
  { id: '2400x1080', group: '20:9', width: 2400, height: 1080, label: '2400×1080' },
  { id: '1920x1200', group: '16:10', width: 1920, height: 1200, label: '1920×1200' },
  { id: '2560x1600', group: '16:10', width: 2560, height: 1600, label: '2560×1600' },
  { id: '1440x1080', group: '4:3', width: 1440, height: 1080, label: '1440×1080' },
  { id: '2048x1536', group: '4:3', width: 2048, height: 1536, label: '2048×1536' },
]

export const FRAME_RATES = [30, 60] as const
export type FrameRate = (typeof FRAME_RATES)[number]

/** 码率档位（Mbps）。 */
export const BITRATE_CHOICES_MBPS = [12, 20, 45] as const

export type ContainerFormat = 'mp4' | 'webm'
export type VideoCodecId = 'avc' | 'vp9'
export type AudioCodecId = 'aac' | 'opus'

export function findResolution(id: string): ResolutionPreset | undefined {
  return RESOLUTION_PRESETS.find((preset) => preset.id === id)
}

/**
 * 默认码率：1080p 级 30fps ≈ 12 Mbps，60fps 或 1600p 级 ≈ 20 Mbps，4K ≈ 45 Mbps。
 */
export function defaultBitrateMbps(width: number, height: number, fps: number): number {
  const pixels = width * height
  if (pixels > 2560 * 1600) return 45
  if (fps > 30 || pixels > 2400 * 1200) return 20
  return 12
}

type H264Level = { idc: number; maxFs: number; maxMbps: number; maxKbpsHigh: number }

// H.264 Table A-1（MaxFS / MaxMBPS 以宏块计；High profile 码率上限 = 1.25 × MaxBR）。
const H264_LEVELS: readonly H264Level[] = [
  { idc: 31, maxFs: 3600, maxMbps: 108000, maxKbpsHigh: 17500 },
  { idc: 32, maxFs: 5120, maxMbps: 216000, maxKbpsHigh: 25000 },
  { idc: 40, maxFs: 8192, maxMbps: 245760, maxKbpsHigh: 25000 },
  { idc: 41, maxFs: 8192, maxMbps: 245760, maxKbpsHigh: 62500 },
  { idc: 42, maxFs: 8704, maxMbps: 522240, maxKbpsHigh: 62500 },
  { idc: 50, maxFs: 22080, maxMbps: 589824, maxKbpsHigh: 168750 },
  { idc: 51, maxFs: 36864, maxMbps: 983040, maxKbpsHigh: 300000 },
  { idc: 52, maxFs: 36864, maxMbps: 2073600, maxKbpsHigh: 300000 },
  { idc: 60, maxFs: 139264, maxMbps: 4177920, maxKbpsHigh: 300000 },
]

export function h264Level(width: number, height: number, fps: number, bitrate: number): number {
  const mbW = Math.ceil(width / 16)
  const mbH = Math.ceil(height / 16)
  const fs = mbW * mbH
  const mbps = fs * fps
  for (const level of H264_LEVELS) {
    // 单边上限 sqrt(8·MaxFS)（A.3.1 h/i）。
    const maxSide = Math.sqrt(level.maxFs * 8)
    if (fs <= level.maxFs && mbps <= level.maxMbps && mbW <= maxSide && mbH <= maxSide && bitrate / 1000 <= level.maxKbpsHigh) {
      return level.idc
    }
  }
  return 62
}

/** H.264 High profile（avc1.6400LL）。 */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  return `avc1.6400${h264Level(width, height, fps, bitrate).toString(16).toUpperCase().padStart(2, '0')}`
}

type Vp9Level = { id: number; maxPicture: number; maxSampleRate: number }

// VP9 Annex A 级别表（亮度像素数 / 亮度采样率）。
const VP9_LEVELS: readonly Vp9Level[] = [
  { id: 10, maxPicture: 36864, maxSampleRate: 829440 },
  { id: 11, maxPicture: 73728, maxSampleRate: 2764800 },
  { id: 20, maxPicture: 122880, maxSampleRate: 4608000 },
  { id: 21, maxPicture: 245760, maxSampleRate: 9216000 },
  { id: 30, maxPicture: 552960, maxSampleRate: 20736000 },
  { id: 31, maxPicture: 983040, maxSampleRate: 36864000 },
  { id: 40, maxPicture: 2228224, maxSampleRate: 83558400 },
  { id: 41, maxPicture: 2228224, maxSampleRate: 160432128 },
  { id: 50, maxPicture: 8912896, maxSampleRate: 311951360 },
  { id: 51, maxPicture: 8912896, maxSampleRate: 588251136 },
  { id: 52, maxPicture: 8912896, maxSampleRate: 1176502272 },
  { id: 60, maxPicture: 35651584, maxSampleRate: 1176502272 },
]

export function vp9Level(width: number, height: number, fps: number): number {
  const picture = width * height
  const rate = picture * fps
  for (const level of VP9_LEVELS) {
    if (picture <= level.maxPicture && rate <= level.maxSampleRate) return level.id
  }
  return 62
}

/** VP9 profile 0 / 8-bit（vp09.00.LL.08）。 */
export function vp9CodecString(width: number, height: number, fps: number): string {
  return `vp09.00.${vp9Level(width, height, fps).toString().padStart(2, '0')}.08`
}

export type ExportVideoSettings = {
  container: ContainerFormat
  width: number
  height: number
  fps: number
  bitrateMbps: number
}

export function videoCodecFor(container: ContainerFormat): VideoCodecId {
  return container === 'mp4' ? 'avc' : 'vp9'
}

export function buildVideoEncoderConfig(settings: ExportVideoSettings): VideoEncoderConfig {
  const bitrate = Math.round(settings.bitrateMbps * 1_000_000)
  const codec =
    settings.container === 'mp4'
      ? avcCodecString(settings.width, settings.height, settings.fps, bitrate)
      : vp9CodecString(settings.width, settings.height, settings.fps)
  const config: VideoEncoderConfig = {
    codec,
    width: settings.width,
    height: settings.height,
    bitrate,
    framerate: settings.fps,
    bitrateMode: 'variable',
    latencyMode: 'quality',
  }
  if (settings.container === 'mp4') {
    // mp4 轨道需要 avcC（AVC 格式），而不是 Annex B 起始码。
    config.avc = { format: 'avc' }
  }
  return config
}

export const AUDIO_SAMPLE_RATE = 48000
export const AUDIO_CHANNELS = 2

/** 音频编码配置：mp4 优先 AAC-LC，不支持时回退 Opus；webm 只用 Opus。 */
export function audioEncoderCandidates(container: ContainerFormat): Array<{ codec: AudioCodecId; config: AudioEncoderConfig }> {
  const opus = {
    codec: 'opus' as const,
    config: { codec: 'opus', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: 192_000 },
  }
  if (container === 'webm') return [opus]
  return [
    {
      codec: 'aac' as const,
      config: { codec: 'mp4a.40.2', sampleRate: AUDIO_SAMPLE_RATE, numberOfChannels: AUDIO_CHANNELS, bitrate: 192_000 },
    },
    opus,
  ]
}

export function exportFileName(base: string, settings: ExportVideoSettings): string {
  const safe = base.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'pjsk-preview'
  return `${safe}_${settings.width}x${settings.height}_${settings.fps}fps.${settings.container}`
}