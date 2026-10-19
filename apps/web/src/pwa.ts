import { registerSW } from 'virtual:pwa-register'

/** Register only production builds. Updating is always an explicit action in this tab. */
export function initPwa(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  let reloadRequested = false
  let updateActive = false
  let controlled = navigator.serviceWorker.controller !== null
  let notice: HTMLElement | null = null

  const showUpdate = () => {
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
      if (updateActive) {
        window.location.reload()
      } else {
        await updateServiceWorker(true)
      }
    }
    document.body.append(notice)
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
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
  })

  const updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: showUpdate,
    // Native controllerchange above also handles updates classified as external by Workbox.
    onNeedReload() {},
    onRegisterError(error) {
      console.warn('离线支持未能启用，当前页面仍可在线使用。', error)
    },
  })
}
