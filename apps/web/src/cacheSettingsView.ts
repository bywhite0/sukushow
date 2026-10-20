import {
  CACHE_GROUPS,
  OFFLINE_CACHE_STORAGE_KEY,
  SONG_CACHE_STORAGE_KEY,
  SONG_GROUP_IDS,
  applySongCacheSetting,
  clearCaches,
  estimateCacheStorage,
  measureCacheUsage,
  type CacheGroup,
  type CacheGroupId,
  type CacheGroupSection,
  type CacheUsage,
} from './cacheSettings'
import { formatResourceSize } from './resourceLoading'
import {
  offlineCacheEnabled,
  offlineCacheSupported,
  setOfflineCacheEnabled,
  setSongCacheEnabled,
  songCacheEnabled,
} from './pwa'

function cacheGroupRow(group: CacheGroup): string {
  return `
          <div>
            <dt>${group.label}</dt>
            <dd><output data-cache-group="${group.id}">—</output><button type="button" class="text-button" data-cache-clear-group="${group.id}" disabled>清理</button></dd>
          </div>`
}

function cacheGroupRows(section: CacheGroupSection): string {
  return CACHE_GROUPS.filter((group) => group.section === section).map(cacheGroupRow).join('')
}

/** 缓存页正文；由 `globalSettings.ts` 拼进设置对话框。 */
export const cachePageMarkup = `
  <div class="preferences-content cache-page" data-page-panel="cache" hidden>
    <fieldset class="appearance-section">
      <legend>离线缓存</legend>
      <label class="check cache-toggle">
        <input type="checkbox" data-cache-offline aria-describedby="cache-offline-hint">
        <span>启用离线缓存<small id="cache-offline-hint">缓存应用界面、代码与渲染资源；关闭后不再写入缓存，并清理已有缓存。</small></span>
      </label>
      <p class="cache-support" data-cache-support hidden></p>
    </fieldset>
    <fieldset class="appearance-section">
      <legend>歌曲资源缓存</legend>
      <label class="check cache-toggle">
        <input type="checkbox" data-cache-song aria-describedby="cache-song-hint">
        <span>缓存歌曲资源<small id="cache-song-hint">音频、MV、谱面与曲绘体积很大，开启后按使用情况缓存，便于离线播放；默认关闭。</small></span>
      </label>
      <p class="cache-support" data-cache-song-support hidden></p>
    </fieldset>
    <fieldset class="appearance-section">
      <legend>缓存占用</legend>
      <dl class="cache-usage">
        <div><dt>已缓存</dt><dd><output data-cache-total>正在统计…</output></dd></div>
        <div><dt>浏览器存储配额</dt><dd><output data-cache-quota>—</output></dd></div>
      </dl>
      <dl class="cache-groups">${cacheGroupRows('base')}
      </dl>
      <p class="cache-groups-heading">歌曲资源</p>
      <dl class="cache-groups">${cacheGroupRows('song')}
      </dl>
      <dl class="cache-groups">${cacheGroupRows('other')}
      </dl>
      <div class="cache-actions">
        <button type="button" class="text-button" data-cache-clear-all disabled>清理全部缓存</button>
      </div>
    </fieldset>
    <p class="cache-note">歌曲资源默认不缓存，也不会在安装时下载整套资源库；开启后音频、MV、谱面、曲绘分别统计、分别清理。清理应用界面缓存后，需要联网刷新一次才能恢复离线能力；清理歌曲资源只会删除已缓存的文件，开关保持开启时下次加载会重新缓存。</p>
  </div>`

export const cacheFooterMarkup = `
  <footer class="preferences-footer" data-page-footer="cache" hidden>
    <span data-cache-status role="status" aria-live="polite">缓存占用浏览器存储空间，可随时清理。</span>
    <button type="button" class="text-button" data-cache-refresh>重新统计</button>
  </footer>`

