import { describe, expect, it } from 'vitest'
import { feverForSong, isFeverAt } from '../src/llll/fever'

describe('feverForSong', () => {
  it('返回已收录曲目的时段', () => {
    const window = feverForSong('103101')
    expect(window).not.toBeNull()
    expect(window!.end).toBeGreaterThan(window!.start)
  })

  it('未知曲目返回 null，不估算', () => {
    expect(feverForSong('999999')).toBeNull()
    expect(feverForSong(null)).toBeNull()
    expect(feverForSong(undefined)).toBeNull()
  })

  it('返回副本，调用方改动不污染索引', () => {
    const first = feverForSong('103101')!
    first.start = -123
    expect(feverForSong('103101')!.start).toBeGreaterThan(0)
  })
})

describe('isFeverAt', () => {
  const window = { start: 10, end: 20 }

  it('区间为 [start, end)', () => {
    expect(isFeverAt(9.999, window)).toBe(false)
    expect(isFeverAt(10, window)).toBe(true)
    expect(isFeverAt(19.999, window)).toBe(true)
    expect(isFeverAt(20, window)).toBe(false)
  })

  it('无窗口恒为 false', () => {
    expect(isFeverAt(15, null)).toBe(false)
  })
})
