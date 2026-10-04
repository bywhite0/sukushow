/**
 * llll × PJSK 渲染预览 —— 工作台界面。
 *
 * UI 沿用自家「llll 谱面放映室」的布局（header / viewer / transport / 右侧四分页设置），
 * 渲染后端换成 PJSK 的 wasm 管线（60 轨），配置项对应 native 的
 * `setPlayerPreviewConfig` 与播放器控制接口。
 *
 * 数据流：
 *   llll 原生谱面（{Notes, Bpms} 或 raw-deflate .bytes）
 *     → src/llll/chart.ts 解析（自家解析器）
 *     → src/llll/toMusicScore.ts 编码（轨道 0–59 不压缩）
 *     → wasm（PJSK 渲染，60 轨）
 */
import './pjsk.css'
import { MmwWasmPlayer } from '../../../pjsk-preview/src/lib/mmwWasm'
import type { PreviewRuntimeConfig } from '../../../pjsk-preview/src/lib/types'
import { buildAssetManifest } from '../../../pjsk-preview/src/assetManifest'
import { parseChart, decodeChart, type Chart } from '../../../pjsk-preview/src/llll/chart'
import { chartToMusicScore } from '../../../pjsk-preview/src/llll/toMusicScore'
import { loadPreviewSettings, savePreviewSettings, type PreviewSettings } from './pjsk/settingsPersist'
import { parseUrlPreviewParams } from './pjsk/url'
import { findSong, songAssets, fetchBytes, findSongCredits, creditsToMetadata, SONG_LIST_URL, SONG_CREDITS_URL } from '../../../pjsk-preview/src/llll/songAssets'
import { feverForSong } from '../../../pjsk-preview/src/llll/fever'
import { installExportDialog, probeAllConfigs } from './pjsk/exportDialog'
import type { SongSelectionStore } from '../songSelection'
import { createResourceLoading, formatResourceSize, measureResourceSizes, totalResourceSize, type ResourceLoadingTask } from '../resourceLoading'
import { mmwWasmFilename } from '../../../pjsk-preview/src/generated/mmwWasmAsset'
import { readResponseBytes } from '../../../llll-preview/src/resourceDownload'

declare global {
  interface Window {
    __LLL_PJSK__?: {
      player: MmwWasmPlayer
      loadChart: (...args: any[]) => Promise<void>
      demoChart: () => Chart
      renderLoop: () => void
      getChart: () => Chart | null
      exportDialog: ReturnType<typeof installExportDialog>
      probeExportConfigs: typeof probeAllConfigs
    }
  }
}

export type PjskMountOptions = {
  root: HTMLElement
  toolbar?: HTMLElement
  songSelection: SongSelectionStore
}

export type PjskViewHandle = {
  dispose: () => void
}

