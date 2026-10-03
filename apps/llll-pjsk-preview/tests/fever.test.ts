import { describe, expect, it } from 'vitest'
import { feverForSong, feverChanceForSong, isFeverAt } from '../src/llll/fever'

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

  it('只含 start/end，不泄漏 chance 字段', () => {
    const window = feverForSong('103101')!
    expect(Object.keys(window).sort()).toEqual(['end', 'start'])
  })
})

describe('feverChanceForSong', () => {
  it('chance 段紧邻 Fever 起点（chance.end === fever.start）', () => {
    const fever = feverForSong('103101')!
    const chance = feverChanceForSong('103101')!
    expect(chance).not.toBeNull()
    // 代理口径的硬契约：前一段的终点就是 Fever 的起点。
    expect(chance.end).toBe(fever.start)
    expect(chance.start).toBeLessThan(chance.end)
  })

  it('未知曲目返回 null，不估算', () => {
    expect(feverChanceForSong('999999')).toBeNull()
    expect(feverChanceForSong(null)).toBeNull()
    expect(feverChanceForSong(undefined)).toBeNull()
  })

  it('返回副本，调用方改动不污染索引', () => {
    const first = feverChanceForSong('103101')!
    first.start = -123
    expect(feverChanceForSong('103101')!.start).toBeGreaterThan(0)
  })

  it('全量曲目的 chance 都紧邻 Fever 且时长为正', async () => {
    const songList = Object.keys(
      (await import('../src/llll/feverMetadata.json')).default,
    )
    let checked = 0
    for (const id of songList) {
      const chance = feverChanceForSong(id)
      if (!chance) continue
      const fever = feverForSong(id)!
      expect(chance.end).toBe(fever.start)
      expect(chance.start).toBeLessThan(chance.end)
      checked += 1
    }
    expect(checked).toBeGreaterThan(200)
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

