import { icon, setIcon, setIconButton } from '../icons'

/** Shared presentation only. Player state and all renderer controls stay in the views. */
export const trackHeaderMarkup = `
 <header class="now-playing" id="record-panel" aria-label="当前谱面">
  <div class="section-label"><span>曲目</span><button type="button" class="quiet" data-record-close aria-label="收起曲目面板">${icon('x', 18)}</button></div>
  <div class="artwork" id="artwork" data-state="empty">
   <img id="chart-jacket" alt="" hidden>
   <span class="artwork-mark" aria-hidden="true">${icon('music', 52, { strokeWidth: 1.25 })}</span>
  </div>
  <div class="track">
   <span class="track-diff" id="chart-difficulty" hidden></span>
   <h1 id="chart-name">未加载谱面</h1>
   <p class="track-artist" id="chart-artist" hidden></p>
   <div class="track-credits" id="track-credits" hidden><dl id="chart-credits"></dl></div>
  </div>
  <div class="record-selection" data-song-picker-slot></div>
  <div class="track-data">
   <dl class="track-metrics" id="chart-metrics" hidden></dl>
  </div>
 </header>`

export function stageToolbarMarkup() {
  return `<div class="stage-toolbar">
   <button class="quiet record-toggle" type="button" data-record-toggle aria-label="切换曲目面板" aria-expanded="true" aria-controls="record-panel">${icon('panel-left-close', 16)}<span>曲目 / 难度</span></button>
   <div class="stage-heading"><h2><button id="stage-track-name" type="button" data-library-open aria-haspopup="dialog" aria-controls="song-panel" aria-expanded="false">谱面预览</button></h2><span class="track-diff" id="stage-track-difficulty" hidden></span></div>
   <button class="quiet focus-toggle" type="button" data-focus-toggle aria-label="专注预览" aria-pressed="false">${icon('focus', 16)}<span>专注</span></button>
   <button class="quiet inspector-toggle" type="button" aria-label="切换预览设置" aria-expanded="false" aria-controls="preview-inspector" data-inspector-toggle>
    ${icon('panel-right-open', 16)}<span>设置</span>
   </button>
  </div>`
}

/**
 * 走带条。`svgExport` 只给 LLLL 舞台开——静态 SVG 谱面是 LLLL 的导出形式，
 * PJSK 侧只有视频导出，所以按钮按模式注入而不是常驻。`playMode` 同理：只有 LLLL
 * 有手动判定状态机，PJSK 侧不显示游玩开关。
 */
export function transportMarkup({ svgExport = false, playMode = false }: { svgExport?: boolean; playMode?: boolean } = {}) {
  return `
 <div class="transport">
  <label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0">
  <div class="transport-row">
   <button id="restart" class="quiet" aria-label="回到开头" title="回到开头">${icon('skip-back', 18)}</button>
   <button id="play" class="primary" aria-label="播放">${icon('play', 16)}<span data-icon-label>播放</span></button>
   ${playMode ? `<button id="play-mode" class="quiet" type="button" aria-label="进入游玩模式" aria-pressed="false" title="游玩模式：用键盘或触摸打谱面">${icon('gamepad-2', 16)}<span>游玩</span></button>` : ''}
   <output id="time">00:00.000 / 00:36.000</output>
   <label class="rate-label"><span>倍率</span><select id="rate" aria-label="播放倍率"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
   <button id="export-video" class="quiet" type="button" title="导出视频">${icon('download', 16)}<span>导出视频</span></button>
   ${svgExport ? `<button id="export-svg" class="quiet" type="button" title="导出 SVG 谱面并在新标签页打开">${icon('file-code', 16)}<span>导出 SVG</span></button>` : ''}
   <button id="fullscreen" class="quiet" aria-label="全屏预览" title="全屏预览">${icon('maximize', 18)}</button>
  </div>
 </div>`
}

