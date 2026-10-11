import { describe, expect, it } from 'vitest'
import { feverChargeStart, feverFlashStart, FeverChargeTimeline, chargeNotesInWindow } from '../src/lib/feverCharge'

describe('充能窗口', () => {
  it('只计算开始事件到 Fever 起点之间的音符，排除歌曲前半段', () => {
    expect(chargeNotesInWindow([0, 2, 10, 12, 19, 20, 30], { start: 10, end: 20 })).toEqual([10, 12, 19])
    expect(chargeNotesInWindow([1, 2], null)).toEqual([])
    expect(chargeNotesInWindow([1, NaN, 13, 11], { start: 10, end: 20 })).toEqual([11, 13])
  })
})

describe('充能进度逐帧平滑', () => {
  it('每帧向目标推进 30%，重复采样不额外推进', () => {
    const timeline = new FeverChargeTimeline([0]);
    expect(timeline.at(0).progress).toBeCloseTo(.3, 7);
    expect(timeline.at(1 / 60).progress).toBeCloseTo(.51, 7);
    expect(timeline.at(2 / 60).progress).toBeCloseTo(.657, 7);
    expect(timeline.at(2 / 60).progress).toBeCloseTo(.657, 7);
    expect(timeline.at(3 / 60).progress).toBeCloseTo(.7599, 7);
    expect(timeline.at(3 / 60).flashStart).toBeCloseTo(3 / 60, 7);
  });
  it('直接 seek、逐帧推进和回退得到相同进度', () => {
    const direct = new FeverChargeTimeline([0, .1, .2]);
    const sequential = new FeverChargeTimeline([0, .1, .2]);
    for (let frame = 0; frame <= 30; frame++) sequential.at(frame / 60);
    expect(direct.at(.5)).toEqual(sequential.at(.5));
    direct.at(10);
    expect(direct.at(.5)).toEqual(sequential.at(.5));
    expect(direct.at(-1).progress).toBe(0);
  });
  it('不提前计入未来音符，处理空谱面和非有限时间', () => {
    const timeline = new FeverChargeTimeline([.01]);
    expect(timeline.at(0).progress).toBe(0);
    expect(timeline.at(1 / 60).progress).toBeCloseTo(.3, 7);
    expect(new FeverChargeTimeline([]).at(100)).toEqual({ progress: 0, flashStart: null });
    expect(timeline.at(NaN)).toEqual({ progress: 0, flashStart: null });
  });
});

describe('FeverChance 充能起点', () => {
  it('取充能开始的首个音符，而不是 70% 阈值音符', () => {
    expect(feverChargeStart([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(1)
    expect(feverChargeStart([1, 2, 3])).toBe(1)
  })
  it('闪光从严格超过 Fever 阈值的音符开始，与 Chance 起点独立', () => {
    const times = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(feverFlashStart(times)).toBe(8)
    expect(feverChargeStart(times)).toBe(1)
    expect(feverFlashStart([1, 2, 3])).toBe(3)
    expect(feverFlashStart([])).toBe(null)
    expect(feverFlashStart([-2])).toBe(-2)
  })
  it('空谱面没有充能窗口', () => {
    expect(feverChargeStart([])).toBe(-1)
  })
  it('保留负时间、重叠音符和单音符的实际起点', () => {
    expect(feverChargeStart([-2])).toBe(-2)
    expect(feverChargeStart([2, 2, 2])).toBe(2)
  })
})
