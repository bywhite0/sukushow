import { mmwWasmFilename } from '../generated/mmwWasmAsset'
import type { CapturedSoundEvent } from '@sukushow/export'
import type { PreviewRuntimeConfig, ScoreTextFormat, SessionMetadata, TransportState, WasmPlayerSnapshot } from './types'

type CcallOptions = {
  async?: boolean
}

type EmscriptenModule = {
  HEAPU8: Uint8Array
  ccall: (
    ident: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    opts?: CcallOptions,
  ) => unknown
  _malloc: (size: number) => number
  _free: (ptr: number) => void
  /** wasm 侧的 JS 音频引擎（mmw_overlay_player.cpp 的 jsAudioEnsureEngine）。 */
  __mmwAudio?: MmwAudioEngine
}

/** 导出需要读取的音频引擎字段（只读用途）。 */
export type MmwAudioEngine = {
  audioBuffer: AudioBuffer | null
  soundBuffers: Map<string, AudioBuffer>
  audioStartOffsetSec: number
  bgmVolume: number
  soundVolume: number
  capture: { events: CapturedSoundEvent[] } | null
}

type EmscriptenModuleFactoryOptions = {
  locateFile: (file: string) => string
  print?: (...args: unknown[]) => void
  printErr?: (...args: unknown[]) => void
  onAbort?: (reason: unknown) => void
}

declare global {
  interface Window {
    __MMW_DEBUG_ERRORS__?: string[]
  }
}

function pushDebugError(message: unknown) {
  const text =
    typeof message === 'string'
      ? message
      : message instanceof Error
        ? message.stack || message.message
        : String(message)
  const bucket = (window.__MMW_DEBUG_ERRORS__ ??= [])
  bucket.push(text)
  if (bucket.length > 60) {
    bucket.splice(0, bucket.length - 60)
  }
  console.error('[MMW]', text)
}

type LoadSessionOptions = {
  scoreText: string
  scoreFormat?: ScoreTextFormat
  sourceOffsetMs: number
  effectiveLeadInMs: number
  bgmBytes: Uint8Array | null
  coverBytes: Uint8Array | null
  metadata: SessionMetadata
}

let modulePromise: Promise<EmscriptenModule> | null = null

async function loadModule() {
  if (!modulePromise) {
    // 生成的 emscripten 胶水没有 .d.ts；这里按已知工厂签名断言。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modulePromise = (import('../generated/mmw-preview.js') as Promise<any>).then(async (module) =>
      (module as { default: (options: EmscriptenModuleFactoryOptions) => Promise<EmscriptenModule> }).default({
        locateFile: (file: string) => (file.endsWith('.wasm') ? `/wasm/${mmwWasmFilename}` : `/wasm/${file}`),
        print: (...args: unknown[]) => {
          if (args.length > 0) {
            pushDebugError(args.map((item) => String(item)).join(' '))
          }
        },
        printErr: (...args: unknown[]) => {
          if (args.length > 0) {
            pushDebugError(args.map((item) => String(item)).join(' '))
          }
        },
        onAbort: (reason: unknown) => {
          pushDebugError(`wasm abort: ${String(reason)}`)
        },
      }),
    )
  }
  return modulePromise
}

function decodeTransportState(code: number): TransportState {
  switch (code) {
    case 1:
      return 'loading'
    case 2:
      return 'ready'
    case 3:
      return 'playing'
    case 4:
      return 'paused'
    case 5:
      return 'error'
    case 0:
    default:
      return 'idle'
  }
}

export class MmwWasmPlayer {
  private module: EmscriptenModule | null = null

  private canvasSelector = '#preview-canvas'

  async init(canvas: HTMLCanvasElement, width: number, height: number, dpr: number) {
    if (!canvas.id) {
      canvas.id = 'preview-canvas'
    }
    this.canvasSelector = `#${canvas.id}`
    if (!this.module) {
      this.module = await loadModule()
    }

    const ok = Number(
      this.module.ccall('initPlayer', 'number', ['string', 'number', 'number', 'number'], [
        this.canvasSelector,
        Math.max(1, Math.round(width)),
        Math.max(1, Math.round(height)),
        Math.max(0.1, dpr),
      ]),
    )
    if (ok !== 1) {
      throw new Error(this.getWarningText() || 'Failed to initialize wasm player.')
    }
  }

