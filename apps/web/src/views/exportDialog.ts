/**
 * 视频导出对话框（LLLL 与 PJSK 共用）：选预设 → 逐帧渲染编码 → 下载。
 *
 * 不受支持的配置（VideoEncoder.isConfigSupported 为假）在选项里置灰。
 * 画面由调用方给的 ExportFrameSource 负责：导出期间暂停实时渲染循环、画布固定到预设尺寸（dpr 1），
 * 结束或取消后恢复；这里只锁住会影响画面的控件并驱动 exportVideo。
 */
import {
  BITRATE_CHOICES_MBPS,
  ExportCancelledError,
  FRAME_RATES,
  RESOLUTION_PRESETS,
  buildVideoEncoderConfig,
  defaultBitrateMbps,
  discardExportFile,
  exportFileName,
  exportVideo,
  findResolution,
  isVideoConfigSupported,
  pickAudioConfig,
  resolveExportRange,
  webCodecsAvailable,
  type ContainerFormat,
  type ExportFrameSource,
  type ExportProgress,
  type ExportResult,
  type ExportVideoSettings,
  type OpeningSpan,
} from '@sukushow/export'

export type ExportDialogContext = {
  /** 本模式写死的开场区间。 */
  opening: OpeningSpan
  /** 「包含开场」勾选项的文案。 */
  openingLabel: string
  /** 曲名为空时的下载文件名。 */
  fileNamePrefix: string
  /** 按本次选项创建帧源（intro = 是否包含开场）。 */
  createSource: (options: { intro: boolean }) => ExportFrameSource
  /** 走带终点（秒）。 */
  durationSec: () => number
  /** 每次打开对话框时「包含开场」的默认值；不提供时保留上次的选择。 */
  openingDefault?: () => boolean
  /** 导出期间需要锁住的区域。 */
  lockTargets: () => HTMLElement[]
  title: () => string
  message: (text: string, error?: boolean) => void
}

export type ConfigSupportRow = {
  container: ContainerFormat
  resolution: string
  fps: number
  bitrateMbps: number
  codec: string
  supported: boolean
}

/** 全量探测（自动化验证与报告用）。 */
export async function probeAllConfigs(): Promise<{ video: ConfigSupportRow[]; audio: Record<ContainerFormat, string | null> }> {
  const video: ConfigSupportRow[] = []
  for (const container of ['mp4', 'webm'] as const) {
    for (const preset of RESOLUTION_PRESETS) {
      for (const fps of FRAME_RATES) {
        const bitrateMbps = defaultBitrateMbps(preset.width, preset.height, fps)
        const settings = { container, width: preset.width, height: preset.height, fps, bitrateMbps }
        video.push({
          container,
          resolution: preset.label,
          fps,
          bitrateMbps,
          codec: buildVideoEncoderConfig(settings).codec,
          supported: await isVideoConfigSupported(settings),
        })
      }
    }
  }
  const audio = {
    mp4: (await pickAudioConfig('mp4'))?.config.codec ?? null,
    webm: (await pickAudioConfig('webm'))?.config.codec ?? null,
  }
  return { video, audio }
}

const dialogHtml = (openingLabel: string) => `
<form method="dialog" class="export-form">
 <header class="export-head"><h2>导出视频</h2><button type="button" class="text-button" data-close aria-label="关闭">✕</button></header>
 <div class="export-grid">
  <label class="setting"><span>格式</span><select name="container"><option value="mp4" selected>MP4（H.264 + AAC）</option><option value="webm">WebM（VP9 + Opus，长片段建议用 MP4）</option></select></label>
  <label class="setting"><span>分辨率</span><select name="resolution"></select></label>
  <label class="setting"><span>帧率</span><select name="fps">${FRAME_RATES.map((fps) => `<option value="${fps}"${fps === 60 ? ' selected' : ''}>${fps} fps</option>`).join('')}</select></label>
  <label class="setting"><span>码率</span><select name="bitrate"><option value="auto" selected>自动</option>${BITRATE_CHOICES_MBPS.map((mbps) => `<option value="${mbps}">${mbps} Mbps</option>`).join('')}</select></label>
  <label class="setting"><span>起点 <small>秒</small></span><input name="start" type="number" step="0.1" value="0"></label>
  <label class="setting"><span>终点 <small>秒</small></span><input name="end" type="number" min="0" step="0.1" value="0"></label>
 </div>
 <label class="check"><input name="opening" type="checkbox" checked>${openingLabel}</label>
 <p class="export-support" data-support></p>
 <div class="export-progress" data-progress hidden><progress max="1" value="0"></progress><output data-progress-text></output></div>
 <div class="export-actions">
  <a class="quiet export-download" data-download hidden>下载</a>
  <button type="button" class="quiet" data-cancel hidden>取消导出</button>
  <button type="button" class="primary" data-start>开始导出</button>
 </div>
</form>`

