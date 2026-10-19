import './style.css'
import { initAppearance } from './theme'
import { createGlobalSettings } from './globalSettings'
import { initPwa } from './pwa'
import { loadSongList } from '@sukushow/llll-preview/songAssets'
import { cachedJsonResource, readResponseBytes, type DownloadProgress } from '@sukushow/llll-preview/resourceDownload'
import { createSongPicker, type SongPickerHandle } from './songPicker'
import { SongSelectionStore } from './songSelection'
import { formatResourceSize, measureResourceSizes } from './resourceLoading'
import { createSourceFiles } from './sourceFiles'
import { createSourceControls } from './sourceControls'
import { createSourceResolver, type SourceProgress } from './sourceResolver'
import { decodeChart } from '@sukushow/chart/chart'
import { readInitialSource, withCatalogChoice } from './sourceUrl'
import { resolveCatalogChoice, type CatalogChoice } from './songVersions'
import { currentLibrary, localChart, localizeMv, setLibrary, subscribeLibrary, type LocalLibrary } from './localMedia'
import {
  forgetDirectory, grantPending, libraryFromInput, pendingHandle,
  pickDirectory, restoreDirectory, supportsDirectoryPicker,
} from './localAssets'

type ViewId = 'llll' | 'pjsk'

const views: { id: ViewId; label: string }[] = [
  { id: 'llll', label: 'LLLL' },
  { id: 'pjsk', label: 'PJSK' },
]

