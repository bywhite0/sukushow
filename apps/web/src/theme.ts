export const APPEARANCE_STORAGE_KEY = 'sukushow:appearance:v1'

export const ACCENT_COLORS = [
  { id: 'default', name: '默认粉', color: '#e8a3b8' },
  { id: 'sachi', name: '沙知', color: '#77805e' },
  { id: 'kozue', name: '梢', color: '#68be8d' },
  { id: 'tsuzuri', name: '缀理', color: '#ba2636' },
  { id: 'megumi', name: '慈', color: '#c8c2c6' },
  { id: 'kaho', name: '花帆', color: '#f8b500' },
  { id: 'sayaka', name: '沙耶香', color: '#5383c3' },
  { id: 'rurino', name: '瑠璃乃', color: '#e7609e' },
  { id: 'ginko', name: '吟子', color: '#a2d7dd' },
  { id: 'kosuzu', name: '小铃', color: '#fad764' },
  { id: 'hime', name: '姬芽', color: '#9d8de2' },
  { id: 'izumi', name: '泉', color: '#1ebecd' },
  { id: 'ceras', name: '塞拉斯', color: '#f56455' },
] as const

export type AccentId = typeof ACCENT_COLORS[number]['id']
export type AppearanceMode = 'light' | 'dark' | 'system'
export type AppearanceSettings = { mode: AppearanceMode; accent: AccentId }
export const DEFAULT_APPEARANCE: Readonly<AppearanceSettings> = { mode: 'dark', accent: 'default' }

export function parseAppearance(raw: string | null): AppearanceSettings {
  let value: unknown
  try { value = raw ? JSON.parse(raw) : null } catch { return { ...DEFAULT_APPEARANCE } }
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE }
  const { mode, accent } = value as Record<string, unknown>
  return {
    mode: mode === 'light' || mode === 'dark' || mode === 'system' ? mode : DEFAULT_APPEARANCE.mode,
    accent: ACCENT_COLORS.some(item => item.id === accent) ? accent as AccentId : DEFAULT_APPEARANCE.accent,
  }
}

const rgb = (hex: string) => [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16))
function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(value => {
    const channel = value / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return .2126 * r + .7152 * g + .0722 * b
}
function contrast(a: string, b: string) {
  const l1 = luminance(a), l2 = luminance(b)
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)
}
function mix(color: string, target: string, amount: number) {
  const end = rgb(target)
  return '#' + rgb(color).map((value, index) => Math.round(value + (end[index] - value) * amount).toString(16).padStart(2, '0')).join('')
}

/** Keep the member's exact fill; adjust only foregrounds for readable UI text. */
export function accentPalette(color: string, mode: 'light' | 'dark') {
  const darkInk = '#111014', lightInk = '#fdfcfe'
  const ink = contrast(color, darkInk) >= contrast(color, lightInk) ? darkInk : lightInk
  // These are the strongest neutral surfaces in theme.css.
  const surface = mode === 'light' ? '#eae8ee' : '#343039'
  const target = mode === 'light' ? darkInk : lightInk
  let text = color
  for (let step = 1; contrast(text, surface) < 4.5 && step <= 100; step++) {
    text = mix(color, target, step / 100)
  }
  return { ink, text, hover: mix(color, ink === darkInk ? lightInk : darkInk, .1) }
}

export function initAppearance() {
  let settings = { ...DEFAULT_APPEARANCE }
  try { settings = parseAppearance(localStorage.getItem(APPEARANCE_STORAGE_KEY)) } catch { /* The current session still supports themes without storage. */ }
  let persisted = true
  const system = matchMedia('(prefers-color-scheme: dark)')
  const listeners = new Set<() => void>()

  function apply() {
    const mode = settings.mode === 'system' ? system.matches ? 'dark' : 'light' : settings.mode
    const accent = ACCENT_COLORS.find(item => item.id === settings.accent)!
    const palette = accentPalette(accent.color, mode)
    const root = document.documentElement
    root.dataset.theme = mode
    root.dataset.accent = accent.id
    root.style.setProperty('--shell-accent', accent.color)
    root.style.setProperty('--shell-accent-text', palette.text)
    root.style.setProperty('--shell-accent-hover', palette.hover)
    root.style.setProperty('--shell-ink', palette.ink)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f6f5f7' : '#141416')
    for (const listener of listeners) listener()
  }

  apply()
  system.addEventListener('change', () => { if (settings.mode === 'system') apply() })
  window.addEventListener('storage', event => {
    if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return
    settings = parseAppearance(event.newValue)
    persisted = true
    apply()
  })

  return {
    get settings() { return { ...settings } },
    get persisted() { return persisted },
    set(patch: Partial<AppearanceSettings>) {
      settings = { ...settings, ...patch }
      try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings))
        persisted = true
      } catch { persisted = false }
      apply()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type AppearanceController = ReturnType<typeof initAppearance>
