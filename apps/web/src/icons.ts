import { iconBodies, type IconName } from './icons.generated'

export type { IconName }

/**
 * Lucide 图形是 24×24 网格的纯描边路径，颜色、线宽和对齐由这一层统一决定。
 *
 * `strokeWidth` 以 24 网格为单位：`size=16` 时 1.75 落到屏幕上约 1.2px，
 * 与改造前 20 网格 1.4–1.5 的观感一致。≤14px 的小图标用更大的 `strokeWidth`
 * 补偿缩放后的变细（见 `check` 的两处调用）。
 */
export type IconOptions = {
  /** 24 网格下的描边宽度；默认 1.75。 */
  strokeWidth?: number
  /** 需要给 SVG 本身挂样式时使用（如 `.picker-icon`）。 */
  className?: string
}

export function icon(name: IconName, size = 18, options: IconOptions = {}): string {
  const { strokeWidth = 1.75, className = '' } = options
  const classAttribute = className ? ` class="${className}"` : ''
  return (
    `<svg${classAttribute} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"` +
    ` stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round"` +
    ` stroke-linejoin="round" aria-hidden="true">${iconBodies[name]}</svg>`
  )
}

/** 只换图标、不动文案；展开/收起这类切换按钮用它。 */
export function setIcon(button: HTMLElement, name: IconName): void {
  const svg = button.querySelector('svg')
  if (!svg || svg.dataset.icon === name) return
  svg.dataset.icon = name
  svg.innerHTML = iconBodies[name]
}

/**
 * 播放 / 暂停这类会随状态换图标的按钮：图标与文案只在真的变化时写 DOM，
 * 因此可以安全地在逐帧渲染里调用。
 */
export function setIconButton(button: HTMLElement, name: IconName, label: string): void {
  setIcon(button, name)
  const text = button.querySelector<HTMLElement>('[data-icon-label]')
  if (text && text.textContent !== label) text.textContent = label
  if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
}
