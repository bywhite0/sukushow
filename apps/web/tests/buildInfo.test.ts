import { describe, expect, it } from 'vitest'
import { formatBuildTime, formatVersion } from '../src/buildInfo'

describe('build metadata', () => {
  it('labels an unbuilt development server', () => {
    expect(formatBuildTime('')).toBe('开发模式')
  })

  it('appends the commit to the version when one is available', () => {
    expect(formatVersion('0.1.0', '4a4848c')).toBe('v0.1.0 · 4a4848c')
    expect(formatVersion('0.1.0', '')).toBe('v0.1.0')
  })

  it('shows the build timestamp in local time', () => {
    expect(formatBuildTime(new Date(2026, 9, 19, 14, 5).toISOString())).toBe('2026-10-19 14:05')
  })

  it('keeps an unreadable timestamp visible', () => {
    expect(formatBuildTime('not-a-date')).toBe('not-a-date')
  })
})
