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
import './style.css'
import './workspace.css'
import { MmwWasmPlayer } from './lib/mmwWasm'
import type { PreviewRuntimeConfig } from './lib/types'
import { buildAssetManifest } from './assetManifest'
import { installLaneProbe } from './debug/laneProbe'
import { parseChart, decodeChart, type Chart } from './llll/chart'
import { chartToMusicScore } from './llll/toMusicScore'
import { loadPreviewSettings, savePreviewSettings, type PreviewSettings } from './settingsPersist'
import { parseUrlPreviewParams } from './lib/url'
import { findSong, songAssets, fetchBytes, loadSongList } from './llll/songAssets'
import { setupPwaUpdatePrompt } from './lib/pwa'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('缺少 #app 容器。')
}

app.innerHTML = `
<header class="workspace-header"><a class="brand" href="./" aria-label="llll × PJSK 预览首页"><span class="brand-mark" aria-hidden="true">llll</span><span>渲染预览<small>PJSK PIPELINE · 60 LANES</small></span></a><div class="song-picker" aria-label="选择曲目"><label class="sr-only" for="song-select">曲目</label><select id="song-select" class="song-select"><option value="">选择曲目…</option></select><label class="sr-only" for="song-difficulty">难度</label><select id="song-difficulty" class="song-difficulty"></select></div><div class="file-toolbar" aria-label="打开谱面与音频"><button id="open-chart" class="file-action" type="button">＋ 打开谱面</button><input class="sr-only" id="chart-file" type="file" accept=".json,.bytes" aria-label="选择谱面文件"><button id="open-audio" class="quiet" type="button">添加音频</button><input class="sr-only" id="audio-file" type="file" accept="audio/*" aria-label="添加本地音频"><button id="demo" class="text-button" type="button" aria-label="重新打开演示谱">演示谱</button></div><span class="local-badge">本地运行 · 文件不上传</span></header>
<main>
<section class="viewer" aria-label="谱面预览">
 <div class="preview-heading"><div class="current-file"><span class="section-label">当前谱面</span><h1 id="chart-name">演示谱面</h1></div><span class="file-name" id="audio-name">未加载音频 · 可以无声预览</span></div>
 <div class="stage-shell"><div class="stage" id="stage"><canvas id="chart-canvas" aria-label="三维谱面画布"></canvas></div></div>
 <div id="message" class="viewer-status" role="status" aria-live="polite">正在初始化渲染器…</div>
 <div class="transport"><label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0"><div class="transport-row"><button id="play" class="primary" aria-label="播放">▶ 播放</button><button id="restart" class="quiet" aria-label="回到开头">↺ 重播</button><output id="time">00:00.000 / 00:36.000</output><label class="rate-label">播放倍率<select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><button id="fullscreen" class="quiet">全屏预览</button></div></div>
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
<label class="setting" for="effect-profile"><span>特效配置</span><select id="effect-profile"><option value="0" selected>Profile 0</option><option value="1">Profile 1</option></select></label>
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
</main><footer><span>非官方研究工具 · llll 原生谱面 · PJSK 渲染管线</span><span><kbd>Space</kbd> 播放 / 暂停 <kbd>←</kbd><kbd>→</kbd> 跳转 5 秒</span></footer>`

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
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
const settingTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
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

const player = new MmwWasmPlayer()
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

/** 表单 → 持久化设置（沿用自家 llll-preview-web 的键）。 */
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
}

