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
import { MmwWasmPlayer } from '@sukushow/pjsk-preview/lib/mmwWasm'
import type { PreviewRuntimeConfig } from '@sukushow/pjsk-preview/lib/types'
import { buildAssetManifest } from '@sukushow/pjsk-preview/assetManifest'
import type { Chart } from '@sukushow/chart/chart'
import { chartToMusicScore } from '@sukushow/pjsk-preview/llll/toMusicScore'
import { loadPreviewSettings, savePreviewSettings, type PreviewSettings } from './pjsk/settingsPersist'
import { fetchBytes } from '@sukushow/pjsk-preview/llll/songAssets'
import { feverChanceForSong } from '@sukushow/chart/songTiming'
import { MusicVideo } from '@sukushow/llll-preview/musicVideo'
import type { SongAssets } from '@sukushow/pjsk-preview/llll/songAssets'
import { chargeNotesInWindow } from '@sukushow/pjsk-preview/lib/feverCharge'
import { installExportDialog, probeAllConfigs } from './exportDialog'
import { createTrackHeader } from './trackHeader'
import { bindViewChrome, stageToolbarMarkup, trackHeaderMarkup, transportMarkup } from './viewChrome'
import { icon, setIconButton } from '../icons'
import type { ExportFrameSource } from '@sukushow/export'
import { EXPORT_OPENING } from '@sukushow/pjsk-preview/opening'
import type { SongSelectionStore } from '../songSelection'
import { createResourceLoading, measureResourceSizes, totalResourceSize } from '../resourceLoading'
import { mmwWasmFilename } from '@sukushow/pjsk-preview/generated/mmwWasmAsset'
import type { SourceProgress } from '../sourceResolver'
import { readResponseBytes } from '@sukushow/llll-preview/resourceDownload'

declare global {
  interface Window {
    __LLL_PJSK__?: {
      player: MmwWasmPlayer
      musicVideo: MusicVideo
      loadChart: (...args: any[]) => Promise<void>
      renderLoop: () => void
      getChart: () => Chart | null
      exportDialog: ReturnType<typeof installExportDialog>
      probeExportConfigs: typeof probeAllConfigs
    }
  }
}

import { createSourceBinding, waitForSource } from '../sourceBinding'
import type { SourceState, ResolvedSource } from '../songSelection'
import type { SourceFiles } from '../sourceControls'

export type PjskMountOptions = {
  root: HTMLElement
  toolbar?: HTMLElement
  songSelection: SongSelectionStore
  sourceFiles: SourceFiles
  resolveSource: (state: SourceState, onProgress?: (progress: SourceProgress) => void) => Promise<ResolvedSource>
}

export type PjskViewHandle = {
  dispose: () => Promise<void>
}