export function bindViewChrome(root: HTMLElement) {
  const toggle = root.querySelector<HTMLButtonElement>('[data-inspector-toggle]')!
  const inspector = root.querySelector<HTMLElement>('#preview-inspector')!
  const recordToggle = root.querySelector<HTMLButtonElement>('[data-record-toggle]')!
  const record = root.querySelector<HTMLElement>('#record-panel')!
  const focusToggle = root.querySelector<HTMLButtonElement>('[data-focus-toggle]')!
  const main = root.querySelector('main')!
  const workspace = root.closest('.workspace')
  let previousRecordOpen = !matchMedia('(max-width: 900px)').matches

  // 两个面板按钮都是展开/收起：图标指向点击后的结果（展开 ↔ 收起）。
  function setRecord(open: boolean) {
    record.hidden = !open
    recordToggle.setAttribute('aria-expanded', String(open))
    setIcon(recordToggle, open ? 'panel-left-close' : 'panel-left-open')
    main.classList.toggle('record-collapsed', !open)
  }
  function setInspector(open: boolean) {
    inspector.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
    setIcon(toggle, open ? 'panel-right-close' : 'panel-right-open')
    if (open) inspector.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }
  function leaveFocus() {
    workspace?.classList.remove('is-focused')
    focusToggle.setAttribute('aria-pressed', 'false')
    focusToggle.querySelector('span')!.textContent = '专注'
  }
  toggle.onclick = () => {
    leaveFocus()
    setInspector(inspector.hidden)
  }
  recordToggle.onclick = () => {
    leaveFocus()
    setRecord(record.hidden)
  }
  root.querySelector<HTMLButtonElement>('[data-inspector-close]')!.onclick = () => {
    setInspector(false)
    toggle.focus()
  }
  root.querySelector<HTMLButtonElement>('[data-record-close]')!.onclick = () => {
    setRecord(false)
    recordToggle.focus()
  }
  focusToggle.onclick = () => {
    const focus = focusToggle.getAttribute('aria-pressed') !== 'true'
    if (focus) previousRecordOpen = !record.hidden
    setRecord(focus ? false : previousRecordOpen)
    setInspector(false)
    focusToggle.setAttribute('aria-pressed', String(focus))
    focusToggle.querySelector('span')!.textContent = focus ? '退出专注' : '专注'
    workspace?.classList.toggle('is-focused', focus)
  }
  root.onkeydown = event => {
    if (event.key !== 'Escape') return
    if (!inspector.hidden) {
      event.preventDefault()
      event.stopPropagation()
      setInspector(false)
      toggle.focus()
    } else if (!record.hidden && record.contains(event.target as Node)) {
      event.preventDefault()
      event.stopPropagation()
      setRecord(false)
      recordToggle.focus()
    }
  }
  // 全屏按钮是动作按钮：进入全屏后它的语义变成「退出全屏」，图标与文案一起换。
  // 浏览器自带的退出方式（Esc / 系统手势）不会经过 onclick，所以跟 fullscreenchange 同步。
  const fullscreen = root.querySelector<HTMLButtonElement>('#fullscreen')!
  const syncFullscreen = () => {
    const active = Boolean(document.fullscreenElement)
    setIconButton(fullscreen, active ? 'minimize' : 'maximize', active ? '退出全屏' : '全屏预览')
    fullscreen.title = active ? '退出全屏' : '全屏预览'
  }
  document.addEventListener('fullscreenchange', syncFullscreen)
  syncFullscreen()
  // The root survives renderer changes; property handlers avoid accumulating listeners.
  leaveFocus()
  setRecord(previousRecordOpen)
  setInspector(!inspector.hidden)
  root.querySelector<HTMLElement>('.viewer')!.onpointerdown = event => {
    if (!inspector.hidden && (event.target as HTMLElement).closest('.stage-shell')) setInspector(false)
  }
  return () => document.removeEventListener('fullscreenchange', syncFullscreen)
}