export function mount({ root, toolbar, songSelection }: PjskMountOptions): PjskViewHandle {
  let toolbarHost = toolbar
  root.innerHTML = `
<main>
<section class="viewer" aria-label="谱面预览">
 <div class="preview-heading"><div class="current-file"><span class="section-label">当前谱面</span><h1 id="chart-name">演示谱面</h1></div><span class="file-name" id="audio-name">未加载音频 · 可以无声预览</span></div>
 <div class="stage-shell"><div class="stage" id="stage"><canvas id="chart-canvas" aria-label="三维谱面画布"></canvas>
  <div class="resource-loading" data-resource-loading role="status" aria-live="polite">
   <div class="resource-loading-card">
    <strong data-resource-loading-title>正在准备 PJSK 预览</strong>
    <progress data-resource-loading-progress max="1" value="0" aria-label="预览资源加载进度"></progress>
    <div class="resource-loading-meta"><span data-resource-loading-detail>正在连接资源…</span><output data-resource-loading-percent>0%</output></div>
    <span class="resource-loading-size" data-resource-loading-size hidden></span>
   </div>
  </div>
 </div></div>
 <div id="message" class="viewer-status" role="status" aria-live="polite">正在初始化渲染器…</div>
 <div class="transport"><label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0"><div class="transport-row"><button id="play" class="primary" aria-label="播放">▶ 播放</button><button id="restart" class="quiet" aria-label="回到开头">↺ 重播</button><output id="time">00:00.000 / 00:36.000</output><label class="rate-label">播放倍率<select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button id="fullscreen" class="quiet">全屏预览</button><button id="export-video" class="quiet" type="button">导出视频</button></div></div>
</section>
<aside aria-label="预览设置">
 <div class="inspector-heading"><h2>预览设置</h2><span>自动保存</span></div>
 <div class="settings-tabs" role="tablist" aria-label="设置分类">
  <button id="tab-track" role="tab" aria-selected="true" aria-controls="panel-track">播放与轨道</button>
  <button id="tab-display" role="tab" aria-selected="false" aria-controls="panel-display" tabindex="-1">显示与特效</button>
  <button id="tab-audio" role="tab" aria-selected="false" aria-controls="panel-audio" tabindex="-1">音量</button>
  <button id="tab-score" role="tab" aria-selected="false" aria-controls="panel-score" tabindex="-1">计分</button>
 </div>
 <div class="settings-body">
 <section class="panel" id="panel-track" role="tabpanel" aria-labelledby="tab-track" tabindex="0"><h2>轨道与播放</h2>
<label class="setting" for="note-speed"><span>下落速度 noteSpeed<output id="note-speed-value">10.5</output></span><input id="note-speed" type="range" min="1" max="12" step="0.1" value="10.5"></label>
<label class="setting" for="offset"><span>音频偏移 <small>毫秒</small></span><input id="offset" type="number" min="-10000" max="10000" step="10" value="0"><small>正值让音频晚于谱面开始。</small></label>
<label class="setting" for="note-skin"><span>Note Skin</span><select id="note-skin"><option value="0" selected>Notes 01</option><option value="1">Notes 02</option></select></label>
<label class="check"><input id="mirror" type="checkbox">左右镜像</label>
<label class="check"><input id="lines" type="checkbox" checked>显示同时押线</label>
<label class="check"><input id="flick-anim" type="checkbox" checked>Flick 箭头动画</label>
<label class="check"><input id="hold-anim" type="checkbox" checked>Hold 流动动画</label>
</section>
<section class="panel" id="panel-display" role="tabpanel" aria-labelledby="tab-display" tabindex="0" hidden><h2>显示与特效</h2>
<label class="setting" for="stage-cover"><span>上隐 StageCover<output id="stage-cover-value">0</output></span><input id="stage-cover" type="range" min="0" max="100" step="1" value="0"></label>
<label class="setting" for="stage-opacity"><span>舞台不透明度<output id="stage-opacity-value">100</output></span><input id="stage-opacity" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="bg-brightness"><span>背景亮度<output id="bg-brightness-value">100</output></span><input id="bg-brightness" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="hold-alpha"><span>长条透明度<output id="hold-alpha-value">74</output></span><input id="hold-alpha" type="range" min="0" max="100" step="1" value="74"></label>
<label class="setting" for="guide-alpha"><span>Guide 浓度<output id="guide-alpha-value">50</output></span><input id="guide-alpha" type="range" min="0" max="100" step="1" value="50"></label>
<label class="setting" for="effect-opacity"><span>特效不透明度<output id="effect-opacity-value">100</output></span><input id="effect-opacity" type="range" min="0" max="100" step="1" value="100"></label>
<label class="check"><input id="fever-display" type="checkbox" checked>Fever 特效</label>
<label class="check"><input id="super-fever" type="checkbox">SuperFever 配色（充能满时切换）</label>
<label class="setting" for="effect-profile"><span>特效配置</span><select id="effect-profile"><option value="0" selected>Profile 0</option><option value="1">Profile 1</option></select></label>
<p class="setting" id="fever-status"><small>Fever：未加载曲目。</small></p>
</section>
<section class="panel" id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" tabindex="0" hidden><h2>音量</h2>
<label class="setting" for="bgm-volume"><span>BGM 音量<output id="bgm-volume-value">100</output></span><input id="bgm-volume" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="sound-volume"><span>音效音量<output id="sound-volume-value">100</output></span><input id="sound-volume" type="range" min="0" max="100" step="1" value="100"></label>
</section>
<section class="panel" id="panel-score" role="tabpanel" aria-labelledby="tab-score" tabindex="0" hidden><h2>计分预览</h2>
<p class="setting"><small>计分与段位由 wasm 侧的 PJSK HUD 接管，暂无可调项。</small></p>
</section></div>
<div class="inspector-footer">设置仅影响预览，不会修改源文件。</div>
</aside>
</main>`

  if (!toolbarHost) {
    toolbarHost = document.createElement('div')
    toolbarHost.className = 'file-toolbar'
    toolbarHost.setAttribute('aria-label', '打开谱面与音频')
    toolbarHost.innerHTML = `
      <div id="song-picker-mount" class="song-picker" aria-label="选择曲目"></div>
      <button id="open-chart" class="file-action" type="button">＋ 打开谱面</button>
      <input class="sr-only" id="chart-file" type="file" accept=".json,.bytes,application/json" aria-label="选择谱面文件">
      <button id="open-audio" class="quiet" type="button">添加音频</button>
      <input class="sr-only" id="audio-file" type="file" accept="audio/*" aria-label="选择本地音频">
      <button id="demo" class="text-button" type="button" aria-label="重新打开演示谱">演示谱</button>`
    root.prepend(toolbarHost)
  }

  const el = <T extends HTMLElement = HTMLElement>(id: string) => {
    const selector = `#${id}`
    const node = root.querySelector<T>(selector) ?? toolbarHost?.querySelector<T>(selector)
    if (!node) throw new Error(`缺少元素 #${id}`)
    return node
  }
  const input = (id: string) => el<HTMLInputElement>(id)
  const select = (id: string) => el<HTMLSelectElement>(id)
const message = (text: string, error = false) => {
  const node = el('message')
  node.textContent = text
  node.classList.toggle('error', error)
}

el('open-chart').onclick = () => input('chart-file').click()
el('open-audio').onclick = () => input('audio-file').click()

// ---- 设置分页（方向键 / Home / End 导航）----
const settingTabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
function selectSettingsTab(tab: HTMLButtonElement) {
  for (const item of settingTabs) {
    const selected = item === tab
    item.setAttribute('aria-selected', String(selected))
    item.tabIndex = selected ? 0 : -1
    el(item.getAttribute('aria-controls')!).hidden = !selected
  }
}
for (const [index, tab] of settingTabs.entries()) {
  tab.onclick = () => selectSettingsTab(tab)
  tab.onkeydown = (event) => {
    const positions: Record<string, number> = {
      ArrowRight: (index + 1) % settingTabs.length,
      ArrowLeft: (index + settingTabs.length - 1) % settingTabs.length,
      Home: 0,
      End: settingTabs.length - 1,
    }
    const next = positions[event.key]
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    selectSettingsTab(settingTabs[next]!)
    settingTabs[next]!.focus()
  }
}

  const loading = createResourceLoading(el<HTMLDivElement>('stage'), root.querySelector<HTMLElement>('.transport')!)
  const player = new MmwWasmPlayer()
  let disposed = false
  let unsubscribeSongSelection = () => {}
let runtimeReady = false
let currentChart: Chart | null = null
let rafHandle = 0

/** 表单 → wasm 的 PreviewRuntimeConfig。 */
function readRuntimeConfig(): PreviewRuntimeConfig {
  return {
    mirror: input('mirror').checked,
    flickAnimation: input('flick-anim').checked,
    holdAnimation: input('hold-anim').checked,
    simultaneousLine: input('lines').checked,
    effectProfile: Number(select('effect-profile').value) === 1 ? 1 : 0,
    noteSkin: Number(select('note-skin').value) === 1 ? 1 : 0,
    noteSpeed: Number(input('note-speed').value),
    holdAlpha: Number(input('hold-alpha').value) / 100,
    guideAlpha: Number(input('guide-alpha').value) / 100,
    stageCover: Number(input('stage-cover').value) / 100,
    stageOpacity: Number(input('stage-opacity').value) / 100,
    backgroundBrightness: Number(input('bg-brightness').value) / 100,
    effectOpacity: Number(input('effect-opacity').value) / 100,
    bgmVolume: Number(input('bgm-volume').value) / 100,
    soundVolume: Number(input('sound-volume').value) / 100,
  }
}

/** 表单 → 持久化设置。 */
function readSettings(): PreviewSettings {
  return {
    ...loadPreviewSettings(),
    noteSpeed: Number(input('note-speed').value),
    offsetMs: Number(input('offset').value),
    mirror: input('mirror').checked,
    lines: input('lines').checked,
    flickAnimation: input('flick-anim').checked,
    holdAnimation: input('hold-anim').checked,
    noteSkin: Number(select('note-skin').value) === 1 ? 1 : 0,
    effectProfile: Number(select('effect-profile').value) === 1 ? 1 : 0,
    stageCover: Number(input('stage-cover').value),
    stageOpacity: Number(input('stage-opacity').value),
    backgroundBrightness: Number(input('bg-brightness').value),
    holdAlpha: Number(input('hold-alpha').value),
    guideAlpha: Number(input('guide-alpha').value),
    effectOpacity: Number(input('effect-opacity').value),
    feverDisplay: input('fever-display').checked,
    superFever: input('super-fever').checked,
    bgmVolume: Number(input('bgm-volume').value),
    soundVolume: Number(input('sound-volume').value),
    rate: Number(select('rate').value),
  }
}

function persistSettings() {
  savePreviewSettings(readSettings())
}

/** 持久化设置 → 表单。 */
function applySettingsToForm(settings: PreviewSettings) {
  const setRange = (id: string, value: number) => {
    input(id).value = String(value)
    el(`${id}-value`).textContent = String(Math.round(value * 10) / 10)
  }
  setRange('note-speed', settings.noteSpeed ?? 10.5)
  input('offset').value = String(settings.offsetMs ?? 0)
  input('mirror').checked = settings.mirror ?? false
  input('lines').checked = settings.lines ?? true
  input('flick-anim').checked = settings.flickAnimation ?? true
  input('hold-anim').checked = settings.holdAnimation ?? true
  select('note-skin').value = String(settings.noteSkin ?? 0)
  select('effect-profile').value = String(settings.effectProfile ?? 0)
  setRange('stage-cover', settings.stageCover ?? 0)
  setRange('stage-opacity', settings.stageOpacity ?? 100)
  setRange('bg-brightness', settings.backgroundBrightness ?? 100)
  setRange('hold-alpha', settings.holdAlpha ?? 74)
  setRange('guide-alpha', settings.guideAlpha ?? 50)
  setRange('effect-opacity', settings.effectOpacity ?? 100)
  input('fever-display').checked = settings.feverDisplay ?? true
  input('super-fever').checked = settings.superFever ?? false
  setRange('bgm-volume', settings.bgmVolume ?? 100)
  setRange('sound-volume', settings.soundVolume ?? 100)
  select('rate').value = String(settings.rate ?? 1)
}
applySettingsToForm(loadPreviewSettings())

/** 设置变更 → 推给 wasm。 */
function applyRuntimeConfig() {
  if (!runtimeReady) return
  const config = readRuntimeConfig()
  player.setPreviewConfig(config)
  player.setAudioVolumes(config.bgmVolume, config.soundVolume)
  player.setFeverDisplay(input('fever-display').checked)
  player.setSuperFeverEnabled(input('super-fever').checked)
}

for (const id of [
  'mirror', 'lines', 'flick-anim', 'hold-anim', 'note-skin', 'effect-profile',
  'stage-cover', 'stage-opacity', 'bg-brightness', 'hold-alpha', 'guide-alpha',
  'effect-opacity', 'fever-display', 'super-fever', 'bgm-volume', 'sound-volume', 'note-speed',
]) {
  const node = input(id)
  const handler = () => {
    const output = root.querySelector<HTMLOutputElement>(`#${id}-value`)
    if (output && node.type === 'range') output.textContent = String(Math.round(Number(node.value) * 10) / 10)
    applyRuntimeConfig()
    persistSettings()
  }
  node.oninput = handler
  node.onchange = handler
}

const format = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`

function setDuration(durationSec: number) {
  input('timeline').max = String(durationSec)
}

/**
 * 推送当前曲目的 Fever 时段；无数据时显式推 -1 关闭（不沿用上一首）。
 *
 * Fever 只认曲目 Id（歌曲主数据），本地文件导入没有 Id，故一律关闭——
 * 与 `apps/llll-preview` 的「未知歌曲不估算」同口径。
 */
function applyFeverWindow(songId: string | null) {
  applyFeverCharge(currentChartForCharge, songId)
  const window = feverForSong(songId)
  if (window) {
    player.setFeverWindow(window.start, window.end)
  } else {
    player.setFeverWindow(-1, -1)
  }
  // FeverChance 不再用时间窗，改走充能（见 applyFeverCharge / tickFeverCharge）。
  const status = root.querySelector<HTMLElement>('#fever-status')
  if (status) {
    const n = currentChartForCharge && window
      ? currentChartForCharge.notes.filter((note) => note.time < window!.start).length
      : 0
    status.innerHTML = window
      ? `<small>Fever：${window.start.toFixed(3)} – ${window.end.toFixed(3)} 秒` +
        (n
          ? `；FeverChance 充能：需 ${Math.ceil(n * 0.7)} / ${n} 个音符</small>`
          : '；FeverChance 充能：本曲无前置音符</small>')
      : '<small>Fever：本曲无数据（不估算）。</small>'
  }
}

/**
 * FeverChance 充能：分母 = Fever 段起点之前的可判定音符数（静态），
 * 分子 = 其中已经过去的那些（每帧推进）。口径照 PJSK 的
 * `progress = feverCount / totalFeverCount`。
 *
 * 音符时刻用谱面自身的 `time`（秒）——与 feverMetadata 同域（都相对音频起点），
 * 不需要再减 lead-in。窗口判定用「Fever 起点」而不是总时长：总时长含收尾静音，
 * 拿它当分母会让进度永远充不满。
 */
/** loadChart 刚加载的谱面；applyFeverWindow 用它算充能分母。 */
let currentChartForCharge: Chart | null = null

function applyFeverCharge(chart: Chart | null, songId: string | null) {
  const window = feverForSong(songId)
  if (!chart || !window) {
    player.setFeverChargeTimes([])
    player.setFeverCharge(0, 0)
    return
  }
  // 分母 = Fever 段起点之前的音符时刻（升序）；分子由 renderFrame 每帧按时刻重算。
  player.setFeverChargeTimes(
    chart.notes
      .map((note) => note.time)
      .filter((t) => t < window.start)
      .sort((a, b) => a - b),
  )
}

// ---- 资源预载 ----
type PreloadProgress = {
  done: number
  total: number
  entry?: ReturnType<typeof buildAssetManifest>[number]
  phase: 'measure' | 'download' | 'ready'
  bytes?: number
  downloadedBytes?: number
  totalBytes?: number
}

async function preloadAll(
  sizes: ReadonlyMap<string, number>,
  totalBytes: number | undefined,
  initialDownloadedBytes: number,
  onProgress: (progress: PreloadProgress) => void,
) {
  const entries = buildAssetManifest()
  let done = 0
  let downloadedBytes = initialDownloadedBytes
  onProgress({
    done,
    total: entries.length,
    entry: entries[0],
    phase: 'measure',
    downloadedBytes,
    totalBytes,
  })
  for (const entry of entries) {
    if (disposed) return
    let byteLength: number | undefined
    try {
      const response = await fetch(entry.url)
      if (disposed) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      onProgress({
        done,
        total: entries.length,
        entry,
        phase: 'download',
        downloadedBytes,
        totalBytes,
      })
      const expectedBytes = sizes.get(entry.url)
      const entryStartBytes = downloadedBytes
      const bytes = await readResponseBytes(response, (state) => {
        const currentBytes = expectedBytes === undefined ? 0 : Math.min(expectedBytes, state.downloadedBytes)
        onProgress({
          done,
          total: entries.length,
          entry,
          phase: 'download',
          downloadedBytes: entryStartBytes + currentBytes,
          totalBytes,
        })
      })
      byteLength = bytes.byteLength
      if (expectedBytes !== undefined) {
        downloadedBytes = Math.min(totalBytes ?? Number.POSITIVE_INFINITY, downloadedBytes + byteLength)
      }
      if (entry.kind === 'asset') await player.preloadAsset(entry.key, bytes)
      else if (entry.kind === 'font') await player.preloadFont(entry.key, bytes)
      else await player.preloadSound(entry.key, bytes)
    } catch (error) {
      if (disposed) return
      // 音效缺失不该阻断渲染；贴图/字体缺失则上抛。
      if (entry.kind !== 'sound') throw error
      console.warn('[llll-pjsk] 音效加载失败：', entry.url, error)
    }
    if (disposed) return
    done += 1
    onProgress({ done, total: entries.length, entry, phase: 'ready', bytes: byteLength, downloadedBytes, totalBytes })
  }
  return downloadedBytes
}

/** 当前曲目的 BGM / 曲绘 URL（供「添加音频」与曲目切换复用）。 */
let currentSongAssets: { bgmUrl: string | null; coverUrl: string | null } = {
  bgmUrl: null,
  coverUrl: null,
}

type LoadChartOptions = {
  task?: ResourceLoadingTask
  stepOffset?: number
  downloadSizes?: ReadonlyMap<string, number>
  downloadTotalBytes?: number
  downloads?: Map<string, number>
}

// The wasm session expects a decodable cover image even when the catalog has
// no local jacket asset. This bundled texture keeps the renderer usable.
const EMPTY_COVER_URL = '/in_game_difficulty_bg_101.png'

async function loadChart(
  chart: Chart,
  label: string,
  sourceOffsetMs = 0,
  assets: { bgmUrl?: string | null; coverUrl?: string | null } = {},
  difficulty: string | null = null,
  credits: { lyricist: string | null; composer: string | null; arranger: string | null; vocal: string | null } | null = null,
  options: LoadChartOptions = {},
) {
  if (disposed) return
  const ownsTask = !options.task
  const resourceTask = options.task ?? loading.begin(`正在准备 ${label} 的预览`, 3)
  const step = (value: number) => value + (options.stepOffset ?? 0)
  try {
  const score = chartToMusicScore(chart)
  const maxLane = score.NoteList.reduce((max, note) => Math.max(max, note.laneEnd), 0)
  // 充能分母要在加载谱面时就备好；曲目 Id 在 loadChart 里拿不到，
  // 故由调用方随后用 applyFeverWindow 刷状态行，分母本身用当前曲目。
  currentChartForCharge = chart

  // BGM 与曲绘缺失不该阻断渲染：失败一律退回 null。
  const bgmUrl = assets.bgmUrl ?? currentSongAssets.bgmUrl
  const coverUrl = assets.coverUrl ?? currentSongAssets.coverUrl
  if (bgmUrl || coverUrl) {
    message('正在加载曲目资源…')
  }
  const downloadSizes = options.downloadSizes ? new Map(options.downloadSizes) : await measureResourceSizes([bgmUrl, coverUrl, EMPTY_COVER_URL])
  // 有曲绘时只会请求曲绘；占位图仅在目录明确没有曲绘时才会下载。
  if (coverUrl) downloadSizes.delete(EMPTY_COVER_URL)
  const downloadTotalBytes = options.downloadTotalBytes ?? totalResourceSize(downloadSizes)
  const downloads = options.downloads ?? new Map<string, number>()
  resourceTask.update(step(0), bgmUrl || coverUrl ? '正在下载曲目资源…' : '正在初始化谱面…', {
    downloadedBytes: [...downloads.values()].reduce((sum, item) => sum + item, 0),
    totalBytes: downloadTotalBytes,
  })
  const updateDownload = (name: string, state: { phase: 'download' | 'ready'; downloadedBytes?: number; totalBytes?: number }) => {
    if (state.downloadedBytes !== undefined) downloads.set(name, state.downloadedBytes)
    const downloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
    resourceTask.setLabel(`下载 ${name}`)
    resourceTask.update(step(0), state.phase === 'download' ? `正在下载 ${name}…` : `${name} 已下载`, {
      downloadedBytes,
      totalBytes: downloadTotalBytes,
    })
  }
  const [bgmBytes, loadedCoverBytes] = await Promise.all([
    fetchBytes(bgmUrl, (state) => updateDownload('BGM', state)),
    fetchBytes(coverUrl, (state) => updateDownload('曲绘', state)),
  ])
  if (disposed) return
  let downloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
  resourceTask.update(step(1), loadedCoverBytes ? '曲目资源已下载，正在准备曲绘…' : '曲绘缺失，正在下载占位图…', {
    downloadedBytes,
    totalBytes: downloadTotalBytes,
  })
  const coverBytes = loadedCoverBytes ?? await fetchBytes(EMPTY_COVER_URL, (state) => updateDownload('占位曲绘', state))
  currentSongAssets = { bgmUrl, coverUrl }

  await player.loadSession({
    scoreText: JSON.stringify(score),
    scoreFormat: 'custom-score-json',
    sourceOffsetMs,
    effectiveLeadInMs: Math.max(sourceOffsetMs, 9000),
    bgmBytes,
    coverBytes,
    metadata: {
      title: label,
      // 词曲编来自 wikiwiki，vocal 来自 masterdata（center + singer）。
      lyricist: credits?.lyricist ?? null,
      composer: credits?.composer ?? null,
      arranger: credits?.arranger ?? null,
      vocal: credits?.vocal ?? null,
      // 难度走独立字段：wasm 侧据此在曲绘旁绘制彩色难度徽章，
      // 不拼进曲名。
      difficulty,
      customScoreInfo: false,
      scoreTitle: label,
      scoreCreator: null,
    },
  })
  if (disposed) return
  const sessionDownloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
  resourceTask.update(step(2), '资源已注入，正在绘制首帧…', { downloadedBytes: sessionDownloadedBytes, totalBytes: downloadTotalBytes })
  currentChart = chart
  const config = readRuntimeConfig()
  player.setPreviewConfig(config)
  player.setAudioVolumes(config.bgmVolume, config.soundVolume)
  player.seek(0)
  player.renderFrame()
  const snapshot = player.getStateSnapshot()
  setDuration(Math.max(chart.duration, snapshot.durationSec))
  // 页面 UI 保留难度信息（HUD 上的曲名不带难度，难度走独立徽章）。
  const uiLabel = difficulty ? `${label}　[${difficulty}]` : label
  el('chart-name').textContent = uiLabel
  const parts = [`音符 ${score.NoteList.length} 个（Hold 展开后）`, `最大轨道 ${maxLane}`]
  parts.push(bgmBytes ? 'BGM ✓' : 'BGM —')
  parts.push(loadedCoverBytes ? '曲绘 ✓' : '曲绘 —')
  el('audio-name').textContent = bgmBytes ? 'BGM 已加载' : '未加载音频 · 可以无声预览'
  message(`${uiLabel}　${parts.join('　')}`)
  resourceTask.update(step(3), '预览已就绪', { downloadedBytes: sessionDownloadedBytes, totalBytes: downloadTotalBytes })
  } finally {
    if (ownsTask) resourceTask.finish()
  }
}

/** 按曲目 Id 打开：加载谱面 + BGM + 曲绘。 */
async function loadSongById(songId: string, difficulty: string, sourceOffsetMs = 0) {
  if (disposed) return
  const resourceTask = loading.begin(`正在加载曲目 ${songId} [${difficulty}]`, 5)
  const downloads = new Map<string, number>()
  const downloadedBytes = () => [...downloads.values()].reduce((sum, value) => sum + value, 0)
  let downloadTotalBytes: number | undefined
  try {
    const song = await findSong(songId, (state) => {
      if (state.downloadedBytes !== undefined) downloads.set(SONG_LIST_URL, state.downloadedBytes)
      resourceTask.setLabel('加载曲目库')
      resourceTask.update(0, state.phase === 'download' ? '正在下载 song-list.json…' : '曲目库已下载，正在建立索引…', {
        downloadedBytes: downloadedBytes(),
        totalBytes: downloadTotalBytes,
      })
    })
    if (disposed) return
    if (!song) {
      throw new Error(`曲目列表里没有 Id ${songId}`)
    }
    resourceTask.setLabel(`正在加载 ${song.title} [${difficulty}]`)
    resourceTask.update(1, '正在查找谱面…')
    const chartFile = song.charts[difficulty]
    if (!chartFile) {
      throw new Error(`曲目 ${songId} 没有难度 ${difficulty} 的谱面`)
    }
    const chartUrl = `/assets/chart/${chartFile}`
    const songAssetUrls = songAssets(song)
    const downloadSizes = await measureResourceSizes([
      SONG_LIST_URL,
      SONG_CREDITS_URL,
      chartUrl,
      songAssetUrls.bgmUrl,
      songAssetUrls.coverUrl,
      EMPTY_COVER_URL,
    ])
    // 有曲绘时只会请求曲绘；占位图仅在目录明确没有曲绘时才会下载。
    if (songAssetUrls.coverUrl) downloadSizes.delete(EMPTY_COVER_URL)
    downloadTotalBytes = totalResourceSize(downloadSizes)
    resourceTask.update(1, '正在查找谱面…', { downloadedBytes: downloadedBytes(), totalBytes: downloadTotalBytes })
    message(`正在下载谱面 ${chartFile}…`)
    const response = await fetch(chartUrl)
    if (disposed) return
    if (!response.ok) {
      throw new Error(`谱面下载失败（${response.status}）：${chartFile}`)
    }
    resourceTask.update(1, `正在下载谱面 ${chartFile}…`, {
      downloadedBytes: 0,
      totalBytes: downloadTotalBytes,
    })
    // 谱面是 raw-deflate 的 .bytes；decodeChart 自动识别 JSON / 压缩两种形态。
    const chartStartBytes = downloadedBytes()
    const chartSize = downloadSizes.get(chartUrl)
    const chartBytes = await readResponseBytes(response, (state) => {
      const current = chartSize === undefined ? 0 : Math.min(chartSize, state.downloadedBytes)
      resourceTask.update(1, `正在下载谱面 ${chartFile}…`, {
        downloadedBytes: chartStartBytes + current,
        totalBytes: downloadTotalBytes,
      })
    })
    if (chartSize !== undefined) downloads.set(chartUrl, Math.min(chartSize, chartBytes.byteLength))
    const chart = decodeChart(chartBytes)
    resourceTask.update(2, `谱面已下载（${formatResourceSize(chartBytes.byteLength)}），正在读取曲目资料…`, {
      downloadedBytes: downloadedBytes(),
      totalBytes: downloadTotalBytes,
    })
    if (disposed) return
    // 词曲编（wiki）+ vocal（masterdata）；缺失不该阻断加载。
    let credits = null
    try {
      credits = creditsToMetadata(await findSongCredits(songId, (state) => {
        if (state.downloadedBytes !== undefined) downloads.set(SONG_CREDITS_URL, state.downloadedBytes)
        resourceTask.setLabel('加载曲目资料')
        resourceTask.update(2, state.phase === 'download' ? '正在下载 song-credits.json…' : '曲目资料已下载，正在建立预览…', {
          downloadedBytes: downloadedBytes(),
          totalBytes: downloadTotalBytes,
        })
      }))
    } catch (error) {
      console.warn('[llll-pjsk] 曲目详情加载失败：', error)
      downloads.set(SONG_CREDITS_URL, 0)
    }
    // 曲名不含难度：难度走独立的 metadata.difficulty，由 HUD 画成徽章。
    await loadChart(chart, song.title, sourceOffsetMs, songAssetUrls, difficulty, credits, {
      task: resourceTask,
      stepOffset: 2,
      downloadSizes,
      downloadTotalBytes,
      downloads,
    })
    if (disposed) return
    applyFeverWindow(songId)
  } finally {
    resourceTask.finish()
  }
}

/** 60 轨全域演示谱：覆盖 Single / Flick / Hold / Trace 与最宽音符。 */
function demoChart(): Chart {
  const flags = (type: number, l: number, r: number, l2 = 0, r2 = 0) =>
    (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22)
  const notes: { Uid: number; just: string; holds: string[]; Flags: number }[] = []
  const add = (time: number, type: number, l: number, r: number, end = 0, l2 = 0, r2 = 0) =>
    notes.push({
      Uid: notes.length + 1,
      just: String(time),
      holds: end ? [String(end)] : [],
      Flags: flags(type, l, r, l2, r2),
    })
  for (let bar = 0; bar < 8; bar++) {
    const t = 2 + bar * 4
    add(t, 0, 0, 59) // 最宽 Single：横跨 60 轨
    add(t + 0.5, 2, 10, 20) // Flick
    add(t + 1, 3, 30, 40) // Trace
    add(t + 1.5, 1, 5, 15, t + 2.5, 45, 55) // Hold：从左跨到右
    add(t + 2, 0, 25, 35)
    add(t + 2.5, 0, 58, 58) // 最右一轨
    add(t + 3, 2, 0, 5)
    add(t + 3.5, 0, 12, 48) // 宽 Single
  }
  return parseChart({ Notes: notes, Bpms: [{ Time: 0, Bpm: 120 }] })
}

let liveRenderingSuspended = false

function renderLoop() {
  if (disposed || !runtimeReady || liveRenderingSuspended) return
  player.renderFrame()
  const snapshot = player.getStateSnapshot()
  if (currentChart) {
    input('timeline').value = String(snapshot.currentTimeSec)
    el('time').textContent = `${format(snapshot.currentTimeSec)} / ${format(snapshot.chartEndSec)}`
  }
  el('play').textContent = snapshot.transportState === 'playing' ? 'Ⅱ 暂停' : '▶ 播放'
  rafHandle = requestAnimationFrame(renderLoop)
}

/** 从 URL 参数加载谱面（`?chart=<url>`，或 config/cfg 里的 chart/llll）。 */
async function loadFromUrlParams(): Promise<boolean> {
  if (disposed) return false
  let params
  try {
    params = parseUrlPreviewParams(new URL(window.location.href))
  } catch {
    return false
  }

  const url = params.chart || params.customScoreJson
  if (!url) return false

  const resourceTask = loading.begin(`正在下载 URL 谱面`, 2)
  resourceTask.setLabel(`下载 ${url.split('/').pop() ?? url}`)
  try {
  message(`正在下载谱面 ${url}…`)
  const response = await fetch(url)
  if (disposed) return false
  if (!response.ok) {
    throw new Error(`谱面下载失败（${response.status}）：${url}`)
  }
  const chartTotalBytes = Number(response.headers?.get?.('content-length'))
  resourceTask.update(0, `正在下载 ${url.split('/').pop() ?? url}…`, {
    downloadedBytes: 0,
    totalBytes: Number.isFinite(chartTotalBytes) && chartTotalBytes > 0 ? chartTotalBytes : undefined,
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (disposed) return false
  const asText = new TextDecoder().decode(bytes)
  const chart = asText.trimStart().startsWith('{')
    ? parseChart(JSON.parse(asText.replace(/^\ufeff/, '')))
    : decodeChart(bytes)
  resourceTask.update(1, `谱面已下载（${formatResourceSize(bytes.byteLength)}），正在建立预览…`, {
    downloadedBytes: bytes.byteLength,
    totalBytes: Number.isFinite(chartTotalBytes) && chartTotalBytes > 0 ? chartTotalBytes : bytes.byteLength,
  })

  const label = params.title ?? params.scoreTitle ?? url.split('/').pop() ?? 'URL 谱面'
  await loadChart(chart, label, params.rawOffsetMs ?? 0)
  if (disposed) return false
  applyFeverWindow(null)
  return true
  } finally {
    resourceTask.finish()
  }
}

async function boot() {
  if (disposed) return
  const entries = buildAssetManifest()
  const manifestTotal = entries.length
  const bootTask = loading.begin('正在准备 PJSK 预览', manifestTotal + 2)
  try {
  const wasmUrl = `/wasm/${mmwWasmFilename}`
  bootTask.update(0, '正在统计 PJSK 资源大小…')
  const sizes = await measureResourceSizes([wasmUrl, ...entries.map((entry) => entry.url)])
  const totalBytes = totalResourceSize(sizes)
  const wasmBytes = sizes.get(wasmUrl) ?? 0
  bootTask.update(0, '资源大小已统计，正在下载 wasm 渲染器…', { downloadedBytes: 0, totalBytes })
  const canvas = el<HTMLCanvasElement>('chart-canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.parentElement!.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  canvas.width = width * dpr
  canvas.height = height * dpr

  bootTask.update(0, '正在下载 wasm 渲染器…')
  message('正在初始化渲染器…')
  await player.init(canvas, width, height, dpr)
  if (disposed) return
  bootTask.update(1, 'wasm 渲染器已加载', { downloadedBytes: wasmBytes, totalBytes })
  runtimeReady = true
  applyRuntimeConfig()

  const downloadedBytes = await preloadAll(sizes, totalBytes, wasmBytes, (progress) => {
    if (progress.phase === 'measure') {
      bootTask.setLabel('统计 PJSK 资源')
      bootTask.update(1, '正在统计 PJSK 资源大小…', { downloadedBytes: progress.downloadedBytes, totalBytes: progress.totalBytes })
      return
    }
    const { entry } = progress
    if (!entry) return
    const kind = entry.kind === 'asset' ? '贴图' : entry.kind === 'font' ? '字体' : '音效'
    const label = `${kind} ${entry.key}`
    const detail = progress.phase === 'download'
      ? `正在下载 ${label}…`
      : `已加载 ${label}`
    bootTask.setLabel(progress.phase === 'download' ? '下载 PJSK 资源' : '准备 PJSK 资源')
    bootTask.update(1 + progress.done, detail, { downloadedBytes: progress.downloadedBytes, totalBytes: progress.totalBytes })
    message(`${detail}　${progress.done}/${progress.total}`)
  })
  if (disposed) return
  bootTask.update(manifestTotal + 1, '渲染资源已就绪，正在载入曲目…', { downloadedBytes, totalBytes })
  message('渲染器就绪。')

  // 优先级：?song= > ?chart= > 演示谱。
  const search = new URLSearchParams(location.search)
  const selected = songSelection.get()
  if (selected) {
    const songId = selected.songId
    const difficulty = selected.difficulty
    // select 不触发 onChange，由这里自己 await，保证 URL 进来时不会重复加载。
    try {
      await loadSongById(songId, difficulty, Number(search.get('offset') ?? 0))
      if (disposed) return
      renderLoop()
      bootTask.update(manifestTotal + 2, '预览已就绪')
      bootTask.finish()
      return
    } catch (error) {
      message(`曲目 ${songId} 加载失败：${String(error)}。已回落到演示谱。`, true)
    }
  }

  // 有 URL 参数就用它，否则回落到演示谱。
  try {
    if (await loadFromUrlParams()) {
      if (disposed) return
      renderLoop()
      bootTask.update(manifestTotal + 2, '预览已就绪')
      bootTask.finish()
      return
    }
  } catch (error) {
    message(`URL 谱面加载失败：${String(error)}。已回落到演示谱。`, true)
  }

  await loadChart(demoChart(), '演示谱面')
  if (disposed) return
  applyFeverWindow(null)
  renderLoop()
  bootTask.update(manifestTotal + 2, '预览已就绪')
  bootTask.finish()
  } catch (error) {
    bootTask.fail(`PJSK 资源加载失败：${String(error)}`)
    throw error
  }
}

el('play').onclick = async () => {
  if (!runtimeReady) return
  try {
    await player.unlockAudio()
    const snapshot = player.getStateSnapshot()
    if (snapshot.transportState === 'playing') {
      player.pause()
    } else {
      const ok = await player.play()
      if (!ok) message('播放被拒绝（可能缺少音频或需要用户手势）。', true)
    }
  } catch (error) {
    message(`播放失败：${String(error)}`, true)
  }
}

el('restart').onclick = () => {
  player.seek(0)
  player.renderFrame()
}

input('timeline').oninput = () => {
  player.seek(Number(input('timeline').value))
  player.renderFrame()
}

select('rate').onchange = () => {
  player.setPlaybackRate(Number(select('rate').value))
  persistSettings()
}

input('offset').onchange = () => {
  if (!input('offset').checkValidity() || !input('offset').value) {
    message('音频偏移需在 −10000 至 10000 毫秒之间。', true)
    return
  }
  persistSettings()
}

input('chart-file').onchange = async () => {
  const file = input('chart-file').files?.[0]
  if (!file) return
  const resourceTask = loading.begin(`正在读取 ${file.name}`, 1)
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error('文件超过 16 MiB')
    const bytes = new Uint8Array(await file.arrayBuffer())
    resourceTask.update(1, `谱面已读取（${formatResourceSize(file.size)}）`, { downloadedBytes: file.size, totalBytes: file.size })
    const asText = new TextDecoder().decode(bytes)
    // .json 走文本解析；raw-deflate .bytes 走 decodeChart。
    const chart = asText.trimStart().startsWith('{')
      ? parseChart(JSON.parse(asText.replace(/^\ufeff/, '')))
      : decodeChart(bytes)
    await loadChart(chart, file.name)
    // 本地文件没有曲目 Id，Fever 一律关闭（不估算）。
    applyFeverWindow(null)
  } catch (error) {
    message(`谱面读取失败：${String(error)}。原谱面已保留。`, true)
  } finally {
    resourceTask.finish()
    input('chart-file').value = ''
  }
}

input('audio-file').onchange = async () => {
  const file = input('audio-file').files?.[0]
  if (!file) return
  const resourceTask = loading.begin(`正在读取 ${file.name}`, 2)
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    resourceTask.update(1, `音频已读取（${formatResourceSize(file.size)}），正在注入…`, { downloadedBytes: file.size, totalBytes: file.size })
    // 音频走同一条注入链路：重新 loadSession，BGM 缺失时静默退回无声预览。
    await player.loadSession({
      scoreText: JSON.stringify(chartToMusicScore(currentChart ?? demoChart())),
      scoreFormat: 'custom-score-json',
      sourceOffsetMs: 0,
      effectiveLeadInMs: 9000,
      bgmBytes: bytes,
      coverBytes: (await fetchBytes(currentSongAssets.coverUrl)) ?? await fetchBytes(EMPTY_COVER_URL),
      metadata: {
        title: el('chart-name').textContent ?? '本地音频',
        lyricist: null,
        composer: null,
        arranger: null,
        vocal: null,
        difficulty: null,
        customScoreInfo: false,
        scoreTitle: el('chart-name').textContent ?? '本地音频',
        scoreCreator: null,
      },
    })
    const config = readRuntimeConfig()
    player.setPreviewConfig(config)
    player.setAudioVolumes(config.bgmVolume, config.soundVolume)
    el('audio-name').textContent = `本地音频：${file.name}`
    message(`已注入音频 ${file.name}（${(bytes.length / 1024 / 1024).toFixed(1)} MB）`)
    resourceTask.update(2, '音频已注入', { downloadedBytes: file.size, totalBytes: file.size })
  } catch (error) {
    message(`音频读取失败：${String(error)}`, true)
  } finally {
    resourceTask.finish()
    input('audio-file').value = ''
  }
}

el('demo').onclick = async () => {
  await loadChart(demoChart(), '演示谱面')
  el('audio-name').textContent = '未加载音频 · 可以无声预览'
}

/* ── 曲目选择器由统一壳层持有；此处只响应选择变化 ── */
const openSong = async (songId: string, difficulty: string) => {
  try {
    await loadSongById(songId, difficulty)
  } catch (error) {
    if (!disposed) message(`曲目加载失败：${String(error)}`, true)
  }
}
unsubscribeSongSelection = songSelection.subscribe((selection) => {
  if (selection) void openSong(selection.songId, selection.difficulty)
}, false)

el('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.querySelector<HTMLElement>('.viewer')?.requestFullscreen()
  } catch {
    message('当前浏览器不允许全屏，可使用浏览器的全屏菜单。', true)
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (disposed) return
  if ((event.target as HTMLElement).closest('input,select,button,textarea,a')) return
  if (event.code === 'Space') {
    event.preventDefault()
    el('play').click()
  }
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault()
    const snapshot = player.getStateSnapshot()
    player.seek(snapshot.currentTimeSec + (event.code === 'ArrowRight' ? 5 : -5))
    player.renderFrame()
  }
}
document.addEventListener('keydown', onKeydown)

function resizeCanvasToStage() {
  const canvas = el<HTMLCanvasElement>('chart-canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.parentElement!.getBoundingClientRect()
  player.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), dpr)
}

const onResize = () => {
  if (disposed) return
  // 导出期间画布固定为预设尺寸，结束后会按舞台尺寸恢复。
  if (liveRenderingSuspended) return
  resizeCanvasToStage()
}
window.addEventListener('resize', onResize)

const exportDialog = installExportDialog(el<HTMLButtonElement>('export-video'), {
  player,
  canvas: el<HTMLCanvasElement>('chart-canvas'),
  suspendLiveRendering: () => {
    liveRenderingSuspended = true
    cancelAnimationFrame(rafHandle)
  },
  resumeLiveRendering: () => {
    liveRenderingSuspended = false
    cancelAnimationFrame(rafHandle)
    renderLoop()
  },
  restoreCanvasSize: resizeCanvasToStage,
  restorePlaybackRate: () => player.setPlaybackRate(Number(select('rate').value)),
  lockTargets: () => [toolbarHost!, root.querySelector<HTMLElement>('aside')!, root.querySelector<HTMLElement>('.transport')!],
  title: () => el('chart-name').textContent ?? 'pjsk-preview',
  message,
})

/** 调试钩子：便于自动化验证（例如 60 轨坐标探针）。 */
window.__LLL_PJSK__ = {
  player,
  loadChart,
  demoChart,
  renderLoop,
  getChart: () => currentChart,
  exportDialog,
  probeExportConfigs: probeAllConfigs,
}
  const onPagehide = () => dispose()
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribeSongSelection()
    liveRenderingSuspended = true
    el('open-chart').onclick = null
    el('open-audio').onclick = null
    el('demo').onclick = null
    el('chart-file').onchange = null
    el('audio-file').onchange = null
    el('fullscreen').onclick = null
    cancelAnimationFrame(rafHandle)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('pagehide', onPagehide)
    exportDialog.dialog.close()
    exportDialog.dialog.remove()
    player.dispose()
    if (window.__LLL_PJSK__?.player === player) delete window.__LLL_PJSK__
    root.replaceChildren()
  }
  window.addEventListener('pagehide', onPagehide, { once: true })
  void boot().catch((error) => {
    if (disposed) return
  message(`启动失败：${String(error)}`, true)
  console.error(error)
})
  return { dispose }
}