for (const id of [
  'mirror', 'lines', 'flick-anim', 'hold-anim', 'note-skin', 'effect-profile',
  'stage-cover', 'stage-opacity', 'bg-brightness', 'hold-alpha', 'guide-alpha',
  'effect-opacity', 'bgm-volume', 'sound-volume', 'note-speed',
]) {
  const node = input(id)
  const handler = () => {
    const output = document.getElementById(`${id}-value`)
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

// ---- 资源预载 ----
async function preloadAll(onProgress: (text: string) => void) {
  const entries = buildAssetManifest()
  let done = 0
  for (const entry of entries) {
    try {
      const response = await fetch(entry.url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (entry.kind === 'asset') await player.preloadAsset(entry.key, bytes)
      else if (entry.kind === 'font') await player.preloadFont(entry.key, bytes)
      else await player.preloadSound(entry.key, bytes)
    } catch (error) {
      // 音效缺失不该阻断渲染；贴图/字体缺失则上抛。
      if (entry.kind !== 'sound') throw error
      console.warn('[llll-pjsk] 音效加载失败：', entry.url, error)
    }
    done += 1
    onProgress(`预载资源 ${done}/${entries.length}…`)
  }
}

/** 当前曲目的 BGM / 曲绘 URL（供「添加音频」与曲目切换复用）。 */
let currentSongAssets: { bgmUrl: string | null; coverUrl: string | null } = {
  bgmUrl: null,
  coverUrl: null,
}

async function loadChart(
  chart: Chart,
  label: string,
  sourceOffsetMs = 0,
  assets: { bgmUrl?: string | null; coverUrl?: string | null } = {},
  difficulty: string | null = null,
) {
  const score = chartToMusicScore(chart)
  const maxLane = score.NoteList.reduce((max, note) => Math.max(max, note.laneEnd), 0)

  // BGM 与曲绘缺失不该阻断渲染：失败一律退回 null。
  const bgmUrl = assets.bgmUrl ?? currentSongAssets.bgmUrl
  const coverUrl = assets.coverUrl ?? currentSongAssets.coverUrl
  if (bgmUrl || coverUrl) {
    message('正在加载曲目资源…')
  }
  const [bgmBytes, coverBytes] = await Promise.all([
    fetchBytes(bgmUrl),
    fetchBytes(coverUrl),
  ])
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
      lyricist: null,
      composer: null,
      arranger: null,
      vocal: null,
      // 难度走独立字段：wasm 侧据此在曲绘旁绘制彩色难度徽章，
      // 不拼进曲名。
      difficulty,
      customScoreInfo: false,
      scoreTitle: label,
      scoreCreator: null,
    },
  })
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
  parts.push(coverBytes ? '曲绘 ✓' : '曲绘 —')
  el('audio-name').textContent = bgmBytes ? 'BGM 已加载' : '未加载音频 · 可以无声预览'
  message(`${uiLabel}　${parts.join('　')}`)
}