type ViewContext = {
  root: HTMLElement
  toolbar: HTMLElement
  songSelection: SongSelectionStore
  sourceFiles: ReturnType<typeof createSourceFiles>
  resolveSource: (state: Parameters<typeof resolveSource>[0], onProgress?: (progress: SourceProgress) => void) => ReturnType<typeof resolveSource>
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
const appearance = initAppearance()

function initialSongBinding(): { songId: string } | null {
  try {
    const source = readInitialSource(new URL(window.location.href))
    return source.kind === 'catalog' ? { songId: source.songId } : null
  } catch { return null }
}

const songSelection = new SongSelectionStore(initialSongBinding())

app.innerHTML = `
  <div class="workspace" data-view="llll">
    <header class="workspace-header" id="workspace-header">
      <a class="brand" href="./" aria-label="sukushow 谱面放映室首页">
        <img class="brand-mark" src="/pwa/icon-192.png" alt="" width="34" height="34" />
        <span class="brand-copy">sukushow<span class="brand-period">.</span></span>
      </a>
      <nav class="mode-tabs" aria-label="预览模式">
        ${views.map((item) => `
          <button class="mode-tab${item.id === 'llll' ? ' is-active' : ''}" type="button" data-view="${item.id}" aria-controls="view-root" aria-current="${item.id === 'llll' ? 'page' : 'false'}">
            <strong>${item.label}</strong>
          </button>
        `).join('')}
      </nav>
      <div class="header-actions">
        <button type="button" class="quiet" id="browse-library" aria-label="搜索曲库" aria-haspopup="dialog" aria-controls="song-panel" aria-expanded="false" disabled><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><span>曲库</span><kbd>/</kbd></button>
        <button type="button" class="quiet" id="open-settings" aria-label="全局设置" aria-haspopup="dialog" aria-controls="global-settings" aria-expanded="false"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="m8 2-.5 2a6 6 0 0 0-1.4.8l-2-.6-2 3.5 1.5 1.4a6 6 0 0 0 0 1.8l-1.5 1.4 2 3.5 2-.6a6 6 0 0 0 1.4.8L8 18h4l.5-2a6 6 0 0 0 1.4-.8l2 .6 2-3.5-1.5-1.4a6 6 0 0 0 0-1.8l1.5-1.4-2-3.5-2 .6a6 6 0 0 0-1.4-.8L12 2Z"/><circle cx="10" cy="10" r="2.7"/></svg><span>设置</span></button>
      </div>
      <div id="song-picker-mount" class="song-picker" aria-label="选择曲目">
        <div class="picker-loading" role="status">
          <span class="picker-loading-detail" data-picker-loading-detail>正在下载 song-list.json…</span>
          <progress data-picker-loading-progress max="1" aria-label="曲目库下载进度"></progress>
          <span class="picker-loading-size" data-picker-loading-size hidden></span>
        </div>
      </div>
      <div class="view-toolbar" id="view-toolbar" aria-label="谱面来源与预览选项">
        <div class="file-toolbar" aria-label="打开谱面与音频">
          <button id="open-chart" class="file-action" type="button">＋ 打开谱面</button>
          <input class="sr-only" id="chart-file" type="file" accept=".json,.bytes,application/json" aria-label="选择谱面文件">
          <div class="media-controls">
            <button id="media-toggle" class="quiet" type="button" aria-expanded="false" aria-controls="media-panel">媒体</button>
            <div id="media-panel" hidden aria-label="媒体资源">
              ${([['audio', '音频', 'audio/*'], ['cover', '曲绘', 'image/*'], ['mv', 'MV', 'video/*']] as const).map(([kind, label, accept]) => `
                <div class="media-row" data-media-kind="${kind}">
                  <strong>${label}</strong><span data-media-status></span>
                  <div class="media-actions">
                    <button id="open-${kind}" class="quiet" type="button">添加${label}</button>
                    <button class="quiet" type="button" data-media-clear>清除</button>
                    <button class="quiet" type="button" data-media-inherit>恢复歌曲资源</button>
                  </div>
                  <input class="sr-only" id="${kind}-file" type="file" accept="${accept}" aria-label="添加本地${label}">
                </div>`).join('')}
            </div>
          </div>
          <button id="edit-metadata" class="quiet" type="button">编辑元数据</button>
          <div class="library-controls">
            <button id="pick-library" class="quiet" type="button">资源目录</button>
            <button id="forget-library" class="quiet" type="button" hidden>断开</button>
            <span id="library-status" role="status"></span>
            <input class="sr-only" id="library-input" type="file" webkitdirectory multiple aria-label="选择资源文件夹">
          </div>
          <span id="source-status" role="status"></span>
        </div>
        <div id="aspect-mount" class="aspect-mount"></div>
      </div>
    </header>
    <div id="view-root" class="workspace-content view-llll"></div>
    <footer class="workspace-footer">
      <a href="https://github.com/bywhite0/sukushow" target="_blank" rel="noreferrer">源码（AGPL-3.0-only）</a>
      <span><kbd>Space</kbd> 播放 / 暂停 <kbd>←</kbd><kbd>→</kbd> 跳转 5 秒</span>
    </footer>
  </div>
`

createGlobalSettings(app.querySelector<HTMLButtonElement>('#open-settings')!, appearance)
initPwa()

const workspace = app.querySelector<HTMLElement>('.workspace')!
const viewRoot = app.querySelector<HTMLElement>('#view-root')!
const toolbar = app.querySelector<HTMLElement>('#view-toolbar')!
const pickerMount = app.querySelector<HTMLElement>('#song-picker-mount')!
const pickerHome = pickerMount.parentElement!
let sharedSongPicker: SongPickerHandle | undefined
function moveSongPicker(host: Element) {
  const active = document.activeElement as HTMLElement | null
  const focused = active && pickerMount.contains(active)
    ? active.closest('#song-version-panel') ? pickerMount.querySelector<HTMLElement>('#song-version-toggle') : active
    : null
  host.append(pickerMount)
  if (focused) focused.focus({ preventScroll: true })
  sharedSongPicker?.refreshLayout()
}
const browseLibrary = app.querySelector<HTMLButtonElement>('#browse-library')!
function openLibrary(trigger?: HTMLElement) {
  sharedSongPicker?.openLibrary(trigger)
}
browseLibrary.onclick = () => openLibrary(browseLibrary)
app.addEventListener('click', event => {
  const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-library-open]')
  if (trigger) openLibrary(trigger)
})
document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey
    || (event.target as HTMLElement).closest('input,select,textarea,[contenteditable],dialog')) return
  event.preventDefault()
  openLibrary()
})
const modeTabs = [...app.querySelectorAll<HTMLButtonElement>('.mode-tab')]
const sourceFiles = createSourceFiles(songSelection)
type SongCredit = {
  id: string; lyricist: string | null; composer: string | null
  arranger: string | null; stringsArranger?: string | null; vocal: string[]
}
const loadCredits = cachedJsonResource<{ songs: SongCredit[] }>('/song-credits.json', '曲目详情')
const sourceDependencies = {
  measure: measureResourceSizes,
  includeMv: () => viewRoot.querySelector<HTMLInputElement>('#opt-mv')?.checked ?? true,
  loadList: () => loadSongList(),
  // 本地库里命中谱面就直接读文件；读不了或不是合法谱面则回落到站点资源。
  loadChart: async (filename: string, onProgress?: (progress: DownloadProgress) => void) => {
    const local = await localChart(filename)
    if (local) {
      try {
        return decodeChart(new Uint8Array(await local.arrayBuffer()))
      } catch {
        // 同名但不是谱面（选错目录 / 文件损坏）时继续走站点资源。
      }
    }
    const response = await fetch(`/assets/chart/${filename}`)
    if (!response.ok) throw new Error(`谱面下载失败（${response.status}）：${filename}`)
    return decodeChart(await readResponseBytes(response, onProgress))
  },
  loadCredits: async (songId: string, onProgress?: (progress: DownloadProgress) => void) => {
    const song = (await loadCredits(onProgress)).songs.find(item => item.id === songId)
    if (!song) return {}
    return { lyricist: song.lyricist, composer: song.composer,
      arranger: song.arranger ?? song.stringsArranger ?? null,
      vocal: song.vocal.length ? song.vocal.join('、') : null }
  },
  localizeMv: (path: string | null) => localizeMv(path),
  isLocalUrl: (url: string) => url.startsWith('blob:'),
}
const resolveSource = createSourceResolver(sourceDependencies)
const sourceControls = createSourceControls({
  root: toolbar, store: songSelection, files: sourceFiles,
  effectiveMetadata: async () => (await resolveSource(songSelection.getSource())).metadata,
  chartOpened: () => {
    const state = songSelection.getSource()
    const url = withCatalogChoice(new URL(location.href), { songId: state.songId ?? '', difficulty: null })
    if (!state.songId) url.searchParams.delete('song')
    for (const key of ['title', 'songTitle', 'musicTitle', 'scoreTitle', 'chartTitle', 'offset']) url.searchParams.delete(key)
    history.replaceState(null, '', url)
    previousSourceUrl = sourceUrlKey(url)
    historySourceToken++
  },
})
const sourceStatus = toolbar.querySelector<HTMLElement>('#source-status')!
function setSourceStatus(text: string, error = false) {
  sourceStatus.textContent = text
  sourceStatus.classList.toggle('is-error', error)
}
const libraryStatus = toolbar.querySelector<HTMLElement>('#library-status')!
const pickLibrary = toolbar.querySelector<HTMLButtonElement>('#pick-library')!
const forgetLibrary = toolbar.querySelector<HTMLButtonElement>('#forget-library')!
const libraryInput = toolbar.querySelector<HTMLInputElement>('#library-input')!

