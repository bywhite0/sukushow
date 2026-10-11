import { describe, expect, it } from 'vitest'
import { feverChargeStart } from '../src/lib/feverCharge'

describe('FeverChance 充能起点', () => {
  it('取跨过 70% 的音符时间，而不是第一次渲染的时间', () => {
    expect(feverChargeStart([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(7)
    expect(feverChargeStart([1, 2, 3])).toBe(3)
  })
  it('空谱面没有充能窗口', () => {
    expect(feverChargeStart([])).toBe(-1)
  })
  it('保留负时间、重叠音符和单音符的实际起点', () => {
    expect(feverChargeStart([-2])).toBe(-2)
    expect(feverChargeStart([2, 2, 2])).toBe(2)
  })
})
