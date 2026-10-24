/**
 * 零长 hold 段（holds[^1] == just，链中的横向瞬移点）转成 MusicScore 后的节点形态。
 *
 * 判定航点重采样（GetHolds）与串链（IsCombine）的 float32 口径由
 * `@sukushow/chart` 的测试覆盖（packages/chart/tests/holds.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import { parseChart } from '@sukushow/chart/chart'
import { chartToMusicScore } from '../src/llll/toMusicScore'

function flags(type: number, l: number, r: number, l2 = 0, r2 = 0): number {
  return (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22)
}

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
