import './globalSettings.css'
import { ACCENT_COLORS, DEFAULT_APPEARANCE, accentPalette, type AppearanceController, type AppearanceMode, type AccentId } from './theme'

const appearanceModes = [
  { id: 'light', name: '浅色' },
  { id: 'dark', name: '深色' },
  { id: 'system', name: '跟随系统' },
] as const

const appearanceIcon = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2.5" y="2.5" width="15" height="15" rx="4"/><path d="M10 2.5v15"/><path d="M10 3h3.5A3.5 3.5 0 0 1 17 6.5v7a3.5 3.5 0 0 1-3.5 3.5H10Z" fill="currentColor" stroke="none"/></svg>`

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
        <div class="preferences-category" aria-current="page"><span>${appearanceIcon}</span>外观</div>
        <div class="preferences-brand"><img src="/pwa/icon-192.png" alt="" width="30" height="30"><div><strong>sukushow</strong><span>谱面放映室</span></div></div>
      </aside>
      <section class="preferences-main" aria-labelledby="appearance-title">
        <header class="preferences-header">
          <h2 id="appearance-title">外观</h2>
          <button type="button" class="preferences-close quiet" aria-label="关闭全局设置" title="关闭（Esc）" autofocus><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
        </header>
        <div class="preferences-content">
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
                  <span class="appearance-choice-label">${mode.name}<span class="appearance-check" aria-hidden="true">✓</span></span>
                </label>`).join('')}
            </div>
          </fieldset>
          <fieldset class="appearance-section accent-section">
            <legend>主题色</legend>
            <div class="accent-options">
              ${ACCENT_COLORS.map(accent => `
                <label class="accent-choice" title="${accent.name} · ${accent.color.toUpperCase()}">
                  <input class="sr-only" type="radio" name="appearance-accent" value="${accent.id}" aria-label="${accent.name}">
                  <span class="accent-swatch" style="--swatch:${accent.color};--swatch-ink:${accentPalette(accent.color, 'dark').ink}" aria-hidden="true"><span>✓</span></span>
                  <span class="accent-name">${accent.name}</span>
                </label>`).join('')}
            </div>
            <div class="accent-detail"><span>当前主题色</span><output data-current-accent></output></div>
          </fieldset>
        </div>
        <footer class="preferences-footer">
          <span data-appearance-status role="status">更改即时生效，自动保存。</span>
          <button type="button" class="text-button" data-appearance-reset>恢复默认</button>
        </footer>
      </section>
    </div>`
  document.body.append(dialog)

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
  // Keep Tab within the window, including browsers that otherwise focus their chrome.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key !== 'Tab') return
    if (event.shiftKey && document.activeElement === closeButton) {
      event.preventDefault()
      resetButton.focus()
    } else if (!event.shiftKey && document.activeElement === resetButton) {
      event.preventDefault()
      closeButton.focus()
    }
  })
  document.addEventListener('keydown', event => {
    if (event.key !== ',' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    open()
  })
}
