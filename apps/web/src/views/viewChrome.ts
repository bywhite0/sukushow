import { icon, setIcon, setIconButton } from '../icons'
import { focusFromPointer } from '../keyboard'

/**
 * 全屏时控制区学视频播放器：底部一条通栏控制栏，曲目名、进度条、按钮行从上到下排布，整条按视口宽度铺满；
 * 控制栏只在底部压一层淡黑渐变，控件浮在画面上，配色固定深色（浅色主题下也不跟随），静止一段时间后自动隐藏。
 * 指针移动、触摸、按键、焦点回到控制栏或出现状态提示时重新出现；指针停在控制栏上（含条上的空白处）、
 * 焦点在控制栏内、曲库弹层打开时保持显示，避免操作中消失。
 * 锁定后控制栏保持隐藏，判定输入与误触都不会把它叫出来；屏幕左侧中部的锁定按钮常驻，锁定时变成解锁入口。
 */
const CHROME_IDLE_DELAY = 2600
const CHROME_IDLE_CLASS = 'is-chrome-idle'
const CHROME_LOCK_CLASS = 'is-chrome-locked'

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
  return `<div class="stage-toolbar" id="stage-toolbar">
   <button class="quiet record-toggle" type="button" data-record-toggle aria-label="切换曲目面板" aria-expanded="true" aria-controls="record-panel">${icon('panel-left-close', 16)}<span>曲目 / 难度</span></button>
   <div class="stage-heading"><h2><button id="stage-track-name" type="button" data-library-open aria-haspopup="dialog" aria-controls="song-panel" aria-expanded="false">谱面预览</button></h2><span class="track-diff" id="stage-track-difficulty" hidden></span></div>
   <button class="quiet focus-toggle" type="button" data-focus-toggle aria-label="专注预览" aria-pressed="false">${icon('focus', 16)}<span>专注</span></button>
   <button class="quiet inspector-toggle" type="button" aria-label="切换预览设置" aria-expanded="false" aria-controls="preview-inspector" data-inspector-toggle>
    ${icon('panel-right-open', 16)}<span>设置</span>
   </button>
  </div>
  <button class="quiet chrome-lock" type="button" data-chrome-lock aria-label="锁定控制栏" title="锁定控制栏：隐藏控制栏，避免误触唤出" aria-pressed="false" aria-controls="stage-toolbar transport">${icon('lock', 18)}</button>`
}

/**
 * 走带条。`svgExport` 只给 LLLL 舞台开——静态 SVG 谱面是 LLLL 的导出形式，
 * PJSK 侧只有视频导出，所以按钮按模式注入而不是常驻。`playMode` 同理：只有 LLLL
 * 有手动判定状态机，PJSK 侧不显示游玩开关。
 */