/** 换库后重新解析当前来源，让已打开的曲目立刻用上本地文件。 */
function applyLibrary(next: Parameters<typeof setLibrary>[0]) {
  setLibrary(next)
  const state = songSelection.getSource()
  // revision 递增触发视图重新应用；不改 identity，保留已打开的自制谱与编辑资料。
  songSelection.touch()
  if (state.songId) void refreshSourceStatus()
}

const describeLibrary = (next: LocalLibrary | null) => {
  if (!next) {
    libraryStatus.textContent = ''
    forgetLibrary.hidden = true
    return
  }
  const names = next.names()
  const count = (test: (name: string) => boolean) => names.filter(test).length
  const parts = [
    `MV ${count(name => name.endsWith('.usm') || /^\d+\.mp4$/.test(name))}`,
    `谱面 ${count(name => /^rhythmgame_chart_.*\.bytes$/.test(name))}`,
  ]
  libraryStatus.textContent = `${next.label} · ${parts.join(' · ')}`
  forgetLibrary.hidden = next.origin !== 'directory'
}
describeLibrary(currentLibrary())

pickLibrary.onclick = () => {
  if (!supportsDirectoryPicker()) { libraryInput.click(); return }
  void (async () => {
    try {
      const picked = await pickDirectory()
      if (!picked) return
      applyLibrary(picked)
    } catch (error) {
      libraryStatus.textContent = `选择目录失败：${String(error)}`
    }
  })()
}