  async preloadAsset(key: string, bytes: Uint8Array) {
    this.assertReady()
    await this.callWithBytes('preloadAssetData', key, bytes)
  }

  async preloadFont(key: string, bytes: Uint8Array) {
    this.assertReady()
    await this.callWithBytes('preloadFontData', key, bytes)
  }

  async preloadSound(key: string, bytes: Uint8Array) {
    this.assertReady()
    await this.callWithBytes('preloadSoundData', key, bytes, true)
  }

  async loadSession(options: LoadSessionOptions) {
    const module = this.assertReady()
    const scorePtr = this.allocString(options.scoreText)
    const titlePtr = this.allocString(options.metadata.title ?? '')
    const lyricistPtr = this.allocString(options.metadata.lyricist ?? '')
    const composerPtr = this.allocString(options.metadata.composer ?? '')
    const arrangerPtr = this.allocString(options.metadata.arranger ?? '')
    const vocalPtr = this.allocString(options.metadata.vocal ?? '')
    const difficultyPtr = this.allocString(options.metadata.difficulty ?? '')
    const scoreTitlePtr = this.allocString(options.metadata.scoreTitle ?? '')
    const scoreCreatorPtr = this.allocString(options.metadata.scoreCreator ?? '')
    const bgm = this.allocBytes(options.bgmBytes)
    const cover = this.allocBytes(options.coverBytes)

    try {
      const loadFunction = options.scoreFormat === 'custom-score-json' ? 'loadCustomScoreJsonSession' : 'loadSession'
      const result = await this.call<number>(
        loadFunction,
        'number',
        [
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
          'number',
        ],
        [
          scorePtr,
          options.sourceOffsetMs,
          options.effectiveLeadInMs,
          bgm.ptr,
          bgm.length,
          cover.ptr,
          cover.length,
          titlePtr,
          lyricistPtr,
          composerPtr,
          arrangerPtr,
          vocalPtr,
          difficultyPtr,
          options.metadata.customScoreInfo ? 1 : 0,
          scoreTitlePtr,
          scoreCreatorPtr,
        ],
        true,
      )
      if (Number(result) !== 1) {
        throw new Error(this.getWarningText() || 'Failed to load preview session.')
      }
    } finally {
      this.freePtr(scorePtr)
      this.freePtr(titlePtr)
      this.freePtr(lyricistPtr)
      this.freePtr(composerPtr)
      this.freePtr(arrangerPtr)
      this.freePtr(vocalPtr)
      this.freePtr(difficultyPtr)
      this.freePtr(scoreTitlePtr)
      this.freePtr(scoreCreatorPtr)
      this.freePtr(bgm.ptr)
      this.freePtr(cover.ptr)
    }
  }

  async play() {
    const ok = await this.call<number>('playPlayer', 'number', [], [], true)
    return Number(ok) === 1
  }

  async unlockAudio() {
    const ok = await this.call<number>('unlockPlayerAudio', 'number', [], [], true)
    return Number(ok) === 1
  }

  pause() {
    this.assertReady().ccall('pausePlayer', null, [], [])
  }

  seek(outputTimeSec: number) {
    this.assertReady().ccall('seekPlayer', null, ['number'], [outputTimeSec])
  }

  setPlaybackRate(rate: number) {
    this.assertReady().ccall('setPlayerPlaybackRate', null, ['number'], [rate])
  }

  setAudioVolumes(bgmVolume: number, soundVolume: number) {
    this.assertReady().ccall('setPlayerAudioVolumes', null, ['number', 'number'], [bgmVolume, soundVolume])
  }

