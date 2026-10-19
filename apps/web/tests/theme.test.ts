import { describe, expect, it } from 'vitest'
import { ACCENT_COLORS, DEFAULT_APPEARANCE, accentPalette, parseAppearance } from '../src/theme'

describe('appearance preferences', () => {
  it.each([null, '', '{broken', 'null', '42', '[]'])('opens with the existing dark pink theme for invalid storage: %s', raw => {
    expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE)
  })

  it('restores an explicit appearance and member color', () => {
    expect(parseAppearance('{"mode":"light","accent":"sachi"}')).toEqual({ mode: 'light', accent: 'sachi' })
    expect(parseAppearance('{"mode":"system","accent":"ceras"}')).toEqual({ mode: 'system', accent: 'ceras' })
  })

  it('keeps valid fields when stored settings contain an unknown option', () => {
    expect(parseAppearance('{"mode":"sepia","accent":"kozue"}')).toEqual({ mode: 'dark', accent: 'kozue' })
    expect(parseAppearance('{"mode":"light","accent":"unknown"}')).toEqual({ mode: 'light', accent: 'default' })
  })
})

// WCAG relative luminance, measured against the strongest neutral UI surfaces.
function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(byte => {
      const value = parseInt(byte, 16) / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    return channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}

describe('theme readability', () => {
  it.each(ACCENT_COLORS)('$name has readable button labels and accent text in both appearances', accent => {
    for (const mode of ['light', 'dark'] as const) {
      const palette = accentPalette(accent.color, mode)
      expect(contrastRatio(palette.ink, accent.color)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.ink, palette.hover)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(palette.text, mode === 'light' ? '#eae8ee' : '#343039')).toBeGreaterThanOrEqual(4.5)
    }
  })
})