libraryInput.onchange = () => {
  const files = libraryInput.files
  if (files?.length) applyLibrary(libraryFromInput(files))
  libraryInput.value = ''
}

forgetLibrary.onclick = () => {
  void (async () => {
    await forgetDirectory()
    applyLibrary(null)
  })()
}

// 上次选过的目录：有权限就静默恢复，没权限就在用户点击时再授权。
void (async () => {
  const restored = await restoreDirectory()
  if (restored) { applyLibrary(restored); return }
  const handle = await pendingHandle()
  if (!handle) return
  libraryStatus.textContent = '资源目录需要重新授权'
  pickLibrary.onclick = () => {
    void (async () => {
      const granted = await grantPending(handle)
      if (granted) { applyLibrary(granted); return }
      pickLibrary.onclick = null
      libraryStatus.textContent = ''
    })()
  }
})()

subscribeLibrary(next => describeLibrary(next))

let failedSourceRevision = -1
const refreshSourceStatus = async () => {
  const state = songSelection.getSource()
  const revision = state.revision
  try {
    const source = await resolveSource(state)
    if (revision !== songSelection.getSource().revision || revision === failedSourceRevision) return
    setSourceStatus(!source.chart && state.songId ? '暂无官方谱面，请打开自制谱' : '')
  } catch (error) {
    if (revision === songSelection.getSource().revision) setSourceStatus(`来源加载失败：${String(error)}`, true)
  }
}
songSelection.subscribeSource(() => void refreshSourceStatus(), true)

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

function updateSongUrl(selection: CatalogChoice | null) {
  let url = new URL(window.location.href)
  if (selection) {
    url = withCatalogChoice(url, selection)
  } else {
    url.searchParams.delete('song')
    url.searchParams.delete('difficulty')
  }
  history.replaceState(null, '', url)
  previousSourceUrl = sourceUrlKey(url)
}

async function initSharedSongPicker() {
  const mount = app!.querySelector<HTMLElement>('#song-picker-mount')!
  const initialIdentity = songSelection.getSource().identity
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
        songSelection.selectCatalog(selection, list)
        updateSongUrl(selection)
      },
      onVersionChange: (songId, difficulty) => {
        const selection = { songId, difficulty }
        songSelection.selectVersion(selection, list)
        updateSongUrl({ songId, difficulty: songSelection.getSource().chart.kind === 'custom' ? null : difficulty })
      },
    })
    sharedSongPicker = picker
    mount.replaceChildren(picker.root)
    workspace.append(picker.library)
    browseLibrary.disabled = false
    songSelection.subscribeSource(state => {
      const difficulty = state.chart.kind === 'official' ? state.chart.difficulty : null
      if (state.songId && (picker.currentSongId() !== state.songId
        || (state.chart.kind === 'official' && picker.currentDifficulty() !== difficulty))) {
        picker.select(state.songId, difficulty, false)
      }
      picker.setCustom(state.chart.kind === 'custom')
    }, true)
    if (songSelection.getSource().identity === initialIdentity) {
      try {
        const source = readInitialSource(new URL(window.location.href))
        if (source.kind === 'catalog') {
          const choice = resolveCatalogChoice(list, source.songId, source.difficulty, true)
          songSelection.selectCatalog(choice, list)
          if (source.offsetMs !== 0) songSelection.updateMetadata({ offsetMs: source.offsetMs })
        }
      } catch (error) {
        setSourceStatus(`来源加载失败：${String(error)}`, true)
      }
    }
  } catch (error) {
    mount.innerHTML = '<span class="picker-status" role="status">song-list.json 加载失败，曲目库暂不可用</span>'
    console.warn('[sukushow] 曲目列表加载失败：', error)
  }
}

let activeDispose: (() => void | Promise<void>) | undefined
let transition = 0