export function transportMarkup({ svgExport = false, playMode = false }: { svgExport?: boolean; playMode?: boolean } = {}) {
  return `
 <div class="transport" id="transport">
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
  const viewer = root.querySelector<HTMLElement>('.viewer')!
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
  // 全屏时曲目名并进底部控制栏：静止后整条滑出，指针 / 键盘 / 状态提示都会把它们叫回来。
  // 锁定后控制栏保持隐藏，判定输入与误触都不会把它叫出来，只留屏幕左侧的解锁按钮。
  const stageToolbar = viewer.querySelector<HTMLElement>('#stage-toolbar')!
  const transport = viewer.querySelector<HTMLElement>('#transport')!
  const status = viewer.querySelector<HTMLElement>('#message')
  // 锁定按钮常驻屏幕左侧中部：控制栏显示时也在这，隐藏后它是解锁入口。
  const lockButton = root.querySelector<HTMLButtonElement>('[data-chrome-lock]')!
  const chromeBars = [stageToolbar, transport]
  let chromeIdleTimer = 0
  let chromeLocked = false
  // 控制栏是 pointer-events:none 的浮层，:hover 只在压住控件时命中；这里记下鼠标最后的位置，
  // 空闲计时到点时再按当时的控制栏盒判断是否还停在条上（滑入滑出的 transform 那时已经结束）。
  let pointerAt: { x: number; y: number } | null = null
  const isFullscreen = () => document.fullscreenElement === viewer
  const chromeHovered = () => {
    if (lockButton.matches(':hover')) return true
    const at = pointerAt
    if (!at) return false
    return chromeBars.some(bar => {
      const rect = bar.getBoundingClientRect()
      return at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom
    })
  }
  // 只保护键盘焦点：鼠标点过全屏按钮后焦点仍留在走带条上，不能因此永不隐藏。
  const chromeFocused = () => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || focusFromPointer()) return false
    return active === lockButton || chromeBars.some(bar => bar.contains(active))
  }
  const chromePopoverOpen = () => Boolean(viewer.querySelector('[popover]:popover-open'))
  function setChromeIdle(idle: boolean) {
    viewer.classList.toggle(CHROME_IDLE_CLASS, idle)
    for (const bar of chromeBars) bar.toggleAttribute('inert', idle)
  }
  function scheduleChromeIdle() {
    clearTimeout(chromeIdleTimer)
    if (!isFullscreen() || chromeLocked) return
    chromeIdleTimer = window.setTimeout(() => {
      if (!isFullscreen() || chromeLocked) return
      if (chromeHovered() || chromeFocused() || chromePopoverOpen()) {
        scheduleChromeIdle()
        return
      }
      setChromeIdle(true)
    }, CHROME_IDLE_DELAY)
  }
  /** 按当前全屏与锁定状态决定控制栏是显示还是进入空闲计时。 */
  function applyChrome() {
    clearTimeout(chromeIdleTimer)
    if (!isFullscreen()) {
      setChromeIdle(false)
      return
    }
    if (chromeLocked) {
      setChromeIdle(true)
      return
    }
    setChromeIdle(false)
    scheduleChromeIdle()
  }
  function revealChrome() {
    if (!isFullscreen() || chromeLocked) return
    setChromeIdle(false)
    scheduleChromeIdle()
  }
  function setChromeLocked(locked: boolean) {
    chromeLocked = locked
    viewer.classList.toggle(CHROME_LOCK_CLASS, locked)
    lockButton.setAttribute('aria-pressed', String(locked))
    lockButton.setAttribute('aria-label', locked ? '解除锁定' : '锁定控制栏')
    lockButton.title = locked ? '解除锁定，恢复控制栏' : '锁定控制栏：隐藏控制栏，避免误触唤出'
    setIcon(lockButton, locked ? 'lock-open' : 'lock')
    applyChrome()
  }
  const onLockClick = () => setChromeLocked(!chromeLocked)
  // 只有 LLLL 有游玩模式：按键 / 触摸在那里是判定输入，进入时自动锁定，避免判定输入反复叫出浮层。
  const playModeButton = root.querySelector<HTMLButtonElement>('#play-mode')
  const playModeActive = () => playModeButton?.getAttribute('aria-pressed') === 'true'
  const onChromeKeydown = (event: KeyboardEvent) => {
    // Esc 是浏览器退出全屏的快捷键，不用先亮出控制栏。
    if (event.key !== 'Escape') revealChrome()
  }
  lockButton.addEventListener('click', onLockClick)
  const onViewerPointerMove = (event: PointerEvent) => {
    // 悬停只对鼠标成立：触摸抬指后不该把控制栏永久钉住。
    pointerAt = event.pointerType === 'mouse' ? { x: event.clientX, y: event.clientY } : null
    revealChrome()
  }
  const onViewerPointerLeave = () => { pointerAt = null }
  viewer.addEventListener('pointermove', onViewerPointerMove)
  viewer.addEventListener('pointerleave', onViewerPointerLeave)
  viewer.addEventListener('pointerdown', revealChrome)
  viewer.addEventListener('focusin', revealChrome)
  document.addEventListener('keydown', onChromeKeydown)
  // 状态提示出现时把控制栏叫回来，避免错误信息在隐藏状态下看不到。
  let statusObserver: MutationObserver | null = null
  if (status) {
    statusObserver = new MutationObserver(() => { if (status.textContent) revealChrome() })
    statusObserver.observe(status, { childList: true, characterData: true, subtree: true })
  }
  // 状态行浮在走带条上方，走带条高度随窄屏布局变化，这里同步给 CSS 定位。
  const syncTransportHeight = () => viewer.style.setProperty('--transport-h', `${transport.offsetHeight}px`)
  const transportObserver = new ResizeObserver(syncTransportHeight)
  transportObserver.observe(transport)
  syncTransportHeight()
  // 游玩模式一开就锁定控制栏；退出后恢复普通自动隐藏。
  let playModeObserver: MutationObserver | null = null
  if (playModeButton) {
    playModeObserver = new MutationObserver(() => setChromeLocked(playModeActive()))
    playModeObserver.observe(playModeButton, { attributes: true, attributeFilter: ['aria-pressed'] })
  }
  setChromeLocked(playModeActive())
  const syncFullscreen = () => {
    // 进入 / 退出全屏时走带条的内边距与高度都会变，先同步一次再排控制栏，不依赖 ResizeObserver 的回调时序。
    syncTransportHeight()
    const active = Boolean(document.fullscreenElement)
    setIconButton(fullscreen, active ? 'minimize' : 'maximize', active ? '退出全屏' : '全屏预览')
    fullscreen.title = active ? '退出全屏' : '全屏预览'
    // 退出全屏恢复常亮；游玩模式保持自动锁定，重新进入全屏时直接回到干净的游玩画面。
    setChromeLocked(playModeActive())
  }
  document.addEventListener('fullscreenchange', syncFullscreen)
  syncFullscreen()
  // The root survives renderer changes; property handlers avoid accumulating listeners.
  leaveFocus()
  setRecord(previousRecordOpen)
  setInspector(!inspector.hidden)
  viewer.onpointerdown = event => {
    if (!inspector.hidden && (event.target as HTMLElement).closest('.stage-shell')) setInspector(false)
  }
  return () => {
    document.removeEventListener('fullscreenchange', syncFullscreen)
    document.removeEventListener('keydown', onChromeKeydown)
    lockButton.removeEventListener('click', onLockClick)
    viewer.removeEventListener('pointermove', onViewerPointerMove)
    viewer.removeEventListener('pointerleave', onViewerPointerLeave)
    viewer.removeEventListener('pointerdown', revealChrome)
    viewer.removeEventListener('focusin', revealChrome)
    clearTimeout(chromeIdleTimer)
    transportObserver.disconnect()
    statusObserver?.disconnect()
    playModeObserver?.disconnect()
  }
}