export function mount({ root, toolbar, songSelection, resolveSource, sourceFiles }: PjskMountOptions): PjskViewHandle {
  let toolbarHost = toolbar
  root.innerHTML = `
<main>
<section class="viewer" aria-label="谱面预览">
 ${trackHeaderMarkup}
 ${stageToolbarMarkup()}
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
 <div id="message" class="viewer-status" role="status" aria-live="polite"></div>
 ${transportMarkup}
</section>
<aside id="preview-inspector" aria-label="预览设置" hidden>
 <div class="inspector-heading"><h2>预览设置</h2><button class="quiet" type="button" data-inspector-close aria-label="关闭预览设置">${icon('x', 16)}</button></div>
 <div class="settings-tabs" role="tablist" aria-label="设置分类">
  <button id="tab-track" role="tab" aria-selected="true" aria-controls="panel-track">播放与轨道</button>
  <button id="tab-display" role="tab" aria-selected="false" aria-controls="panel-display" tabindex="-1">显示与特效</button>
  <button id="tab-audio" role="tab" aria-selected="false" aria-controls="panel-audio" tabindex="-1">音量</button>
  <button id="tab-score" role="tab" aria-selected="false" aria-controls="panel-score" tabindex="-1">计分</button>
 </div>
 <div class="settings-body">
 <section class="panel" id="panel-track" role="tabpanel" aria-labelledby="tab-track" tabindex="0">
<label class="setting" for="note-speed"><span>下落速度 noteSpeed<output id="note-speed-value">10.5</output></span><input id="note-speed" type="range" min="1" max="12" step="0.1" value="10.5"></label>
<label class="setting" for="offset"><span>音频偏移 <small>毫秒</small></span><input id="offset" type="number" min="-10000" max="10000" step="10" value="0"><small>正值让音频晚于谱面开始。</small></label>
<label class="setting" for="note-skin"><span>Note Skin</span><select id="note-skin"><option value="0" selected>Notes 01</option><option value="1">Notes 02</option></select></label>
<label class="check"><input id="mirror" type="checkbox">左右镜像</label>
<label class="check"><input id="lines" type="checkbox" checked>显示同时押线</label>
<label class="check"><input id="flick-anim" type="checkbox" checked>Flick 箭头动画</label>
<label class="check"><input id="hold-anim" type="checkbox" checked>Hold 流动动画</label>
</section>
<section class="panel" id="panel-display" role="tabpanel" aria-labelledby="tab-display" tabindex="0" hidden>
<label class="setting" for="stage-cover"><span>上隐 StageCover<output id="stage-cover-value">0</output></span><input id="stage-cover" type="range" min="0" max="100" step="1" value="0"></label>
<label class="setting" for="stage-opacity"><span>舞台不透明度<output id="stage-opacity-value">100</output></span><input id="stage-opacity" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="bg-brightness"><span>背景亮度<output id="bg-brightness-value">100</output></span><input id="bg-brightness" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="hold-alpha"><span>长条透明度<output id="hold-alpha-value">74</output></span><input id="hold-alpha" type="range" min="0" max="100" step="1" value="74"></label>
<label class="setting" for="guide-alpha"><span>Guide 浓度<output id="guide-alpha-value">50</output></span><input id="guide-alpha" type="range" min="0" max="100" step="1" value="50"></label>
<label class="setting" for="effect-opacity"><span>特效不透明度<output id="effect-opacity-value">100</output></span><input id="effect-opacity" type="range" min="0" max="100" step="1" value="100"></label>
<label class="check"><input id="opt-mv" type="checkbox" checked>2D MV / MusicVideo</label>
<label class="check"><input id="fever-display" type="checkbox" checked>Fever 特效</label>
<label class="check"><input id="super-fever" type="checkbox">SuperFever 配色（充能满时切换）</label>
<label class="setting" for="effect-profile"><span>特效配置</span><select id="effect-profile"><option value="0" selected>Profile 0</option><option value="1">Profile 1</option></select></label>
<p class="setting" id="fever-status"><small>Fever：未加载曲目。</small></p>
</section>
<section class="panel" id="panel-audio" role="tabpanel" aria-labelledby="tab-audio" tabindex="0" hidden>
<label class="setting" for="bgm-volume"><span>BGM 音量<output id="bgm-volume-value">100</output></span><input id="bgm-volume" type="range" min="0" max="100" step="1" value="100"></label>
<label class="setting" for="sound-volume"><span>音效音量<output id="sound-volume-value">100</output></span><input id="sound-volume" type="range" min="0" max="100" step="1" value="100"></label>
</section>
<section class="panel" id="panel-score" role="tabpanel" aria-labelledby="tab-score" tabindex="0" hidden>
<p class="setting"><small>计分与段位由 wasm 侧的 PJSK HUD 接管，暂无可调项。</small></p>
</section></div>
</aside>
</main>`

  const track = createTrackHeader(root)
  const unbindChrome = bindViewChrome(root)
  if (!toolbarHost) {
    toolbarHost = document.createElement('div')
    toolbarHost.className = 'file-toolbar'
    toolbarHost.setAttribute('aria-label', '打开谱面与音频')
    toolbarHost.innerHTML = `
      <div id="song-picker-mount" class="song-picker" aria-label="选择曲目"></div>
      <button id="open-chart" class="file-action" type="button">${icon('plus', 16)}<span>打开谱面</span></button>
      <input class="sr-only" id="chart-file" type="file" accept=".json,.bytes,application/json" aria-label="选择谱面文件">
      <button id="open-audio" class="quiet" type="button">添加音频</button>
      <input class="sr-only" id="audio-file" type="file" accept="audio/*" aria-label="选择本地音频">
 </div>`
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
  const musicVideo = new MusicVideo(() => {})
  let currentFinishTime: number | null = null
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
    enableMusicVideo: input('opt-mv').checked,
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
  input('opt-mv').checked = settings.enableMusicVideo ?? true
  musicVideo.setEnabled(input('opt-mv').checked)
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
  track.paint()
}

/**
 * FeverChance 分母只包含代理窗口 [chance.start, chance.end) 内的音符。
 * 分子由窗口内已到达的音符数计算，再进行平滑；窗口之前的音符不参与。
 * 时间均为歌曲秒，动画从窗口起点开始，不等第一个音符或达到 70%。
 */
function applyFeverCharge(chart: Chart | null, songId: string | null) {
  const window = feverChanceForSong(songId)
  if (!chart || !window) {
    player.setFeverChargeTimes([])
    player.setFeverCharge(0, 0)
    return
  }
  // LLLL 没有 PJSK FeverBeginEvent，使用索引中明确标注的前一段代理窗口。
  player.setFeverChargeTimes(chargeNotesInWindow(chart.notes.map(note => note.time), window), window.start)
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
let currentSongAssets: SongAssets = {
  bgmUrl: null,
  coverUrl: null,
  mvUrl: null,
  mvStartSec: 0,
  mvDurationSec: 0,
}

function applySongTiming() {
  const mvEnd = input('opt-mv').checked && currentSongAssets.mvUrl
    ? currentSongAssets.mvStartSec + currentSongAssets.mvDurationSec : 0
  player.setSongTiming(currentFinishTime, Math.max(currentChart?.duration ?? 0, mvEnd))
  setDuration(player.getStateSnapshot().durationSec)
}

input('opt-mv').onchange = async () => {
  const enabled = input('opt-mv').checked
  persistSettings()
  if (!runtimeReady || !currentChart || !enabled || !currentSongAssets.mvUrl) {
    musicVideo.setEnabled(enabled)
    if (runtimeReady && currentChart) applySongTiming()
    return
  }
  const assets = currentSongAssets
  const task = loading.begin('正在加载 MV', 1)
  player.pause()
  try {
    const sizes = await measureResourceSizes([assets.mvUrl])
    if (disposed || assets !== currentSongAssets || !input('opt-mv').checked) return
    await musicVideo.setUrl(null)
    musicVideo.setEnabled(true)
    const loaded = await musicVideo.setUrl(assets.mvUrl, assets.mvStartSec, assets.mvDurationSec,
      state => task.update(state.phase === 'ready' ? 1 : 0, '正在加载 MV…', state),
      sizes.get(assets.mvUrl!))
    if (disposed || assets !== currentSongAssets || !input('opt-mv').checked) return
    applySongTiming()
    message(loaded ? '' : 'MV 加载失败；已回退默认背景。', !loaded)
  } finally {
    task.finish()
  }
}

type LoadChartOptions = {
  signal?: AbortSignal
  source?: ResolvedSource
  current?: () => boolean
  finishTime?: number | null
}

// WASM 需要可解码曲绘；缺失时只提供透明技术空白，不借用游戏纹理。
let emptyCover: Promise<Uint8Array> | undefined
function transparentCover(): Promise<Uint8Array> {
  return emptyCover ??= new Promise<Blob>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成技术空白曲绘')), 'image/png')
  }).then(async blob => new Uint8Array(await blob.arrayBuffer()))
}