/** 按曲目 Id 打开：加载谱面 + BGM + 曲绘。 */
async function loadSongById(songId: string, difficulty: string, sourceOffsetMs = 0) {
  const song = await findSong(songId)
  if (!song) {
    throw new Error(`曲目列表里没有 Id ${songId}`)
  }
  const chartFile = song.charts[difficulty]
  if (!chartFile) {
    throw new Error(`曲目 ${songId} 没有难度 ${difficulty} 的谱面`)
  }
  message(`正在下载谱面 ${chartFile}…`)
  const response = await fetch(`/assets/chart/${chartFile}`)
  if (!response.ok) {
    throw new Error(`谱面下载失败（${response.status}）：${chartFile}`)
  }
  // 谱面是 raw-deflate 的 .bytes；decodeChart 自动识别 JSON / 压缩两种形态。
  const chart = decodeChart(new Uint8Array(await response.arrayBuffer()))
  // 曲名不含难度：难度走独立的 metadata.difficulty，由 HUD 画成徽章。
  await loadChart(chart, song.title, sourceOffsetMs, songAssets(song), difficulty)
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

function renderLoop() {
  if (!runtimeReady) return
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
  let params
  try {
    params = parseUrlPreviewParams(new URL(window.location.href))
  } catch {
    return false
  }

  const url = params.chart || params.customScoreJson
  if (!url) return false

  message(`正在下载谱面 ${url}…`)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`谱面下载失败（${response.status}）：${url}`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  const asText = new TextDecoder().decode(bytes)
  const chart = asText.trimStart().startsWith('{')
    ? parseChart(JSON.parse(asText.replace(/^\ufeff/, '')))
    : decodeChart(bytes)

  const label = params.title ?? params.scoreTitle ?? url.split('/').pop() ?? 'URL 谱面'
  await loadChart(chart, label, params.rawOffsetMs ?? 0)
  return true
}

async function boot() {
  const canvas = el<HTMLCanvasElement>('chart-canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.parentElement!.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  canvas.width = width * dpr
  canvas.height = height * dpr

  message('正在初始化渲染器…')
  await player.init(canvas, width, height, dpr)
  runtimeReady = true
  applyRuntimeConfig()

  await preloadAll((text) => message(text))
  message('渲染器就绪。')

  // 曲目选择器：列表加载失败不该阻断渲染。
  let songPicker: Awaited<ReturnType<typeof initSongPicker>> | null = null
  try {
    songPicker = await initSongPicker()
  } catch (error) {
    console.warn('[llll-pjsk] 曲目列表加载失败：', error)
  }

  // 优先级：?song= > ?chart= > 演示谱。
  const search = new URLSearchParams(location.search)
  const songId = search.get('song')
  if (songId && songPicker) {
    const difficulty = search.get('difficulty') ?? 'MASTER'
    songPicker.picker.value = songId
    songPicker.syncDifficulties()
    try {
      await loadSongById(songId, difficulty, Number(search.get('offset') ?? 0))
      renderLoop()
      return
    } catch (error) {
      message(`曲目 ${songId} 加载失败：${String(error)}。已回落到演示谱。`, true)
    }
  }

  // 有 URL 参数就用它，否则回落到演示谱。
  try {
    if (await loadFromUrlParams()) {
      renderLoop()
      return
    }
  } catch (error) {
    message(`URL 谱面加载失败：${String(error)}。已回落到演示谱。`, true)
  }

  await loadChart(demoChart(), '演示谱面')
  renderLoop()
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
  try {
    if (file.size > 16 * 1024 * 1024) throw new Error('文件超过 16 MiB')
    const bytes = new Uint8Array(await file.arrayBuffer())
    const asText = new TextDecoder().decode(bytes)
    // .json 走文本解析；raw-deflate .bytes 走 decodeChart。
    const chart = asText.trimStart().startsWith('{')
      ? parseChart(JSON.parse(asText.replace(/^\ufeff/, '')))
      : decodeChart(bytes)
    await loadChart(chart, file.name)
  } catch (error) {
    message(`谱面读取失败：${String(error)}。原谱面已保留。`, true)
  } finally {
    input('chart-file').value = ''
  }
}

input('audio-file').onchange = async () => {
  const file = input('audio-file').files?.[0]
  if (!file) return
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    // 音频走同一条注入链路：重新 loadSession，BGM 缺失时静默退回无声预览。
    await player.loadSession({
      scoreText: JSON.stringify(chartToMusicScore(currentChart ?? demoChart())),
      scoreFormat: 'custom-score-json',
      sourceOffsetMs: 0,
      effectiveLeadInMs: 9000,
      bgmBytes: bytes,
      coverBytes: await fetchBytes(currentSongAssets.coverUrl),
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
  } catch (error) {
    message(`音频读取失败：${String(error)}`, true)
  } finally {
    input('audio-file').value = ''
  }
}

el('demo').onclick = async () => {
  await loadChart(demoChart(), '演示谱面')
  el('audio-name').textContent = '未加载音频 · 可以无声预览'
}

/* ── 曲目选择器：按曲目 Id + 难度直接打开（谱面 / BGM / 曲绘一并加载） ── */

async function initSongPicker() {
  const list = await loadSongList()
  const picker = el<HTMLSelectElement>('song-select')
  const difficulty = el<HTMLSelectElement>('song-difficulty')

  const byCategory = new Map<string, typeof list.songs>()
  for (const song of list.songs) {
    const bucket = byCategory.get(song.category) ?? []
    bucket.push(song)
    byCategory.set(song.category, bucket)
  }
  for (const [category, songs] of byCategory) {
    const group = document.createElement('optgroup')
    group.label = category
    for (const song of songs) {
      const option = document.createElement('option')
      option.value = song.id
      option.textContent = song.hasChart ? song.title : `${song.title}（无谱面）`
      option.disabled = !song.hasChart
      group.append(option)
    }
    picker.append(group)
  }

  // 难度下拉跟着所选曲目变化。
  const syncDifficulties = () => {
    const song = list.songs.find((item) => item.id === picker.value)
    difficulty.replaceChildren()
    for (const name of song?.difficulties ?? []) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      difficulty.append(option)
    }
    if (difficulty.options.length > 0) {
      difficulty.value = difficulty.options[difficulty.options.length - 1].value
    }
  }
  syncDifficulties()

  const open = async () => {
    if (!picker.value) return
    try {
      await loadSongById(picker.value, difficulty.value)
      const url = new URL(location.href)
      url.searchParams.set('song', picker.value)
      url.searchParams.set('difficulty', difficulty.value)
      url.searchParams.delete('chart')
      history.replaceState(null, '', url)
    } catch (error) {
      message(`曲目加载失败：${String(error)}`, true)
    }
  }
  difficulty.onchange = open
  // 换曲目时先刷新难度列表（默认落到最高难度），再加载。
  picker.onchange = async () => {
    syncDifficulties()
    await open()
  }

  return { picker, difficulty, syncDifficulties }
}

el('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el('stage').closest('.viewer')?.requestFullscreen()
  } catch {
    message('当前浏览器不允许全屏，可使用浏览器的全屏菜单。', true)
  }
}

document.addEventListener('keydown', (event) => {
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
})

window.addEventListener('resize', () => {
  const canvas = el<HTMLCanvasElement>('chart-canvas')
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.parentElement!.getBoundingClientRect()
  player.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)), dpr)
})

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(rafHandle)
}, { once: true })

/** 调试钩子：便于自动化验证（例如 60 轨坐标探针）。 */
declare global {
  interface Window {
    __LLL_PJSK__?: {
      player: MmwWasmPlayer
      loadChart: typeof loadChart
      demoChart: typeof demoChart
      renderLoop: () => void
    }
  }
}
window.__LLL_PJSK__ = { player, loadChart, demoChart, renderLoop }
installLaneProbe()
setupPwaUpdatePrompt()

boot().catch((error) => {
  message(`启动失败：${String(error)}`, true)
  console.error(error)
})
