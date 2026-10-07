import './style.css'
import { loadSongList } from '@sukushow/llll-preview/songAssets'
import { createSongPicker, DIFFICULTY_ORDER, type SongPickerHandle } from './songPicker'
import { SongSelectionStore, type SongSelection } from './songSelection'
import { formatResourceSize } from './resourceLoading'

type ViewId = 'llll' | 'pjsk'

const views: { id: ViewId; label: string; detail: string }[] = [
  { id: 'llll', label: '舞台', detail: 'LLLL 3D / 2D' },
  { id: 'pjsk', label: 'PJSK', detail: '60 轨渲染' },
]

type ViewContext = {
  root: HTMLElement
  toolbar: HTMLElement
  songSelection: SongSelectionStore
}

type ViewHandle =
  | void
  | (() => void | Promise<void>)
  | { dispose?: () => void | Promise<void> }

type ViewModule = {
  mount: (context: ViewContext) => ViewHandle | Promise<ViewHandle>
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('缺少统一前端容器。')

function selectionFromUrl(): SongSelection | null {
  const params = new URLSearchParams(window.location.search)
  const songId = params.get('song')
  if (!songId) return null
  const rawDifficulty = params.get('difficulty')?.toUpperCase()
  const difficulty = DIFFICULTY_ORDER.find((name) => name === rawDifficulty) ?? 'MASTER'
  return { songId, difficulty }
}

const songSelection = new SongSelectionStore(selectionFromUrl())

app.innerHTML = `
  <div class="workspace" data-view="llll">
    <header class="workspace-header" id="workspace-header">
      <a class="brand" href="./" aria-label="llll 谱面放映室首页">
        <span class="brand-mark" aria-hidden="true">llll</span>
        <span class="brand-copy">谱面放映室<small>CHART PREVIEW</small></span>
      </a>
      <nav class="mode-tabs" aria-label="预览模式">
        ${views.map((item) => `
          <button class="mode-tab${item.id === 'llll' ? ' is-active' : ''}" type="button" data-view="${item.id}" aria-controls="view-root" aria-current="${item.id === 'llll' ? 'page' : 'false'}">
            <strong>${item.label}</strong><small>${item.detail}</small>
          </button>
        `).join('')}
      </nav>
      <div class="view-toolbar" id="view-toolbar" aria-label="谱面来源与预览选项">
        <div id="song-picker-mount" class="song-picker" aria-label="选择曲目">
          <div class="picker-loading" role="status">
            <span class="picker-loading-detail" data-picker-loading-detail>正在下载 song-list.json…</span>
            <progress data-picker-loading-progress max="1" aria-label="曲目库下载进度"></progress>
            <span class="picker-loading-size" data-picker-loading-size hidden></span>
          </div>
        </div>
        <div id="aspect-mount" class="aspect-mount"></div>
        <div class="file-toolbar" aria-label="打开谱面与音频">
          <button id="open-chart" class="file-action" type="button">＋ 打开谱面</button>
          <input class="sr-only" id="chart-file" type="file" accept=".json,.bytes,application/json" aria-label="选择谱面文件">
          <button id="open-audio" class="quiet" type="button">添加音频</button>
          <input class="sr-only" id="audio-file" type="file" accept="audio/*" aria-label="添加本地音频">
          <button id="demo" class="text-button" type="button" aria-label="重新打开演示谱">演示谱</button>
        </div>
      </div>
      <span class="local-badge">本地运行 · 文件不上传</span>
    </header>
    <div id="view-root" class="workspace-content view-llll"></div>
    <footer class="workspace-footer">
      <span>非官方研究工具 · 原格式谱面预览</span>
      <span><kbd>Space</kbd> 播放 / 暂停 <kbd>←</kbd><kbd>→</kbd> 跳转 5 秒</span>
    </footer>
  </div>
`

const workspace = app.querySelector<HTMLElement>('.workspace')!
const viewRoot = app.querySelector<HTMLElement>('#view-root')!
const toolbar = app.querySelector<HTMLElement>('#view-toolbar')!
const modeTabs = [...app.querySelectorAll<HTMLButtonElement>('.mode-tab')]

const modules: Record<ViewId, () => Promise<ViewModule>> = {
  llll: () => import('./views/llll') as Promise<ViewModule>,
  pjsk: () => import('./views/pjsk') as Promise<ViewModule>,
}

function viewFromUrl(): ViewId {
  const requested = new URLSearchParams(window.location.search).get('view')
  return views.some((item) => item.id === requested) ? requested as ViewId : 'llll'
}

function updateUrl(view: ViewId, push: boolean) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', view)
  if (push) history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}

function updateModeChrome(view: ViewId) {
  workspace.dataset.view = view
  viewRoot.className = `workspace-content view-${view}`
  for (const tab of modeTabs) {
    const active = tab.dataset.view === view
    tab.classList.toggle('is-active', active)
    tab.setAttribute('aria-current', active ? 'page' : 'false')
  }
}

