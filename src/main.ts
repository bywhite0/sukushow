/**
 * llll × PJSK 渲染预览 —— 最小可跑壳。
 *
 * 数据流：
 *   llll 原生 JSON（{Notes, Bpms}）
 *     → src/llll/chart.ts 解析（自家 llll-preview-web 的解析器）
 *     → src/llll/toMusicScore.ts 编码成 MusicScoreMakerData（坐标 0–59 不压缩）
 *     → native wasm（60 轨渲染管线，整套 PJSK 绘制）
 *
 * 这里刻意只做「能跑起来看画面」的最小集：资源预载 + 加载谱面 + 播放/重播。
 * HUD 交互、URL 参数、PWA 等留给后续阶段。
 */
import { MmwWasmPlayer } from './lib/mmwWasm'
import type { PreviewRuntimeConfig } from './lib/types'
import { buildAssetManifest } from './assetManifest'
import { installLaneProbe } from './debug/laneProbe'
import { parseChart, decodeChart, type Chart } from './llll/chart'
import { chartToMusicScore, isLlllNativeChart } from './llll/toMusicScore'

const canvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')
const statusEl = document.querySelector<HTMLElement>('#status')
const statsEl = document.querySelector<HTMLElement>('#stats')
const chartInput = document.querySelector<HTMLInputElement>('#chart-file')
const playButton = document.querySelector<HTMLButtonElement>('#play')
const restartButton = document.querySelector<HTMLButtonElement>('#restart')

if (!canvas || !statusEl || !statsEl || !chartInput || !playButton || !restartButton) {
  throw new Error('缺少必要的页面元素。')
}

function setStatus(text: string, isError = false) {
  statusEl!.textContent = text
  statusEl!.classList.toggle('err', isError)
}

const player = new MmwWasmPlayer()

/** 与 native 侧 initPlayer 的默认口径一致（见 mmw_overlay_player.cpp）。 */
const defaultConfig: PreviewRuntimeConfig = {
  mirror: false,
  flickAnimation: true,
  holdAnimation: true,
  simultaneousLine: true,
  effectProfile: 0,
  noteSkin: 0,
  noteSpeed: 10.5,
  holdAlpha: 0.74,
  guideAlpha: 0.5,
  stageCover: 0,
  stageOpacity: 1,
  backgroundBrightness: 1,
  effectOpacity: 1,
  bgmVolume: 1,
  soundVolume: 1,
}