async function loadChart(
  chart: Chart,
  label: string,
  sourceOffsetMs = 0,
  assets: Partial<SongAssets> = {},
  difficulty: string | null = null,
  credits: { lyricist: string | null; composer: string | null; arranger: string | null; vocal: string | null } | null = null,
  options: LoadChartOptions = {},
) {
  const current = () => !disposed && (options.current?.() ?? true)
  const wait = <T>(pending: Promise<T>) => options.signal ? waitForSource(pending, options.signal) : pending
  if (!current()) return
  const resourceTask = loading.begin(`正在准备 ${label} 的预览`, 3)
  try {
  const score = chartToMusicScore(chart)

  // BGM 与曲绘缺失不该阻断渲染：失败一律退回 null。
  player.pause()
  player.setMusicVideoFrame(null)
  await musicVideo.setUrl(null)
  if (!current()) return
  const bgmUrl = assets.bgmUrl ?? null
  const coverUrl = assets.coverUrl ?? null
  const downloadSizes = options.source?.download?.sizes ? new Map(Object.entries(options.source.download.sizes))
    : await wait(measureResourceSizes([bgmUrl, coverUrl, input('opt-mv').checked ? assets.mvUrl : null]))
  if (!current()) return
  const downloadTotalBytes = options.source?.download?.sizes ? options.source.download.totalBytes
    : (totalResourceSize(downloadSizes) ?? 0) + (options.source?.download?.totalBytes ?? 0) || undefined
  const downloads = new Map<string, number>([['来源', options.source?.download?.downloadedBytes ?? 0]])
  resourceTask.update(0, bgmUrl || coverUrl ? '正在下载曲目资源…' : '正在初始化谱面…', {
    downloadedBytes: [...downloads.values()].reduce((sum, item) => sum + item, 0),
    totalBytes: downloadTotalBytes,
  })
  const updateDownload = (name: string, state: { phase: 'download' | 'ready'; downloadedBytes?: number; totalBytes?: number }) => {
    if (!current()) return
    if (state.downloadedBytes !== undefined) downloads.set(name, state.downloadedBytes)
    const downloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
    resourceTask.setLabel(`下载 ${name}`)
    resourceTask.update(0, state.phase === 'download' ? `正在下载 ${name}…` : `${name} 已下载`, {
      downloadedBytes,
      totalBytes: downloadTotalBytes,
    })
  }
  const [bgmBytes, loadedCoverBytes] = await wait(Promise.all([
    fetchBytes(bgmUrl, (state) => updateDownload('BGM', state)),
    fetchBytes(coverUrl, (state) => updateDownload('曲绘', state)),
  ]))
  if (!current()) return
  let downloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
  resourceTask.update(1, loadedCoverBytes ? '曲目资源已下载，正在准备曲绘…' : '未提供曲绘，正在准备预览…', {
    downloadedBytes,
    totalBytes: downloadTotalBytes,
  })
  const coverBytes = loadedCoverBytes ?? await transparentCover()
  if (!current()) return
  currentSongAssets = { bgmUrl, coverUrl, mvUrl: assets.mvUrl ?? null, mvStartSec: assets.mvStartSec ?? 0, mvDurationSec: assets.mvDurationSec ?? 0 }
  currentFinishTime = options.finishTime ?? null

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
      customScoreInfo: options.source?.custom ?? false,
      scoreTitle: label,
      scoreCreator: options.source?.metadata.scoreCreator ?? null,
    },
  })
  if (!current()) return
  let sessionDownloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
  resourceTask.update(2, '资源已注入，正在绘制首帧…', { downloadedBytes: sessionDownloadedBytes, totalBytes: downloadTotalBytes })
  currentChart = chart
  input('timeline').disabled = false
  el<HTMLButtonElement>('restart').disabled = false
  applySongTiming()
  const { mvUrl, mvStartSec, mvDurationSec } = currentSongAssets
  const mvLoaded = await musicVideo.setUrl(mvUrl, mvStartSec, mvDurationSec,
    (state) => {
      downloads.set('MV', state.downloadedBytes)
      sessionDownloadedBytes = [...downloads.values()].reduce((sum, item) => sum + item, 0)
      resourceTask.setLabel('加载 MV')
      resourceTask.update(2, state.phase === 'ready' ? 'MV 已就绪' : '正在加载 MV…', {
        downloadedBytes: sessionDownloadedBytes, totalBytes: downloadTotalBytes,
      })
    }, downloadSizes.get(mvUrl ?? ''))
  if (!current()) return
  if (mvUrl && input('opt-mv').checked && !mvLoaded) resourceTask.fail('MV 加载失败；已回退默认背景。')
  const config = readRuntimeConfig()
  player.setPreviewConfig(config)
  player.setAudioVolumes(config.bgmVolume, config.soundVolume)
  player.seek(0)
  player.renderFrame()
  const snapshot = player.getStateSnapshot()
  setDuration(snapshot.durationSec)
  player.setPlaybackRate(Number(select('rate').value))
  // 页面 UI 保留难度信息（HUD 上的曲名不带难度，难度走独立徽章）。
  track.show({
    title: label, difficulty: difficulty ?? null,
    artist: credits?.vocal,
    credits: [['作词', credits?.lyricist], ['作曲', credits?.composer], ['编曲', credits?.arranger]],
    jacket: coverUrl, chart,
    stats: [['音符数', score.NoteList.length], ['长条数', chart.roots.filter(note => note.type === 1).length]],
  })
  message('')
  resourceTask.update(3, '预览已就绪', { downloadedBytes: sessionDownloadedBytes, totalBytes: downloadTotalBytes })
  } finally {
    resourceTask.finish()
  }
}

