/** Shared presentation only. Player state and all renderer controls stay in the views. */
export const trackHeaderMarkup = `
 <header class="now-playing" id="record-panel" aria-label="当前谱面">
  <div class="section-label"><span>曲目</span><button type="button" class="quiet" data-record-close aria-label="收起曲目面板">×</button></div>
  <div class="artwork" id="artwork" data-state="empty">
   <img id="chart-jacket" alt="" hidden>
   <span class="artwork-mark" aria-hidden="true">♪</span>
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
   <button class="quiet record-toggle" type="button" data-record-toggle aria-label="切换曲目面板" aria-expanded="true" aria-controls="record-panel"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M8 3v14"/></svg><span>曲目 / 难度</span></button>
   <div class="stage-heading"><h2><button id="stage-track-name" type="button" data-library-open aria-haspopup="dialog" aria-controls="song-panel" aria-expanded="false">谱面预览</button></h2><span class="track-diff" id="stage-track-difficulty" hidden></span></div>
   <button class="quiet focus-toggle" type="button" data-focus-toggle aria-label="专注预览" aria-pressed="false"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 7V2h5m6 0h5v5M2 13v5h5m6 0h5v-5"/></svg><span>专注</span></button>
   <button class="quiet inspector-toggle" type="button" aria-label="切换预览设置" aria-expanded="false" aria-controls="preview-inspector" data-inspector-toggle>
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M12 3v14"/></svg><span>设置</span>
   </button>
  </div>`
}

export const transportMarkup = `
 <div class="transport">
  <label class="sr-only" for="timeline">播放进度</label><input id="timeline" type="range" min="0" max="36" step="0.001" value="0">
  <div class="transport-row">
   <button id="restart" class="quiet" aria-label="回到开头" title="回到开头"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 5v10M15 5l-8 5 8 5z"/></svg></button>
   <button id="play" class="primary" aria-label="播放">▶ 播放</button>
   <output id="time">00:00.000 / 00:36.000</output>
   <label class="rate-label"><span>倍率</span><select id="rate" aria-label="播放倍率"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
   <button id="export-video" class="quiet" type="button" title="导出视频"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 2v11m-4-4 4 4 4-4M3 13v4h14v-4"/></svg><span>导出视频</span></button>
   <button id="fullscreen" class="quiet" aria-label="全屏预览" title="全屏预览"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg></button>
  </div>
 </div>`

export function bindViewChrome(root: HTMLElement) {
  const toggle = root.querySelector<HTMLButtonElement>('[data-inspector-toggle]')!
  const inspector = root.querySelector<HTMLElement>('#preview-inspector')!
  const recordToggle = root.querySelector<HTMLButtonElement>('[data-record-toggle]')!
  const record = root.querySelector<HTMLElement>('#record-panel')!
  const focusToggle = root.querySelector<HTMLButtonElement>('[data-focus-toggle]')!
  const main = root.querySelector('main')!
  const workspace = root.closest('.workspace')
  let previousRecordOpen = !matchMedia('(max-width: 900px)').matches

  function setRecord(open: boolean) {
    record.hidden = !open
    recordToggle.setAttribute('aria-expanded', String(open))
    main.classList.toggle('record-collapsed', !open)
  }
  function setInspector(open: boolean) {
    inspector.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
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
  // The root survives renderer changes; property handlers avoid accumulating listeners.
  leaveFocus()
  setRecord(previousRecordOpen)
  root.querySelector<HTMLElement>('.viewer')!.onpointerdown = event => {
    if (!inspector.hidden && (event.target as HTMLElement).closest('.stage-shell')) setInspector(false)
  }
}