let activeDisposal: Promise<void> | undefined
function disposeActive(): Promise<void> {
  if (activeDisposal) return activeDisposal
  const dispose = activeDispose
  activeDispose = undefined
  moveSongPicker(pickerHome)
  activeDisposal = (async () => {
    if (dispose) await dispose()
    viewRoot.replaceChildren()
  })().finally(() => { activeDisposal = undefined })
  return activeDisposal
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
    const handle = await module.mount({ root: viewRoot, toolbar, songSelection, sourceFiles, resolveSource: (state, onProgress) => resolveSource(state, onProgress) })
    if (token !== transition) {
      resolveDispose(handle)?.()
      return
    }
    activeDispose = resolveDispose(handle)
    moveSongPicker(viewRoot.querySelector('[data-song-picker-slot]')!)
  } catch (error) {
    if (token !== transition) return
    viewRoot.innerHTML = '<main class="load-error" role="alert"><h1>预览模式加载失败</h1><p></p><button class="quiet" type="button" data-retry>返回 LLLL 模式</button></main>'
    viewRoot.querySelector<HTMLParagraphElement>('.load-error p')!.textContent = String(error)
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

function sourceUrlKey(url: URL): string {
  const next = new URL(url)
  next.searchParams.delete('view')
  next.searchParams.sort()
  return next.href
}
let previousSourceUrl = sourceUrlKey(new URL(window.location.href))
let historySourceToken = 0
window.addEventListener('popstate', () => {
  void showView(viewFromUrl())
  const token = ++historySourceToken
  const identity = songSelection.getSource().identity
  const url = new URL(window.location.href)
  const nextSourceUrl = sourceUrlKey(url)
  const unchanged = nextSourceUrl === previousSourceUrl
  previousSourceUrl = nextSourceUrl
  if (unchanged) return
  void (async () => {
    try {
      const source = readInitialSource(url)
      if (source.kind === 'url') { await initializeUrlSource(url, () => token === historySourceToken); return }
      const state = songSelection.getSource()
      if (state.songId === source.songId && state.chart.kind === 'custom') return
      const list = await loadSongList()
      if (token !== historySourceToken || identity !== songSelection.getSource().identity) return
      const choice = resolveCatalogChoice(list, source.songId, source.difficulty, true)
      songSelection.selectCatalog(choice, list)
      if (source.offsetMs !== 0) songSelection.updateMetadata({ offsetMs: source.offsetMs })
    } catch (error) {
      if (token === historySourceToken) setSourceStatus(`来源加载失败：${String(error)}`, true)
    }
  })()
})
async function initializeUrlSource(url = new URL(window.location.href), current = () => true) {
  const identity = songSelection.getSource().identity
  try {
    const source = readInitialSource(url)
    if (source.kind !== 'url') return
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`谱面下载失败（${response.status}）`)
    const limit = 16 * 1024 * 1024
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel()
      throw new Error('谱面文件超过 16 MiB')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('谱面响应为空')
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) { await reader.cancel(); throw new Error('谱面文件超过 16 MiB') }
        chunks.push(new Uint8Array(value))
      }
    } finally { reader.releaseLock() }
    if (!current() || songSelection.getSource().identity !== identity) return
    const name = new URL(source.url, location.href).pathname.split('/').pop() || 'URL 谱面'
    if (!await sourceFiles.openChart(new File(chunks, name), current)) return
    songSelection.updateMetadata({ ...(source.title ? { title: source.title } : {}), offsetMs: source.offsetMs })
  } catch (error) {
    if (current() && songSelection.getSource().identity === identity) {
      songSelection.clearSource()
      failedSourceRevision = songSelection.getSource().revision
      setSourceStatus(`来源加载失败：${String(error)}`, true)
    }
  }
}

let leaving: Promise<void> | undefined
window.addEventListener('pagehide', event => {
  if (event.persisted || leaving) return
  transition++
  historySourceToken++
  sourceControls.dispose()
  leaving = disposeActive().finally(() => sourceFiles.dispose())
})

const initialView = viewFromUrl()
const initialSourceToken = historySourceToken
void initializeUrlSource(new URL(window.location.href), () => initialSourceToken === historySourceToken)
updateUrl(initialView, false)
void initSharedSongPicker()
void showView(initialView)