let liveRenderingSuspended = false

function renderLoop() {
  if (disposed || !runtimeReady || liveRenderingSuspended) return
  const snapshot = player.getStateSnapshot()
  const songTime = snapshot.currentTimeSec - snapshot.effectiveLeadInSec
  musicVideo.sync(songTime, snapshot.transportState === 'playing', Number(select('rate').value))
  player.setMusicVideoFrame(musicVideo.frame(songTime), musicVideo.useVideoBackground)
  player.renderFrame()
  if (currentChart) {
    input('timeline').value = String(snapshot.currentTimeSec)
    track.paint()
    el('time').textContent = `${format(snapshot.currentTimeSec)} / ${format(snapshot.durationSec)}`
  } else {
    el('play').setAttribute('disabled', 'true')
    el('export-video').setAttribute('disabled', 'true')
  }
  const playing = snapshot.transportState === 'playing'
  setIconButton(el('play'), playing ? 'pause' : 'play', playing ? '暂停' : '播放')
  rafHandle = requestAnimationFrame(renderLoop)
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
  })
  if (disposed) return
  bootTask.update(manifestTotal + 1, '渲染资源已就绪，正在载入曲目…', { downloadedBytes, totalBytes })

  startSharedBinding()
  renderLoop()
  bootTask.update(manifestTotal + 2, '预览已就绪')
  bootTask.finish()
  } catch (error) {
    bootTask.fail(`PJSK 资源加载失败：${String(error)}`)
    throw error
  }
}