  resize(width: number, height: number, dpr: number) {
    this.assertReady().ccall(
      'resizePlayer',
      null,
      ['number', 'number', 'number'],
      [Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), Math.max(0.1, dpr)],
    )
  }

  setPreviewConfig(config: PreviewRuntimeConfig) {
    this.assertReady().ccall(
      'setPlayerPreviewConfig',
      null,
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [
        config.mirror ? 1 : 0,
        config.flickAnimation ? 1 : 0,
        config.holdAnimation ? 1 : 0,
        config.simultaneousLine ? 1 : 0,
        config.effectProfile,
        config.noteSkin,
        config.noteSpeed,
        config.holdAlpha,
        config.guideAlpha,
        config.stageCover,
        config.stageOpacity,
        config.backgroundBrightness,
        config.effectOpacity,
      ],
    )
  }

  /** Fever 时段（歌曲秒）。start<0 或 end<=start 视为本曲无 Fever。 */
  setFeverWindow(startSec: number, endSec: number) {
    this.assertReady().ccall('setPlayerFeverWindow', null, ['number', 'number'], [startSec, endSec])
  }

  /**
   * 推进 FeverChance 充能。
   *
   * 口径照 PJSK：`progress = feverCount / totalFeverCount`，
   * 其中 totalFeverCount = Fever 段起点之前的可判定音符数，
   * feverCount = 其中已经过去的那些。分母由谱面静态算好，分子每帧推进。
   */
  setFeverCharge(feverCount: number, totalFeverCount: number) {
    this.assertReady().ccall('setPlayerFeverCharge', null, ['number', 'number'], [
      feverCount,
      totalFeverCount,
    ])
  }

  /** SuperFever 视觉开关（llll 侧无原版判定依据，由用户指定）。 */
  setSuperFeverEnabled(enabled: boolean) {
    this.assertReady().ccall('setPlayerSuperFeverEnabled', null, ['number'], [enabled ? 1 : 0])
  }

  /** Fever 显示开关；只影响特效，不改变逻辑状态。 */
  setFeverDisplay(enabled: boolean) {
    this.assertReady().ccall('setPlayerFeverDisplay', null, ['number'], [enabled ? 1 : 0])
  }

  /**
   * 充能分母（Fever 段起点之前的音符时刻，升序）。
   *
   * 分子在每次渲染前按当前时刻重算——充能是**渲染态的派生量**，
   * 不能交给某个循环代为推进：直接调 `renderFrame()` 的路径会绕过循环。
   */
  private feverChargeTimes: number[] = []

  setFeverChargeTimes(times: number[]) {
    this.feverChargeTimes = times
  }

  renderFrame() {
    if (this.feverChargeTimes.length) {
      const snapshot = this.getStateSnapshot()
      this.updateFeverCharge(snapshot.currentTimeSec - snapshot.effectiveLeadInSec)
    }
    this.assertReady().ccall('renderPlayerFrame', null, [], [])
  }

  private updateFeverCharge(chartTime: number) {
    if (!this.feverChargeTimes.length) return
    let n = 0
    while (n < this.feverChargeTimes.length && this.feverChargeTimes[n] <= chartTime) n += 1
    this.setFeverCharge(n, this.feverChargeTimes.length)
  }

  /**
   * 视频导出模式：开启后实时音频停止，时钟改由 `renderFrameAt` 注入，
   * 命中音 / AP 音记成事件（见 `getCapturedSoundEvents`）。关闭后需自行 seek 回原位置。
   */
  setExportMode(enabled: boolean) {
    this.assertReady().ccall('setPlayerExportMode', null, ['number'], [enabled ? 1 : 0])
  }

  /**
   * 以注入时刻（输出时间轴秒数）渲染一帧。`playing` 为真时命中 / 特效 / 音效事件
   * 按正在播放推进，须从起点按时间顺序逐帧调用。
   */
  renderFrameAt(outputTimeSec: number, playing = true) {
    const module = this.assertReady()
    if (this.feverChargeTimes.length) {
      const leadIn = Number(module.ccall('getPlayerEffectiveLeadInSec', 'number', [], []))
      this.updateFeverCharge(outputTimeSec - leadIn)
    }
    module.ccall('renderPlayerFrameAt', null, ['number', 'number'], [outputTimeSec, playing ? 1 : 0])
  }

  /** 导出模式下收集到的音效事件（拷贝）。 */
  getCapturedSoundEvents(): CapturedSoundEvent[] {
    const capture = this.assertReady().__mmwAudio?.capture
    return capture ? capture.events.map((event) => ({ ...event })) : []
  }

  /** 混音素材：BGM、音效缓冲、BGM 起点（已含音频偏移）与音量。 */
  getAudioSources() {
    const audio = this.assertReady().__mmwAudio
    return {
      bgm: audio?.audioBuffer ?? null,
      bgmStartSec: Number(audio?.audioStartOffsetSec ?? 0),
      bgmVolume: Number(audio?.bgmVolume ?? 1),
      soundVolume: Number(audio?.soundVolume ?? 1),
      soundBuffers: new Map(audio?.soundBuffers ?? []) as ReadonlyMap<string, AudioBuffer>,
    }
  }

  getStateSnapshot(): WasmPlayerSnapshot {
    const module = this.assertReady()
    const warningText = String(module.ccall('getPlayerWarningText', 'string', [], []))
    return {
      currentTimeSec: Number(module.ccall('getPlayerCurrentTimeSec', 'number', [], [])),
      durationSec: Number(module.ccall('getPlayerDurationSec', 'number', [], [])),
      chartEndSec: Number(module.ccall('getPlayerChartEndSec', 'number', [], [])),
      sourceOffsetSec: Number(module.ccall('getPlayerSourceOffsetSec', 'number', [], [])),
      effectiveLeadInSec: Number(module.ccall('getPlayerEffectiveLeadInSec', 'number', [], [])),
      audioStartDelaySec: Number(module.ccall('getPlayerAudioStartDelaySec', 'number', [], [])),
      apStartSec: Number(module.ccall('getPlayerApStartSec', 'number', [], [])),
      transportState: decodeTransportState(Number(module.ccall('getPlayerTransportState', 'number', [], []))),
      requiresGesture: Number(module.ccall('getPlayerRequiresGesture', 'number', [], [])) === 1,
      hasAudio: Number(module.ccall('getPlayerHasAudio', 'number', [], [])) === 1,
      warnings: warningText.trim(),
    }
  }

  dispose() {
    if (!this.module) {
      return
    }
    this.module.ccall('disposePlayer', null, [], [])
  }

  private getWarningText() {
    if (!this.module) {
      return ''
    }
    return String(this.module.ccall('getPlayerWarningText', 'string', [], []) || '')
  }

  private async callWithBytes(name: string, key: string, bytes: Uint8Array, async = false) {
    const keyPtr = this.allocString(key)
    const data = this.allocBytes(bytes)
    try {
      const result = await this.call<number>(
        name,
        'number',
        ['number', 'number', 'number'],
        [keyPtr, data.ptr, data.length],
        async,
      )
      if (Number(result) !== 1) {
        throw new Error(this.getWarningText() || `Failed to call ${name}.`)
      }
    } finally {
      this.freePtr(keyPtr)
      this.freePtr(data.ptr)
    }
  }

  private async call<T>(
    name: string,
    returnType: string | null,
    argTypes: string[],
    args: unknown[],
    async = false,
  ) {
    const module = this.assertReady()
    const value = module.ccall(name, returnType, argTypes, args, async ? { async: true } : undefined)
    return (async ? await (value as Promise<T>) : (value as T))
  }

  private allocString(value: string) {
    const module = this.assertReady()
    const encoded = new TextEncoder().encode(value)
    const ptr = module._malloc(encoded.length + 1)
    module.HEAPU8.set(encoded, ptr)
    module.HEAPU8[ptr + encoded.length] = 0
    return ptr
  }

  private allocBytes(bytes: Uint8Array | null) {
    const module = this.assertReady()
    if (!bytes || bytes.length === 0) {
      return { ptr: 0, length: 0 }
    }
    const ptr = module._malloc(bytes.length)
    module.HEAPU8.set(bytes, ptr)
    return { ptr, length: bytes.length }
  }

  private freePtr(ptr: number) {
    if (!this.module || !ptr) {
      return
    }
    this.module._free(ptr)
  }

  private assertReady() {
    if (!this.module) {
      throw new Error('Wasm module has not been initialized.')
    }
    return this.module
  }
}
