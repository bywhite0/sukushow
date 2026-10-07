/**
 * 判定航点重采样（GetHolds）与串链（IsCombine）按原包 float32 口径的单测，
 * 以及零长 hold 段（holds[^1] == just，链中的横向瞬移点）转成 MusicScore 后的节点形态。
 */
import { describe, expect, it } from 'vitest'
import { chartAllNoteSize, getHolds, parseChart } from '@sukushow/chart/chart'
import { chartToMusicScore } from '../src/llll/toMusicScore'

function flags(type: number, l: number, r: number, l2 = 0, r2 = 0): number {
  return (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22)
}

describe('getHolds（RhythmGameConsts.GetHolds @0x485D11C，float32）', () => {
  it('尾裁剪按 (long)(|end − last| × 10000f) <= 1 截断，即 |Δ| < 2e-4', () => {
    // 103108 MASTER uid 556 链：49.70587 → 50.29421 @ 102 BPM（主数据 MaxCombo 947）。
    // 半拍采样 50.0000、50.29410…；|50.29421 − 50.29410| ≈ 1.05e-4 截断为 1 → 删掉。旧实现保留（+1）。
    const h = getHolds(49.70587, 50.29421, [{ time: 0, bpm: 102 }])
    expect(h).toHaveLength(2)
    expect(h[1]).toBe(Math.fround(50.29421))
  })

  it('跨 BPM 急变段按 float32 累加半拍（double 累加会分岔）', () => {
    // 405138 MASTER uid 1006 链：84 → 85.89473，途经 38→190→380→760→1140 BPM（主数据 MaxCombo 1142）。
    // double 累加得 24 点，float32 得 26 点。
    const bpms = [
      { time: 0, bpm: 190 }, { time: 84, bpm: 38 }, { time: 84.63158416748047, bpm: 190 },
      { time: 84.94737243652344, bpm: 380 }, { time: 85.2631607055664, bpm: 760 },
      { time: 85.57894897460938, bpm: 1140 }, { time: 85.89473724365234, bpm: 190 },
    ]
    const h = getHolds(84, 85.89473, bpms)
    expect(h).toHaveLength(26)
    expect(h.every((x) => Math.fround(x) === x)).toBe(true)
    expect(h[h.length - 1]).toBe(Math.fround(85.89473))
  })

  it('零长 / 倒序区间只返回 [end]（循环由 start < end 守住）', () => {
    expect(getHolds(3, 3, [{ time: 0, bpm: 120 }])).toEqual([3])
  })

  it('Get(bpms, t) 早于首段时回落到最后一段', () => {
    // RhythmGameConsts.Get @0x485D410：找不到 prev.StartTime <= t < cur.StartTime 的一对即取末段。
    const bpms = [{ time: 1, bpm: 60 }, { time: 10, bpm: 240 }]
    expect(getHolds(0, 0.5, bpms)).toEqual([0.125, 0.25, 0.375, 0.5])
  })
})

describe('串链（IsCombine @0x485CFFC，单精度 LooseEquals）', () => {
  it('float32 域 |Δ| < 9.9999997e-5f 才连：101.8751 → 101.875 连上，1.0001 → 1.0 不连', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '101', holds: ['101.8751'], Flags: flags(1, 0, 9, 0, 9) },
        { Uid: 2, just: '101.875', holds: ['102'], Flags: flags(1, 0, 9, 0, 9) },
        { Uid: 3, just: '0', holds: ['1.0001'], Flags: flags(1, 20, 29, 20, 29) },
        { Uid: 4, just: '1', holds: ['2'], Flags: flags(1, 20, 29, 20, 29) },
      ],
      Bpms: [{ Time: 0, Bpm: 120 }],
    })
    const [a, b, x, y] = c.notes
    expect(a.next).toBe(b)
    expect(x.next).toBeUndefined()
    expect(y.prev).toBeUndefined()
  })
})

// 405131 EXPERT #117/#118/#120 同型：斜段 → 零长瞬移段 → 斜段；另有一条同刻起始、lane 不接的 hold。
const zeroChain = () =>
  parseChart({
    Notes: [
      { Uid: 1, just: '0', holds: ['1'], Flags: flags(1, 0, 14, 15, 29) },
      { Uid: 2, just: '1', holds: ['1'], Flags: flags(1, 15, 29, 45, 59) }, // 零长
      { Uid: 3, just: '1', holds: ['1.5'], Flags: flags(1, 0, 14, 0, 14) },
      { Uid: 4, just: '1', holds: ['2'], Flags: flags(1, 45, 59, 30, 44) },
    ],
    Bpms: [{ Time: 0, Bpm: 120 }],
  })

describe('零长 hold 段', () => {
  it('照原版不看段长，串在链里；AllNoteSize = 链头 1 + GetHolds(0, 2) 8 点 + 另一条 2', () => {
    const c = zeroChain()
    const [a, z, other, b] = c.notes
    expect(a.next).toBe(z)
    expect(z.next).toBe(b)
    expect(b.prev).toBe(z)
    expect(other.prev).toBeUndefined()
    expect(c.roots.map((n) => n.uid)).toEqual([1, 3])
    expect(chartAllNoteSize(c)).toBe(1 + 8 + 2)
  })

  it('转成 MusicScore：前一段停在它自己的尾端 lane，瞬移落在同一 tick，不会斜拉到瞬移后的 lane', () => {
    const score = chartToMusicScore(zeroChain())
    const head = score.NoteList.find((n) => n.IsConnectedFirst && n.laneStart === 0 && n.ticks === 0)!
    const byId = new Map(score.NoteList.map((n) => [n.id, n]))
    const chain = [head]
    while (chain[chain.length - 1].nextConnectionId >= 0) chain.push(byId.get(chain[chain.length - 1].nextConnectionId)!)
    expect(chain.map((n) => [n.ticks, n.laneStart, n.laneEnd])).toEqual([
      [0, 0, 14],
      [960, 15, 29], // 第 1 段终点 = 它自己的 L2/R2
      [960, 45, 59], // 零长段终点：同 tick 横向瞬移
      [1920, 30, 44],
    ])
  })
})