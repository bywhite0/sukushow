import { registerSW } from 'virtual:pwa-register'
import {
  applySongCacheSetting,
  clearAllCaches,
  loadOfflineCacheEnabled,
  loadSongCacheEnabled,
  saveOfflineCacheEnabled,
  saveSongCacheEnabled,
} from './cacheSettings'

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>

let updateServiceWorker: UpdateServiceWorker | null = null
let listening = false
let notice: HTMLElement | null = null
let reloadRequested = false
let updateActive = false
let controlled = false

/** 离线缓存只在生产构建、且浏览器同时支持 Service Worker 与 Cache Storage 时可用。 */
export function offlineCacheSupported(): boolean {
  return import.meta.env.PROD
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof caches !== 'undefined'
}

/** 用户的离线缓存开关；开发模式读到的值只用于展示，不会注册 Service Worker。 */
export function offlineCacheEnabled(): boolean {
  return loadOfflineCacheEnabled()
}

/**
 * 打开 / 关闭离线缓存。关闭时注销 Service Worker 并清空缓存，
 * 打开时重新注册；返回设置是否写入成功。
 */
export async function setOfflineCacheEnabled(enabled: boolean): Promise<boolean> {
  const persisted = saveOfflineCacheEnabled(enabled)
  if (!offlineCacheSupported()) return persisted
  if (enabled) start()
  else await disableOfflineCache()
  return persisted
}

/** 歌曲资源缓存开关；默认关闭，读到的值只用于展示。 */
export function songCacheEnabled(): boolean {
  return loadSongCacheEnabled()
}

/**
 * 打开 / 关闭歌曲资源缓存。缓存是否存在就是 Service Worker 的开关信号：
 * 开启时创建（空）缓存，关闭时整体删除；返回设置是否写入成功。
 */
export async function setSongCacheEnabled(enabled: boolean): Promise<boolean> {
  const persisted = saveSongCacheEnabled(enabled)
  if (!offlineCacheSupported()) return persisted
  await applySongCacheSetting(caches, enabled)
  return persisted
}

function showUpdate(): void {
  if (notice) {
    notice.hidden = false
    return
  }
  notice = document.createElement('aside')
  notice.className = 'pwa-update'
  notice.setAttribute('role', 'status')
  notice.setAttribute('aria-live', 'polite')
  notice.innerHTML = `
    <div class="pwa-update-copy"><strong>新版本已就绪</strong><p>完成预览或导出后再刷新，本地文件需要重新选择。</p></div>
    <div class="pwa-update-actions">
      <button class="quiet" type="button" data-pwa-dismiss>稍后</button>
      <button class="primary" type="button" data-pwa-reload>更新并刷新</button>
    </div>`
  notice.querySelector<HTMLButtonElement>('[data-pwa-dismiss]')!.onclick = () => {
    notice!.hidden = true
  }
  notice.querySelector<HTMLButtonElement>('[data-pwa-reload]')!.onclick = async () => {
    reloadRequested = true
    if (updateActive || !updateServiceWorker) {
      window.location.reload()
    } else {
      await updateServiceWorker(true)
    }
  }
  document.body.append(notice)
}

function onControllerChange(): void {
  if (!controlled) {
    controlled = true
    return
  }
  // A different tab can activate an update even after this tab dismissed its prompt.
  if (reloadRequested) window.location.reload()
  else {
    updateActive = true
    showUpdate()
  }
}

function start(): void {
  if (updateServiceWorker) return
  controlled = navigator.serviceWorker.controller !== null
  if (!listening) {
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    listening = true
  }
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: showUpdate,
    // Native controllerchange above also handles updates classified as external by Workbox.
    onNeedReload() {},
    onRegisterError(error) {
      console.warn('离线支持未能启用，当前页面仍可在线使用。', error)
    },
  })
  // 缓存是否存在决定 Service Worker 是否缓存歌曲资源；页面启动时对齐一次。
  void applySongCacheSetting(caches)
}

async function disableOfflineCache(): Promise<void> {
  updateServiceWorker = null
  notice?.remove()
  notice = null
  reloadRequested = false
  updateActive = false
  controlled = false
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((registration) => registration.unregister()))
  } catch {
    // 注销失败时仍然清理缓存，避免留下不再使用的数据。
  }
  try {
    await clearAllCaches(caches)
  } catch {
    // 清理失败不阻断开关切换。
  }
}

/** Register only production builds. Updating is always an explicit action in this tab. */
export function initPwa(): void {
  if (!offlineCacheSupported()) return
  if (!loadOfflineCacheEnabled()) {
    void disableOfflineCache()
    return
  }
  start()
}