function updateSongUrl(selection: SongSelection | null) {
  const url = new URL(window.location.href)
  if (selection) {
    url.searchParams.set('song', selection.songId)
    url.searchParams.set('difficulty', selection.difficulty)
    url.searchParams.delete('chart')
  } else {
    url.searchParams.delete('song')
    url.searchParams.delete('difficulty')
  }
  history.replaceState(null, '', url)
}

async function initSharedSongPicker() {
  const mount = app!.querySelector<HTMLElement>('#song-picker-mount')!
  try {
    const detail = mount.querySelector<HTMLElement>('[data-picker-loading-detail]')
    const progress = mount.querySelector<HTMLProgressElement>('[data-picker-loading-progress]')
    const size = mount.querySelector<HTMLElement>('[data-picker-loading-size]')
    const list = await loadSongList((state) => {
      if (!detail || !progress || !size) return
      detail.textContent = state.phase === 'download' ? '正在下载 song-list.json…' : '曲目库已下载，正在建立索引…'
      if (state.totalBytes !== undefined) {
        progress.max = state.totalBytes
        progress.value = state.downloadedBytes ?? 0
        size.hidden = false
        size.textContent = `(已下载 ${formatResourceSize(state.downloadedBytes ?? 0)} / ${formatResourceSize(state.totalBytes)})`
      } else if (state.phase === 'ready' && state.downloadedBytes !== undefined) {
        progress.max = state.downloadedBytes
        progress.value = state.downloadedBytes
        size.hidden = false
        size.textContent = `(已下载 ${formatResourceSize(state.downloadedBytes)} / ${formatResourceSize(state.downloadedBytes)})`
      }
    })
    const picker: SongPickerHandle = createSongPicker({
      list,
      onChange: (songId, difficulty) => {
        const selection = { songId, difficulty }
        songSelection.set(selection)
        updateSongUrl(selection)
      },
    })
    mount.replaceChildren(picker.root)
    const initial = songSelection.get()
    if (initial) picker.select(initial.songId, initial.difficulty, false)
  } catch (error) {
    mount.innerHTML = '<span class="picker-status" role="status">song-list.json 加载失败，曲目库暂不可用</span>'
    console.warn('[sukushow] 曲目列表加载失败：', error)
  }
}

let activeDispose: (() => void | Promise<void>) | undefined
let transition = 0

async function disposeActive() {
  const dispose = activeDispose
  activeDispose = undefined
  if (dispose) await dispose()
  viewRoot.replaceChildren()
}

function resolveDispose(handle: ViewHandle): (() => void | Promise<void>) | undefined {
  if (typeof handle === 'function') return handle
  return handle?.dispose
}

async function showView(view: ViewId, push = false) {
  const token = ++transition
  updateModeChrome(view)
  if (push) updateUrl(view, true)
  await disposeActive()
  if (token !== transition) return
  viewRoot.innerHTML = `<div class="view-loading" role="status"><div class="view-loading-card"><strong>正在加载页面资源…</strong><progress data-view-loading-progress aria-label="页面资源加载进度"></progress><div class="view-loading-meta"><span data-view-loading-detail>正在下载预览模块…</span><output data-view-loading-percent>加载中…</output></div></div></div>`
  try {
    const module = await modules[view]()
    if (token !== transition) return
    const loadingDetail = viewRoot.querySelector<HTMLElement>('[data-view-loading-detail]')
    const loadingProgress = viewRoot.querySelector<HTMLProgressElement>('[data-view-loading-progress]')
    const loadingPercent = viewRoot.querySelector<HTMLOutputElement>('[data-view-loading-percent]')
    if (loadingDetail) loadingDetail.textContent = `预览模块已下载，正在启动 ${view.toUpperCase()} 渲染器…`
    if (loadingProgress) {
      loadingProgress.max = 1
      loadingProgress.value = 1
    }
    if (loadingPercent) loadingPercent.textContent = '启动中…'
    const handle = await module.mount({ root: viewRoot, toolbar, songSelection })
    if (token !== transition) {
      resolveDispose(handle)?.()
      return
    }
    activeDispose = resolveDispose(handle)
  } catch (error) {
    if (token !== transition) return
    viewRoot.innerHTML = `<main class="load-error" role="alert"><h1>预览模式加载失败</h1><p>${String(error)}</p><button class="quiet" type="button" data-retry>返回 LLLL 模式</button></main>`
    viewRoot.querySelector<HTMLButtonElement>('[data-retry]')!.onclick = () => void showView('llll', true)
    console.error(error)
  }
}

for (const tab of modeTabs) {
  tab.onclick = () => {
    const next = tab.dataset.view as ViewId
    if (next !== workspace.dataset.view) void showView(next, true)
  }
}

window.addEventListener('popstate', () => void showView(viewFromUrl()))
const initialView = viewFromUrl()
updateUrl(initialView, false)
void initSharedSongPicker()
void showView(initialView)