function getRenderTarget() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  return {
    width: Math.max(1, Math.round(window.innerWidth)),
    height: Math.max(1, Math.round(window.innerHeight)),
    dpr,
  }
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`资源加载失败（${response.status}）：${url}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function preloadAll(onProgress: (text: string) => void) {
  const entries = buildAssetManifest()

  let done = 0
  const total = entries.length
  for (const entry of entries) {
    try {
      const bytes = await fetchBytes(entry.url)
      if (entry.kind === 'asset') {
        await player.preloadAsset(entry.key, bytes)
      } else if (entry.kind === 'font') {
        await player.preloadFont(entry.key, bytes)
      } else {
        await player.preloadSound(entry.key, bytes)
      }
    } catch (error) {
      // 音效缺失不该阻断渲染；贴图/字体缺失则上抛。
      if (entry.kind === 'sound') {
        console.warn('[llll-pjsk] 音效加载失败：', entry.url, error)
      } else {
        throw error
      }
    }
    done += 1
    onProgress(`预载资源 ${done}/${total}…`)
  }
}

let rafHandle = 0

function renderLoop() {
  player.renderFrame()
  const snapshot = player.getStateSnapshot()
  statsEl!.textContent =
    `时间 ${snapshot.currentTimeSec.toFixed(2)}s / 谱面终点 ${snapshot.chartEndSec.toFixed(2)}s` +
    `　状态 ${snapshot.transportState}　音频 ${snapshot.hasAudio ? '有' : '无'}` +
    (snapshot.warnings ? `　⚠ ${snapshot.warnings}` : '')
  rafHandle = requestAnimationFrame(renderLoop)
}

async function loadChart(chart: Chart, label: string) {
  const score = chartToMusicScore(chart, { offsetSec: 0 })
  const noteCount = score.NoteList.length
  const maxLane = score.NoteList.reduce((max, note) => Math.max(max, note.laneEnd), 0)

  const ok = await player.loadSession({
    scoreText: JSON.stringify(score),
    scoreFormat: 'custom-score-json',
    sourceOffsetMs: 0,
    effectiveLeadInMs: 2000,
    bgmBytes: null,
    coverBytes: null,
    metadata: {
      title: label,
      lyricist: null,
      composer: null,
      arranger: null,
      vocal: null,
      difficulty: null,
      customScoreInfo: false,
      scoreTitle: label,
      scoreCreator: null,
    },
  })
  // loadSession 失败时会抛错（内部用 getWarningText 组错误信息），走到这里即成功。
  void ok

  setStatus(`${label}　音符 ${noteCount} 个（Hold 展开后）　最大轨道 ${maxLane}`)
}

/** 60 轨全域演示谱：覆盖 Single / Flick / Hold / Trace 与最宽音符。 */
function demoChart(): Chart {
  const flags = (type: number, l: number, r: number, l2 = 0, r2 = 0) =>
    (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22)
  const notes: { Uid: number; just: string; holds: string[]; Flags: number }[] = []
  const add = (time: number, type: number, l: number, r: number, end = 0, l2 = 0, r2 = 0) =>
    notes.push({ Uid: notes.length + 1, just: String(time), holds: end ? [String(end)] : [], Flags: flags(type, l, r, l2, r2) })

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

async function boot() {
  const target = getRenderTarget()
  canvas!.width = target.width * target.dpr
  canvas!.height = target.height * target.dpr

  setStatus('正在初始化渲染器…')
  await player.init(canvas!, target.width, target.height, target.dpr)
  player.setPreviewConfig(defaultConfig)
  player.setAudioVolumes(defaultConfig.bgmVolume, defaultConfig.soundVolume)

  await preloadAll((text) => setStatus(text))
  setStatus('渲染器就绪，请打开谱面。')

  await loadChart(demoChart(), '演示谱（60 轨全域）')
  player.seek(0)
  player.renderFrame()
  renderLoop()
}

playButton.addEventListener('click', async () => {
  try {
    await player.unlockAudio()
    const snapshot = player.getStateSnapshot()
    if (snapshot.transportState === 'playing') {
      player.pause()
      playButton!.textContent = '播放'
      return
    }
    const ok = await player.play()
    playButton!.textContent = ok ? '暂停' : '播放'
    if (!ok) {
      setStatus('播放被拒绝（可能缺少音频或需要用户手势）。', true)
    }
  } catch (error) {
    setStatus(`播放失败：${String(error)}`, true)
  }
})

restartButton.addEventListener('click', () => {
  player.seek(0)
  player.renderFrame()
})

chartInput.addEventListener('change', async () => {
  const file = chartInput.files?.[0]
  if (!file) return
  try {
    setStatus(`正在读取 ${file.name}…`)
    const bytes = new Uint8Array(await file.arrayBuffer())
    // 自动识别：llll 原生 {Notes, Bpms} 走自家解析；raw-deflate .bytes 走 decodeChart。
    const asText = new TextDecoder().decode(bytes)
    let chart: Chart
    if (asText.trimStart().startsWith('{')) {
      const parsed: unknown = JSON.parse(asText.replace(/^\ufeff/, ''))
      chart = parseChart(parsed)
      if (!isLlllNativeChart(parsed)) {
        console.warn('[llll-pjsk] 该 JSON 不是 llll 原生 {Notes, Bpms} 结构，仍按 llll 口径解析。')
      }
    } else {
      chart = decodeChart(bytes)
    }
    await loadChart(chart, file.name)
    player.seek(0)
  } catch (error) {
    setStatus(`谱面加载失败：${String(error)}`, true)
  }
})

window.addEventListener('resize', () => {
  const target = getRenderTarget()
  player.resize(target.width, target.height, target.dpr)
})

window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(rafHandle)
})

/**
 * 调试钩子：便于在浏览器控制台/自动化里做受控验证
 * （例如「音符是否真的落在 60 条轨上」）。
 */
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

boot().catch((error) => {
  setStatus(`启动失败：${String(error)}`, true)
  console.error(error)
})