el('play').onclick = async () => {
  if (!runtimeReady || !currentChart) return
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
  if (!runtimeReady || !currentChart) return
  player.seek(0)
  player.renderFrame()
}

input('timeline').oninput = () => {
  if (!runtimeReady || !currentChart) return
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
  songSelection.updateMetadata({ offsetMs: Number(input('offset').value) })
  persistSettings()
}



let sharedBinding: ReturnType<typeof createSourceBinding<SourceState, ResolvedSource>> | undefined
function startSharedBinding() {
  const empty = () => {
    player.pause()
    void musicVideo.setUrl(null)
    currentChart = null
    input('timeline').disabled = true
    el<HTMLButtonElement>('restart').disabled = true
    track.show({})
    track.paint()
    message('')
    el<HTMLButtonElement>('play').disabled = true
    el<HTMLButtonElement>('export-video').disabled = true
    el('chart-canvas').style.visibility = 'hidden'
  }
  sharedBinding = createSourceBinding({
    resolve: async (state, signal) => {
      const task = loading.begin('正在读取谱面来源', 1)
      try {
        return await waitForSource(resolveSource(state, progress => {
          if (!signal.aborted && !disposed && state.revision === songSelection.getSource().revision)
            task.update(progress.phase === 'ready' ? 1 : 0,
              progress.resource === 'credits' ? '正在读取曲目资料…' : '正在下载谱面…', progress.cumulative ?? progress)
        }), signal)
      } finally { task.finish() }
    },
    retain: state => sourceFiles.retain(Object.values(state.media).flatMap(media => media.kind === 'file' ? [media.url] : [])),
    pause: empty,
    empty: state => {
      empty()
      const current = () => !disposed && state.revision === songSelection.getSource().revision
      void resolveSource(state).then(source => {
        if (!current()) return
        const md = source.metadata
        track.show({
          title: md.title, difficulty: md.difficulty, artist: md.vocal,
          jacket: source.assets.coverUrl,
          credits: [['作词', md.lyricist], ['作曲', md.composer], ['编曲', md.arranger]],
        })
      }).catch(error => { if (current()) message(`曲目加载失败：${String(error)}`, true) })
    },
    error: error => { loading.cancel(); empty(); message(`曲目加载失败：${String(error)}`, true) },
    apply: async (source, current, signal) => {
      if (!source.chart || !current()) return
      input('offset').value = String(source.metadata.offsetMs)
      await loadChart(source.chart, source.metadata.title, source.metadata.offsetMs,
        source.assets, source.metadata.difficulty, source.metadata, { finishTime: source.metadata.finishTime, source, current, signal })
      if (!current()) { if (!disposed) empty(); return }
      applyFeverCharge(source.chart, source.chartSongId ?? source.songId)
      player.setFeverWindow(source.metadata.fever?.start ?? -1, source.metadata.fever?.end ?? -1)
      const feverStatus = root.querySelector<HTMLElement>('#fever-status')
      if (feverStatus) feverStatus.textContent = source.metadata.fever
        ? `Fever：${source.metadata.fever.start} – ${source.metadata.fever.end} 秒` : 'Fever：未配置'
      el('chart-canvas').style.visibility = ''
    },
  })
  unsubscribeSongSelection = songSelection.subscribeSource(state => sharedBinding!.update(state), true)
}