export type CachePageController = {
  /** 重新读取缓存占用；页面每次显示时调用。 */
  refresh: () => Promise<void>
  /** 同步开关状态与当前环境说明。 */
  sync: () => void
}

export function createCachePage(dialog: HTMLDialogElement): CachePageController {
  const offlineToggle = dialog.querySelector<HTMLInputElement>('[data-cache-offline]')!
  const songToggle = dialog.querySelector<HTMLInputElement>('[data-cache-song]')!
  const support = dialog.querySelector<HTMLElement>('[data-cache-support]')!
  const songSupport = dialog.querySelector<HTMLElement>('[data-cache-song-support]')!
  const total = dialog.querySelector<HTMLOutputElement>('[data-cache-total]')!
  const quota = dialog.querySelector<HTMLOutputElement>('[data-cache-quota]')!
  const groupOutputs = new Map<CacheGroupId, HTMLOutputElement>(
    [...dialog.querySelectorAll<HTMLOutputElement>('[data-cache-group]')]
      .map((output) => [output.dataset.cacheGroup as CacheGroupId, output]),
  )
  const groupClearButtons = new Map<CacheGroupId, HTMLButtonElement>(
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-cache-clear-group]')]
      .map((button) => [button.dataset.cacheClearGroup as CacheGroupId, button]),
  )
  const clearAll = dialog.querySelector<HTMLButtonElement>('[data-cache-clear-all]')!
  const refreshButton = dialog.querySelector<HTMLButtonElement>('[data-cache-refresh]')!
  const status = dialog.querySelector<HTMLElement>('[data-cache-status]')!

  const supported = offlineCacheSupported()
  let usage: CacheUsage | null = null
  let busy = false

  function setStatus(text: string, error = false): void {
    status.textContent = text
    status.classList.toggle('is-error', error)
  }

  function groupEntries(id: CacheGroupId): number {
    return usage?.groups.find((group) => group.id === id)?.entries ?? 0
  }

  function updateActions(): void {
    for (const [id, button] of groupClearButtons) {
      button.disabled = busy || groupEntries(id) === 0
    }
    clearAll.disabled = busy || !usage || usage.totalEntries === 0
    refreshButton.disabled = busy
  }

  function renderUsage(next: CacheUsage, estimate: { quotaBytes?: number }): void {
    usage = next
    total.textContent = `${formatResourceSize(next.totalBytes)} · ${next.totalEntries} 项`
    quota.textContent = estimate.quotaBytes && estimate.quotaBytes > 0 ? formatResourceSize(estimate.quotaBytes) : '未知'
    for (const group of next.groups) {
      groupOutputs.get(group.id)!.textContent = `${formatResourceSize(group.bytes)} · ${group.entries} 项`
    }
  }

  function sync(): void {
    const offline = offlineCacheEnabled()
    offlineToggle.checked = offline
    offlineToggle.disabled = !supported
    support.hidden = supported
    support.textContent = supported
      ? ''
      : '当前环境不启用离线缓存：开发模式或浏览器不支持 Service Worker / Cache Storage。'

    songToggle.checked = songCacheEnabled()
    songToggle.disabled = !supported || !offline
    songSupport.hidden = supported && offline
    songSupport.textContent = !supported
      ? '当前环境不启用离线缓存，歌曲资源不会写入缓存。'
      : offline ? '' : '需要先启用离线缓存。'
  }

  async function refresh(): Promise<void> {
    if (busy) return
    if (typeof caches === 'undefined') {
      usage = null
      total.textContent = '当前浏览器不支持缓存统计'
      quota.textContent = '—'
      for (const output of groupOutputs.values()) output.textContent = '—'
      updateActions()
      return
    }
    busy = true
    updateActions()
    setStatus('正在统计缓存占用…')
    try {
      const [next, estimate] = await Promise.all([measureCacheUsage(caches), estimateCacheStorage()])
      renderUsage(next, estimate)
      setStatus('缓存占用浏览器存储空间，可随时清理。')
    } catch {
      setStatus('无法读取缓存占用。', true)
    } finally {
      busy = false
      updateActions()
    }
  }

  async function clear(groups: readonly CacheGroupId[]): Promise<void> {
    if (busy || typeof caches === 'undefined') return
    const affected = usage?.groups.filter((group) => groups.includes(group.id)) ?? []
    const entries = affected.reduce((sum, group) => sum + group.entries, 0)
    const bytes = affected.reduce((sum, group) => sum + group.bytes, 0)
    if (entries === 0) {
      setStatus('对应缓存已经是空的。')
      return
    }
    busy = true
    updateActions()
    setStatus('正在清理缓存…')
    try {
      await clearCaches(caches, groups)
      // 歌曲资源缓存的存在本身就是开关信号：开关仍开启时补回空缓存，
      // 否则下一次加载不会重新缓存。
      if (groups.some((id) => SONG_GROUP_IDS.includes(id)) && songCacheEnabled()) {
        await applySongCacheSetting(caches, true)
      }
      busy = false
      await refresh()
      const label = groups.length === CACHE_GROUPS.length
        ? '全部缓存'
        : CACHE_GROUPS.filter((group) => groups.includes(group.id)).map((group) => group.short).join('、')
      const suffix = groups.includes('precache') ? '联网刷新一次可恢复离线能力。' : ''
      setStatus(`已清理${label}（${entries} 项 · ${formatResourceSize(bytes)}）。${suffix}`)
    } catch {
      busy = false
      updateActions()
      setStatus('清理缓存失败，请刷新页面重试。', true)
    }
  }

  async function toggleOffline(): Promise<void> {
    const next = offlineToggle.checked
    offlineToggle.disabled = true
    setStatus(next ? '正在启用离线缓存…' : '正在关闭离线缓存并清理缓存…')
    let message: string
    let error = false
    try {
      const persisted = await setOfflineCacheEnabled(next)
      if (!persisted) {
        message = '已应用，但浏览器无法保存设置。'
        error = true
      } else {
        message = next ? '已启用离线缓存；联网刷新一次后离线可用。' : '已关闭离线缓存，并清理了已缓存的资源。'
      }
    } catch {
      message = '切换离线缓存失败，请刷新页面重试。'
      error = true
    }
    sync()
    await refresh()
    setStatus(message, error)
  }

  async function toggleSong(): Promise<void> {
    const next = songToggle.checked
    songToggle.disabled = true
    setStatus(next ? '正在启用歌曲资源缓存…' : '正在清理歌曲资源缓存…')
    let message: string
    let error = false
    try {
      const persisted = await setSongCacheEnabled(next)
      if (!persisted) {
        message = '已应用，但浏览器无法保存设置。'
        error = true
      } else {
        message = next
          ? '已启用歌曲资源缓存；之后加载的音频、MV、谱面与曲绘会写入缓存。'
          : '已关闭歌曲资源缓存，并删除了已缓存的歌曲资源。'
      }
    } catch {
      message = '切换歌曲资源缓存失败，请刷新页面重试。'
      error = true
    }
    sync()
    await refresh()
    setStatus(message, error)
  }

  offlineToggle.onchange = () => void toggleOffline()
  songToggle.onchange = () => void toggleSong()
  for (const [id, button] of groupClearButtons) button.onclick = () => void clear([id])
  clearAll.onclick = () => void clear(CACHE_GROUPS.map((group) => group.id))
  refreshButton.onclick = () => void refresh()

  // 其他标签页切换开关时只同步界面：Service Worker 注册与缓存的变更本来就是
  // 整个源共享的，这里再写一次 localStorage 会让两个标签页互相触发 storage 事件。
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== OFFLINE_CACHE_STORAGE_KEY && event.key !== SONG_CACHE_STORAGE_KEY) return
    sync()
    void refresh()
  })

  sync()
  return { refresh, sync }
}
