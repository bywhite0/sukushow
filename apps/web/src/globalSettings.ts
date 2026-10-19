import './globalSettings.css'
import { APP_VERSION, BUILD_COMMIT, BUILD_TIME, formatBuildTime, formatVersion } from './buildInfo'
import { ACCENT_COLORS, DEFAULT_APPEARANCE, accentPalette, type AppearanceController, type AppearanceMode, type AccentId } from './theme'
import { icon } from './icons'

const SOURCE_URL = 'https://github.com/bywhite0/sukushow'

const appearanceModes = [
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' },
  { id: 'system', name: '跟随系统' },
] as const

const appearanceIcon = icon('palette', 18)
const chevronIcon = icon('chevron-right', 14, { className: 'preferences-brand-chevron' })
const githubIcon = icon('github', 18)

export function createGlobalSettings(trigger: HTMLButtonElement, appearance: AppearanceController) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ ,' : 'Ctrl ,'
  trigger.title = `全局设置（${shortcut}）`
  const dialog = document.createElement('dialog')
  dialog.id = 'global-settings'
  dialog.className = 'global-settings'
  dialog.setAttribute('aria-labelledby', 'global-settings-title')
  dialog.innerHTML = `
    <div class="preferences-window">
      <aside class="preferences-sidebar" aria-label="设置分类">
        <h1 id="global-settings-title">设置</h1>
        <nav class="preferences-nav" aria-label="设置页面">
          <button type="button" class="preferences-category" data-page="appearance" aria-current="page"><span>${appearanceIcon}</span>外观</button>
          <button type="button" class="preferences-brand" data-page="about" aria-label="关于 sukushow" title="关于 sukushow">
            <img src="/pwa/icon-192.png" alt="" width="30" height="30">
            <span class="preferences-brand-copy"><strong>sukushow</strong><span>谱面放映室</span></span>
            ${chevronIcon}
          </button>
        </nav>
      </aside>
      <section class="preferences-main" aria-labelledby="preferences-title">
        <header class="preferences-header">
          <h2 id="preferences-title">外观</h2>
          <button type="button" class="preferences-close quiet" aria-label="关闭全局设置" title="关闭（Esc）" autofocus>${icon('x', 18)}</button>
        </header>
        <div class="preferences-content" data-page-panel="appearance">
          <fieldset class="appearance-section">
            <legend>外观模式</legend>
            <div class="appearance-modes">
              ${appearanceModes.map(mode => `
                <label class="appearance-choice">
                  <input class="sr-only" type="radio" name="appearance-mode" value="${mode.id}">
                  <span class="appearance-preview" data-mode="${mode.id}" aria-hidden="true">
                    <span class="mini-titlebar"><i></i><i></i><i></i></span>
                    <span class="mini-sidebar"><i></i><i></i><i></i></span>
                    <span class="mini-content"><i></i><i></i><i></i></span>
                  </span>
                  <span class="appearance-choice-label">${mode.name}<span class="appearance-check" aria-hidden="true">${icon('check', 10, { strokeWidth: 3 })}</span></span>
                </label>`).join('')}
            </div>
          </fieldset>
          <fieldset class="appearance-section accent-section">
            <legend>主题色</legend>
            <div class="accent-options">
              ${ACCENT_COLORS.map(accent => `
                <label class="accent-choice" title="${accent.name} · ${accent.color.toUpperCase()}">
                  <input class="sr-only" type="radio" name="appearance-accent" value="${accent.id}" aria-label="${accent.name}">
                  <span class="accent-swatch" style="--swatch:${accent.color};--swatch-ink:${accentPalette(accent.color, 'dark').ink}" aria-hidden="true"><span>${icon('check', 14, { strokeWidth: 2.8 })}</span></span>
                  <span class="accent-name">${accent.name}</span>
                </label>`).join('')}
            </div>
            <div class="accent-detail"><span>当前主题色</span><output data-current-accent></output></div>
          </fieldset>
        </div>
        <div class="preferences-content about-page" data-page-panel="about" hidden>
          <div class="about-hero">
            <img src="/pwa/icon-192.png" alt="" width="64" height="64">
            <div>
              <strong>sukushow</strong>
              <span>谱面放映室</span>
              <p>在浏览器中预览 LLLL 原格式谱面，提供 LLLL 舞台（3D/2D）与 PJSK 渲染两种模式，并导出视频。</p>
            </div>
          </div>
          <dl class="about-facts">
            <div><dt>构建版本</dt><dd data-build-version>${formatVersion(APP_VERSION, BUILD_COMMIT)}</dd></div>
            <div><dt>构建时间</dt><dd data-build-time>${formatBuildTime(BUILD_TIME)}</dd></div>
          </dl>
          <div class="about-legal">
            <p>自有代码以 MIT 许可发布；包含 PJSK 预览的构建整体按 AGPL-3.0-only 分发。</p>
            <p>游戏贴图、音效、语音与字体版权归原权利人所有，仅供本地预览与研究。</p>
          </div>
        </div>
        <footer class="preferences-footer" data-page-footer="appearance">
          <span data-appearance-status role="status">更改即时生效，自动保存。</span>
          <button type="button" class="text-button" data-appearance-reset>恢复默认</button>
        </footer>
        <footer class="preferences-footer" data-page-footer="about" hidden>
          <span>© ${new Date().getFullYear()} 白影White</span>
          <a class="about-github" href="${SOURCE_URL}" target="_blank" rel="noreferrer" aria-label="在 GitHub 查看源代码（AGPL-3.0-only）" title="在 GitHub 查看源代码（AGPL-3.0-only）">${githubIcon}</a>
        </footer>
      </section>
    </div>`
  document.body.append(dialog)

  const title = dialog.querySelector<HTMLHeadingElement>('#preferences-title')!
  const panels = [...dialog.querySelectorAll<HTMLElement>('[data-page-panel]')]
  const footers = [...dialog.querySelectorAll<HTMLElement>('[data-page-footer]')]
  const navItems = [...dialog.querySelectorAll<HTMLButtonElement>('[data-page]')]
  type PageId = 'appearance' | 'about'
  const pageTitles: Record<PageId, string> = { appearance: '外观', about: '关于' }

  function showPage(page: PageId) {
    title.textContent = pageTitles[page]
    for (const panel of panels) panel.hidden = panel.dataset.pagePanel !== page
    for (const footer of footers) footer.hidden = footer.dataset.pageFooter !== page
    for (const item of navItems) {
      if (item.dataset.page === page) item.setAttribute('aria-current', 'page')
      else item.removeAttribute('aria-current')
    }
  }
  for (const item of navItems) item.onclick = () => showPage(item.dataset.page as PageId)

  const modes = [...dialog.querySelectorAll<HTMLInputElement>('[name="appearance-mode"]')]
  const accents = [...dialog.querySelectorAll<HTMLInputElement>('[name="appearance-accent"]')]
  const current = dialog.querySelector<HTMLOutputElement>('[data-current-accent]')!
  const status = dialog.querySelector<HTMLElement>('[data-appearance-status]')!

  function sync() {
    const settings = appearance.settings
    for (const input of modes) input.checked = input.value === settings.mode
    for (const input of accents) input.checked = input.value === settings.accent
    const accent = ACCENT_COLORS.find(item => item.id === settings.accent)!
    current.textContent = `${accent.name} · ${accent.color.toUpperCase()}`
    status.textContent = appearance.persisted ? '更改即时生效，自动保存。' : '已应用；浏览器暂时无法保存设置。'
    status.classList.toggle('is-error', !appearance.persisted)
  }
  appearance.subscribe(sync)
  sync()
  for (const input of modes) input.onchange = () => appearance.set({ mode: input.value as AppearanceMode })
  for (const input of accents) input.onchange = () => appearance.set({ accent: input.value as AccentId })
  const resetButton = dialog.querySelector<HTMLButtonElement>('[data-appearance-reset]')!
  const closeButton = dialog.querySelector<HTMLButtonElement>('.preferences-close')!
  resetButton.onclick = () => appearance.set(DEFAULT_APPEARANCE)
  closeButton.onclick = () => dialog.close()

  let returnFocus: HTMLElement = trigger
  function open() {
    if (dialog.open || document.querySelector('dialog[open]')) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger
    dialog.showModal()
    trigger.setAttribute('aria-expanded', 'true')
  }
  trigger.onclick = open
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false')
    if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
  })
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
  })
  // Keep Tab within the visible page, including browsers that otherwise focus their chrome.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key !== 'Tab') return
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  document.addEventListener('keydown', event => {
    if (event.key !== ',' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    open()
  })
}