export function installExportDialog(trigger: HTMLButtonElement, ctx: ExportDialogContext) {
  // 上一个会话遗留的导出临时文件：当前页面还没有指向它的下载链接
  void discardExportFile()
  const dialog = document.createElement('dialog')
  dialog.className = 'export-dialog'
  dialog.id = 'export-dialog'
  dialog.setAttribute('aria-label', '导出视频')
  dialog.innerHTML = dialogHtml(ctx.openingLabel)
  document.body.append(dialog)

  const q = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!
  const containerSelect = q<HTMLSelectElement>('[name="container"]')
  const resolutionSelect = q<HTMLSelectElement>('[name="resolution"]')
  const fpsSelect = q<HTMLSelectElement>('[name="fps"]')
  const bitrateSelect = q<HTMLSelectElement>('[name="bitrate"]')
  const startInput = q<HTMLInputElement>('[name="start"]')
  const endInput = q<HTMLInputElement>('[name="end"]')
  const openingInput = q<HTMLInputElement>('[name="opening"]')
  const supportLine = q<HTMLParagraphElement>('[data-support]')
  const progressBox = q<HTMLDivElement>('[data-progress]')
  const progressBar = q<HTMLProgressElement>('progress')
  const progressText = q<HTMLOutputElement>('[data-progress-text]')
  const downloadLink = q<HTMLAnchorElement>('[data-download]')
  const cancelButton = q<HTMLButtonElement>('[data-cancel]')
  const startButton = q<HTMLButtonElement>('[data-start]')

  const groups = new Map<string, HTMLOptGroupElement>()
  for (const preset of RESOLUTION_PRESETS) {
    let group = groups.get(preset.group)
    if (!group) {
      group = document.createElement('optgroup')
      group.label = preset.group
      groups.set(preset.group, group)
      resolutionSelect.append(group)
    }
    const option = new Option(preset.label, preset.id, preset.id === '1080p', preset.id === '1080p')
    group.append(option)
  }

  let running: AbortController | null = null
  let downloadUrl: string | null = null
  let probeToken = 0

  const readSettings = (): ExportVideoSettings => {
    const preset = findResolution(resolutionSelect.value) ?? RESOLUTION_PRESETS[1]!
    const fps = Number(fpsSelect.value)
    const bitrateMbps = bitrateSelect.value === 'auto' ? defaultBitrateMbps(preset.width, preset.height, fps) : Number(bitrateSelect.value)
    return { container: containerSelect.value as ContainerFormat, width: preset.width, height: preset.height, fps, bitrateMbps }
  }

  const durationSec = () => ctx.durationSec()
  const minStartSec = () => (openingInput.checked ? ctx.opening.startSec : ctx.opening.endSec)

  const bitrateOf = (settings: ExportVideoSettings, width: number, height: number, fps: number) =>
    bitrateSelect.value === 'auto' ? defaultBitrateMbps(width, height, fps) : settings.bitrateMbps

  /** 逐项探测并置灰不受支持的选项。 */
  async function refreshSupport() {
    const token = ++probeToken
    const settings = readSettings()
    const autoLabel = bitrateSelect.options[0]!
    autoLabel.textContent = `自动（${defaultBitrateMbps(settings.width, settings.height, settings.fps)} Mbps）`
    if (!webCodecsAvailable()) {
      supportLine.textContent = '当前浏览器不支持 WebCodecs，无法导出。'
      startButton.disabled = true
      return
    }
    for (const preset of RESOLUTION_PRESETS) {
      const ok = await isVideoConfigSupported({ ...settings, width: preset.width, height: preset.height, bitrateMbps: bitrateOf(settings, preset.width, preset.height, settings.fps) })
      if (token !== probeToken) return
      const option = resolutionSelect.querySelector<HTMLOptionElement>(`option[value="${preset.id}"]`)!
      option.disabled = !ok
      option.textContent = ok ? preset.label : `${preset.label}（不支持）`
    }
    for (const option of Array.from(fpsSelect.options)) {
      const fps = Number(option.value)
      const ok = await isVideoConfigSupported({ ...settings, fps, bitrateMbps: bitrateOf(settings, settings.width, settings.height, fps) })
      if (token !== probeToken) return
      option.disabled = !ok
      option.textContent = ok ? `${fps} fps` : `${fps} fps（不支持）`
    }
    for (const container of ['mp4', 'webm'] as const) {
      const ok = await isVideoConfigSupported({ ...settings, container })
      if (token !== probeToken) return
      const option = containerSelect.querySelector<HTMLOptionElement>(`option[value="${container}"]`)!
      option.disabled = !ok
    }
    const audio = await pickAudioConfig(settings.container)
    const videoOk = await isVideoConfigSupported(settings)
    if (token !== probeToken) return
    const codec = buildVideoEncoderConfig(settings).codec
    const audioLabel = audio ? (audio.codec === 'aac' ? 'AAC' : 'Opus') : '无（不支持音频编码）'
    const fallback = settings.container === 'mp4' && audio?.codec === 'opus' ? '（AAC 不可用，已回退 Opus）' : ''
    supportLine.textContent = videoOk
      ? `视频 ${codec} · ${settings.bitrateMbps} Mbps　音频 ${audioLabel}${fallback}`
      : `当前组合不受支持（${codec}），请换一个分辨率 / 帧率 / 格式。`
    startButton.disabled = !videoOk || running !== null
  }

  /**
   * 包含开场：起点下限为开场开头，起点停在 0 时拉到开场开头；不包含：下限为开场终点。
   * 下限按输入框显示的三位小数比较：开场开头 −3.6666667 显示为 −3.667，按原值比会被当成越界。
   */
  const syncRangeFloor = () => {
    const floor = Number(minStartSec().toFixed(3))
    startInput.min = String(floor)
    const start = Number(startInput.value)
    if (!Number.isFinite(start) || start < floor) startInput.value = String(Math.max(0, floor))
    else if (floor < 0 && Math.abs(start) < 1e-9) startInput.value = String(floor)
  }

  const setLocked = (locked: boolean) => {
    for (const node of ctx.lockTargets()) node.inert = locked
    trigger.disabled = locked
    for (const field of [containerSelect, resolutionSelect, fpsSelect, bitrateSelect, startInput, endInput, openingInput]) field.disabled = locked
  }

  const formatProgress = (progress: ExportProgress) => {
    const phase = progress.phase === 'video' ? '渲染编码' : progress.phase === 'audio' ? '混音编码' : '封装'
    return `${phase} ${progress.framesDone}/${progress.frameCount} 帧 · ${progress.fps.toFixed(1)} fps · ${progress.realtimeFactor.toFixed(2)}× 实时`
  }

  async function start() {
    if (running) return
    const settings = readSettings()
    const range = resolveExportRange({ startSec: Number(startInput.value), endSec: Number(endInput.value) }, durationSec(), ctx.opening, openingInput.checked)
    if (range.endSec - range.startSec < 1 / settings.fps) {
      supportLine.textContent = '导出区间为空，请检查起点 / 终点。'
      return
    }
    if (downloadUrl) URL.revokeObjectURL(downloadUrl)
    downloadUrl = null
    downloadLink.hidden = true
    running = new AbortController()
    setLocked(true)
    startButton.disabled = true
    cancelButton.hidden = false
    progressBox.hidden = false
    progressBar.value = 0
    progressText.textContent = '准备中…'
    let result: ExportResult | null = null
    try {
      result = await exportVideo(ctx.createSource({ intro: openingInput.checked }), {
        ...settings,
        ...range,
        signal: running.signal,
        onProgress: (progress) => {
          progressBar.value = progress.ratio
          progressText.textContent = formatProgress(progress)
        },
      })
      downloadUrl = URL.createObjectURL(result.blob)
      downloadLink.href = downloadUrl
      downloadLink.download = exportFileName(ctx.title(), settings, ctx.fileNamePrefix)
      downloadLink.hidden = false
      progressBar.value = 1
      const sizeMb = (result.blob.size / 1024 / 1024).toFixed(1)
      progressText.textContent =
        `完成：${result.frameCount} 帧 / ${result.durationSec.toFixed(2)} 秒，用时 ${result.elapsedSec.toFixed(1)} 秒` +
        ` · ${result.encodeFps.toFixed(1)} fps（${result.realtimeFactor.toFixed(2)}× 实时）· ${sizeMb} MB`
      ctx.message(`视频导出完成（${sizeMb} MB）。`)
    } catch (error) {
      if (error instanceof ExportCancelledError) {
        progressText.textContent = '已取消。'
      } else {
        progressText.textContent = `导出失败：${String(error)}`
        ctx.message(`视频导出失败：${String(error)}`, true)
        console.error(error)
      }
    } finally {
      running = null
      cancelButton.hidden = true
      setLocked(false)
      void refreshSupport()
    }
    return result
  }

  containerSelect.onchange = fpsSelect.onchange = bitrateSelect.onchange = resolutionSelect.onchange = () => void refreshSupport()
  openingInput.onchange = syncRangeFloor
  startButton.onclick = () => void start()
  cancelButton.onclick = () => running?.abort()
  dialog.addEventListener('cancel', (event) => {
    // Esc：导出进行中不关闭，避免误以为已取消。
    if (running) event.preventDefault()
  })
  q<HTMLButtonElement>('[data-close]').onclick = () => {
    if (!running) dialog.close()
  }

  trigger.onclick = () => {
    const duration = durationSec()
    endInput.max = startInput.max = String(Math.ceil(duration))
    if (!(Number(endInput.value) > 0) || Number(endInput.value) > duration) endInput.value = duration.toFixed(1)
    if (!running && ctx.openingDefault) {
      openingInput.checked = ctx.openingDefault()
      startInput.value = String(openingInput.checked ? Number(ctx.opening.startSec.toFixed(3)) : ctx.opening.endSec)
    }
    syncRangeFloor()
    dialog.showModal()
    void refreshSupport()
  }

  return { dialog, start, refreshSupport }
}