el('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.querySelector<HTMLElement>('.viewer')?.requestFullscreen()
  } catch {
    message('当前浏览器不允许全屏，可使用浏览器的全屏菜单。', true)
  }
}

const onKeydown = (event: KeyboardEvent) => {
  if (disposed || !runtimeReady || !currentChart) return
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
  if (disposed || !runtimeReady) return
  // 导出期间画布固定为预设尺寸，结束后会按舞台尺寸恢复。
  if (liveRenderingSuspended) return
  resizeCanvasToStage()
}
window.addEventListener('resize', onResize)
// UI panels and fullscreen can resize the stage without resizing the window.
const stageResizeObserver = new ResizeObserver(onResize)
stageResizeObserver.observe(el('stage'))

/** 导出帧源：导出期间停掉实时渲染循环、画布固定到预设尺寸（dpr 1），结束或取消后恢复尺寸、倍率与播放位置。 */
function createExportSource(): ExportFrameSource {
  const canvas = el<HTMLCanvasElement>('chart-canvas')
  let resumeAt = 0
  return {
    canvas,
    begin(width, height) {
      liveRenderingSuspended = true
      cancelAnimationFrame(rafHandle)
      resumeAt = player.getStateSnapshot().currentTimeSec
      player.pause()
      player.setPlaybackRate(1)
      canvas.classList.add('exporting')
      player.resize(width, height, 1)
      musicVideo.beginExport()
      player.setExportMode(true)
    },
    async renderAt(outputTimeSec, signal) {
      const lead = player.getStateSnapshot().effectiveLeadInSec
      player.setMusicVideoFrame(await musicVideo.seekFrame(outputTimeSec - lead, signal), musicVideo.useVideoBackground)
      player.renderFrameAt(outputTimeSec, true)
    },
    collectAudio() {
      return { events: player.getCapturedSoundEvents(), ...player.getAudioSources() }
    },
    end() {
      musicVideo.endExport()
      player.setExportMode(false)
      canvas.classList.remove('exporting')
      resizeCanvasToStage()
      player.setPlaybackRate(Number(select('rate').value))
      player.seek(resumeAt)
      liveRenderingSuspended = false
      cancelAnimationFrame(rafHandle)
      renderLoop()
    },
  }
}

const exportDialog = installExportDialog(el<HTMLButtonElement>('export-video'), {
  opening: EXPORT_OPENING,
  openingLabel: `包含开场卡片（关闭时从第 ${EXPORT_OPENING.endSec} 秒起）`,
  fileNamePrefix: 'pjsk-preview',
  createSource: createExportSource,
  durationSec: () => {
    const snapshot = player.getStateSnapshot()
    return Math.max(snapshot.durationSec, snapshot.chartEndSec)
  },
  lockTargets: () => [toolbarHost!, root.querySelector<HTMLElement>('aside')!, root.querySelector<HTMLElement>('.transport')!],
  title: () => track.title() || 'pjsk-preview',
})

/** 调试钩子：便于自动化验证（例如 60 轨坐标探针）。 */
window.__LLL_PJSK__ = {
  player,
  musicVideo,
  loadChart,
  renderLoop,
  getChart: () => currentChart,
  exportDialog,
  probeExportConfigs: probeAllConfigs,
}
  let disposing: Promise<void> | undefined
  const onPagehide = (event: PageTransitionEvent) => {
    if (!event.persisted) void dispose()
    else if (runtimeReady) player.pause()
  }
  const dispose = (): Promise<void> => {
    if (disposing) return disposing
    disposed = true
    unsubscribeSongSelection()
    unbindChrome()
    liveRenderingSuspended = true
    el('fullscreen').onclick = null
    cancelAnimationFrame(rafHandle)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', onResize)
    stageResizeObserver.disconnect()
    window.removeEventListener('pagehide', onPagehide)
    exportDialog.dialog.close()
    exportDialog.dialog.remove()
    if (runtimeReady) player.pause()
    musicVideo.dispose()
    disposing = (async () => {
      await bootPromise
      await sharedBinding?.dispose()
      musicVideo.dispose()
      player.dispose()
      if (window.__LLL_PJSK__?.player === player) delete window.__LLL_PJSK__
      root.replaceChildren()
    })()
    return disposing
  }
  window.addEventListener('pagehide', onPagehide)
  const bootPromise = boot().catch((error) => {
    if (disposed) return
  message(`启动失败：${String(error)}`, true)
  console.error(error)
})
  return { dispose }
}
