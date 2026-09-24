/**
 * llll → MusicScoreMakerData 适配层测试。
 *
 * 重点验证「不压缩坐标」这一核心决策：llll 的 0–59 轨道必须原样出现在
 * laneStart/laneEnd 里，而不是被压到 0–11。
 */
import { describe, expect, it } from 'vitest'
import { parseChart } from '../src/llll/chart'
import { chartToMusicScore, isLlllNativeChart, TICKS_PER_BEAT } from '../src/llll/toMusicScore'

/** 按 llll Flags 位域拼一个音符：type 4bit / r 6bit / r2 6bit / l 6bit / l2 6bit。 */
function flags(type: number, l: number, r: number, l2 = 0, r2 = 0): number {
  return (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22)
}

function makeChart(notes: unknown[], bpms: unknown[] = [{ Time: 0, Bpm: 120 }]) {
  return parseChart({ Notes: notes, Bpms: bpms })
}

describe('llll 原生谱面识别', () => {
  it('认得 {Notes, Bpms} 结构', () => {
    expect(isLlllNativeChart({ Notes: [], Bpms: [] })).toBe(true)
    expect(isLlllNativeChart({ NoteList: [] })).toBe(false)
    expect(isLlllNativeChart(null)).toBe(false)
  })
})

describe('轨道坐标不压缩（本项目核心决策）', () => {
  it('60 轨全域坐标原样保留', () => {
    // l=0 r=59 是 60 轨谱面的最宽音符，l=59 是最后一轨。
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 59) },
      { Uid: 2, just: '2.0', holds: [], Flags: flags(0, 59, 59) },
      { Uid: 3, just: '3.0', holds: [], Flags: flags(0, 30, 30) },
    ])
    const score = chartToMusicScore(chart)
    const sorted = [...score.NoteList].sort((a, b) => a.ticks - b.ticks)

    // 1 秒 @120bpm = 2 拍 = 960 ticks
    expect(sorted[0].laneStart).toBe(0)
    expect(sorted[0].laneEnd).toBe(59)

    expect(sorted[1].laneStart).toBe(59)
    expect(sorted[1].laneEnd).toBe(59)

    expect(sorted[2].laneStart).toBe(30)
    expect(sorted[2].laneEnd).toBe(30)
  })

  it('轨道号不会被压到 0–11 区间', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 20, 40) },
    ])
    const score = chartToMusicScore(chart)
    // 若误用 llll-chart2sus 的 (l/59)*12 压缩，这里会变成 4 和 8。
    expect(score.NoteList[0].laneStart).toBe(20)
    expect(score.NoteList[0].laneEnd).toBe(40)
    expect(score.NoteList[0].laneStart).not.toBe(Math.floor((20 / 59) * 12))
  })
})

describe('音符种类映射', () => {
  it('Single / Flick / Trace 映射到 custom_score_json.h 可识别的谓词', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 1) },
      { Uid: 2, just: '2.0', holds: [], Flags: flags(2, 2, 3) },
      { Uid: 3, just: '3.0', holds: [], Flags: flags(3, 4, 5) },
    ])
    const score = chartToMusicScore(chart)
    const sorted = [...score.NoteList].sort((a, b) => a.ticks - b.ticks)

    // SINGLE → (0,1)：既非 flick 也非 trace
    expect(sorted[0].category).toBe(0)
    expect(sorted[0].noteBaseType).toBe(1)

    // FLICK → (3,3)：命中 isFlickNote（base==3）
    expect(sorted[1].category).toBe(3)
    expect(sorted[1].noteBaseType).toBe(3)

    // TRACE → (4,11)：命中 isTraceNote（base==11）
    expect(sorted[2].category).toBe(4)
    expect(sorted[2].noteBaseType).toBe(11)
  })
})

describe('Hold 串链', () => {
  it('单段 Hold 产出首尾两个节点并互连', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 12, 20, 22) },
    ])
    const score = chartToMusicScore(chart)
    const holds = score.NoteList.filter((n) => !n.IsSingle)
    expect(holds).toHaveLength(2)

    const [head, tail] = holds.sort((a, b) => a.ticks - b.ticks)
    expect(head.IsConnectedFirst).toBe(true)
    expect(head.IsConnectedLast).toBe(false)
    expect(head.nextConnectionId).toBe(tail.id)
    expect(head.previousConnectionId).toBe(-1)
    // 首节点用 (1,2)，尾节点用 (1,1)
    expect([head.category, head.noteBaseType]).toEqual([1, 2])
    expect([tail.category, tail.noteBaseType]).toEqual([1, 1])
    expect(tail.previousConnectionId).toBe(head.id)
    expect(tail.nextConnectionId).toBe(-1)

    // 端点坐标：头 l/r、尾 l2/r2，均不压缩
    expect([head.laneStart, head.laneEnd]).toEqual([10, 12])
    expect([tail.laneStart, tail.laneEnd]).toEqual([20, 22])
  })

  it('多段 Hold 中段是 relay 节点 (13,6)', () => {
    // 链：Uid1 (10..12 → 20..22) 接 Uid2 (20..22 → 30..32)
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 12, 20, 22) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 20, 22, 30, 32) },
    ])
    const score = chartToMusicScore(chart)
    const holds = score.NoteList.filter((n) => !n.IsSingle).sort((a, b) => a.ticks - b.ticks)
    expect(holds).toHaveLength(3)
    expect([holds[1].category, holds[1].noteBaseType]).toEqual([13, 6])
    expect(holds[1].IsConnectedFirst).toBe(false)
    expect(holds[1].IsConnectedLast).toBe(false)
  })
})

describe('BPM 与 tick 换算', () => {
  it('单 BPM 下 1 秒 = 2 拍 = 960 ticks（120 BPM）', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 1) },
    ])
    const score = chartToMusicScore(chart)
    expect(score.NoteList[0].ticks).toBe(2 * TICKS_PER_BEAT)
  })

  it('BPM 变化按分段积分', () => {
    // 0–1s @120bpm（2 拍），1s 起 @240bpm（1s = 4 拍）
    const chart = makeChart(
      [{ Uid: 1, just: '2.0', holds: [], Flags: flags(0, 0, 1) }],
      [{ Time: 0, Bpm: 120 }, { Time: 1, Bpm: 240 }],
    )
    const score = chartToMusicScore(chart)
    // 2 拍 + 4 拍 = 6 拍
    expect(score.NoteList[0].ticks).toBe(6 * TICKS_PER_BEAT)
  })

  it('头部固定事件齐全（BPM / 拍号 / HiSpeed / SE）', () => {
    const chart = makeChart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 1) }])
    const score = chartToMusicScore(chart)
    const types = new Set(score.MusicScoreEventDataList.map((e) => e.eventType))
    expect(types.has(0)).toBe(true) // BPM
    expect(types.has(1)).toBe(true) // HiSpeed
    expect(types.has(2)).toBe(true) // SE 音量
    expect(types.has(3)).toBe(true) // 拍号
  })
})

describe('空谱与边界', () => {
  it('空谱不抛错且 ticksMax 为 0', () => {
    const chart = makeChart([])
    const score = chartToMusicScore(chart)
    expect(score.NoteList).toHaveLength(0)
    expect(score.MusicScoreTicksMax).toBe(0)
  })

  it('轨道 0 与 59 两端都能表达', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 0) },
      { Uid: 2, just: '2.0', holds: [], Flags: flags(0, 59, 59) },
    ])
    const score = chartToMusicScore(chart)
    const lanes = score.NoteList.map((n) => n.laneStart).sort((a, b) => a - b)
    expect(lanes).toEqual([0, 59])
  })
})

describe('Hold 串链容差（原版 float32 域）', () => {
  it('亚容差浮点对必须连上（double 域会漏连）', () => {
    // holds[^1]=101.8751 vs just=101.875：
    //   double  域 |Δ| = 1.0000000033e-4 ≥ 1e-4        ⇒ 不连（旧行为）
    //   float32 域 |Δ| = 9.9182e-5 < 0.0001f = 9.9999997e-5 ⇒ 连（原版行为）
    // 全语料 129 处此类漏连。
    const chart = makeChart([
      { Uid: 1, just: '100.0', holds: ['101.8751'], Flags: flags(1, 20, 28, 20, 28) },
      { Uid: 2, just: '101.875', holds: ['102.5'], Flags: flags(1, 20, 28, 20, 28) },
    ])
    // 连上后是一条 2 段链：Uid1 的尾就是 Uid2 的头，故 Uid2 不是根。
    expect(chart.roots.map((n) => n.uid)).toEqual([1])
    expect(chart.roots[0].next?.uid).toBe(2)
  })

  it('超出容差的浮点对不得连上', () => {
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: ['1.995'], Flags: flags(1, 20, 28, 20, 28) },
      { Uid: 2, just: '2.0', holds: ['2.4'], Flags: flags(1, 20, 28, 20, 28) },
    ])
    expect(chart.roots.map((n) => n.uid)).toEqual([1, 2])
    expect(chart.roots[0].next).toBeUndefined()
  })

  it('允许汇合：一个节点可被多条前驱指向', () => {
    // 原版对每个 unit 独立求 FirstOrDefault，目标不被独占。
    const chart = makeChart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 20, 28, 20, 28) },
      { Uid: 2, just: '1.2', holds: ['2.0'], Flags: flags(1, 6, 14, 20, 28) },
      { Uid: 3, just: '2.0', holds: ['2.4'], Flags: flags(1, 20, 28, 20, 28) },
    ])
    const byUid = new Map(chart.notes.map((n) => [n.uid, n]))
    expect(byUid.get(1)!.next?.uid).toBe(3)
    expect(byUid.get(2)!.next?.uid).toBe(3)
    // 目标被指到即非根；两条前驱各自是根。
    expect(chart.roots.map((n) => n.uid).sort()).toEqual([1, 2])
  })
})

describe('Hold 亚 tick 折叠', () => {
  it('相邻链成员落在同 tick 时折叠，不产生零长度段', () => {
    // collectHoldPoints 逐链成员取 cursor.end（该 unit 的 holds 末项）：
    //   uid1 (just 1.0,  end 1.0005) → uid2 (just 1.0005, end 1.001) → uid3 (just 1.001, end 1.5)
    // BPM 60 下 1 tick = 1/480 ≈ 0.00208 s，故 1.0 / 1.0005 / 1.001 全部同 tick（480）。
    // 不折叠会产生 3 个同 tick 节点；折叠后只留最后航点，再接 1.5（tick 720）。
    const chart = makeChart(
      [
        { Uid: 1, just: '1.0', holds: ['1.0005'], Flags: flags(1, 10, 12, 20, 22) },
        { Uid: 2, just: '1.0005', holds: ['1.001'], Flags: flags(1, 20, 22, 30, 32) },
        { Uid: 3, just: '1.001', holds: ['1.5'], Flags: flags(1, 30, 32, 40, 42) },
      ],
      [{ Time: 0, Bpm: 60 }],
    )
    const score = chartToMusicScore(chart)
    const holds = score.NoteList.filter((n) => !n.IsSingle).sort((a, b) => a.ticks - b.ticks)

    // 前两个航点同 tick 折叠 → 节点数从 4 降到 2
    expect(holds).toHaveLength(2)
    expect(holds.map((n) => n.ticks)).toEqual([480, 720])

    const [head, tail] = holds
    expect(head.IsConnectedFirst).toBe(true)
    expect(head.IsConnectedLast).toBe(false)
    expect(tail.IsConnectedFirst).toBe(false)
    expect(tail.IsConnectedLast).toBe(true)
    expect(head.nextConnectionId).toBe(tail.id)
    expect(tail.previousConnectionId).toBe(head.id)
  })

  it('折叠后链上节点 tick 严格递增', () => {
    const chart = makeChart(
      [
        { Uid: 1, just: '1.0', holds: ['1.0002'], Flags: flags(1, 10, 12, 20, 22) },
        { Uid: 2, just: '1.0002', holds: ['1.0004'], Flags: flags(1, 20, 22, 30, 32) },
        { Uid: 3, just: '1.0004', holds: ['1.0006'], Flags: flags(1, 30, 32, 40, 42) },
        { Uid: 4, just: '1.0006', holds: ['1.5'], Flags: flags(1, 40, 42, 50, 52) },
      ],
      [{ Time: 0, Bpm: 60 }],
    )
    const score = chartToMusicScore(chart)
    const byId = new Map(score.NoteList.map((n) => [n.id, n]))
    const head = score.NoteList.find((n) => n.IsConnectedFirst)!
    let cursor = head
    let guard = 0
    while (cursor.nextConnectionId !== -1 && guard++ < 1000) {
      const next = byId.get(cursor.nextConnectionId)!
      expect(next.ticks).toBeGreaterThan(cursor.ticks)
      cursor = next
    }
  })
})


describe('Hold 链首不可被折叠覆盖', () => {
  it('链首与次航点同 tick 时，保留链首位置并丢弃次航点', () => {
    // 源谱面存在「链首与紧随的航点落在同一 tick」的情形
    // （实测 304202_04 / 405304_04 共 7 处）。
    // 链首是玩家点击的位置（l1/r1），若被后一个航点顶掉，长条起点会整体漂移。
    // BPM 60 下 1 tick = 1/480 s ≈ 0.00208 s，故 1.0 与 1.0005 同 tick。
    const chart = makeChart(
      [
        // 链首 lane 0-11，end 1.0005（同 tick）；次成员 lane 4-15
        { Uid: 1, just: '1.0', holds: ['1.0005'], Flags: flags(1, 0, 11, 4, 15) },
        { Uid: 2, just: '1.0005', holds: ['1.5'], Flags: flags(1, 4, 15, 8, 19) },
      ],
      [{ Time: 0, Bpm: 60 }],
    )
    const score = chartToMusicScore(chart)
    const head = score.NoteList.find((n) => n.IsConnectedFirst)!

    // 链首必须仍是 0-11（点击位置），不能被换成 4-15
    expect([head.laneStart, head.laneEnd]).toEqual([0, 11])
    expect(head.ticks).toBe(480)
    expect(head.category).toBe(1)
    expect(head.noteBaseType).toBe(2)

    // 链上节点 tick 严格递增（无同 tick 孪生）
    const byId = new Map(score.NoteList.map((n) => [n.id, n]))
    let cursor = head
    let guard = 0
    while (cursor.nextConnectionId !== -1 && guard++ < 1000) {
      const next = byId.get(cursor.nextConnectionId)!
      expect(next.ticks).toBeGreaterThan(cursor.ticks)
      cursor = next
    }
    // 链尾应落在最后一个真实航点
    expect(cursor.IsConnectedLast).toBe(true)
  })

  it('链首未被折叠时位置也不变（对照组）', () => {
    // 链首与次航点不同 tick：链首照常保留
    const chart = makeChart(
      [
        { Uid: 1, just: '1.0', holds: ['1.1'], Flags: flags(1, 20, 28, 22, 30) },
        { Uid: 2, just: '1.1', holds: ['1.5'], Flags: flags(1, 22, 30, 24, 32) },
      ],
      [{ Time: 0, Bpm: 60 }],
    )
    const score = chartToMusicScore(chart)
    const head = score.NoteList.find((n) => n.IsConnectedFirst)!
    expect([head.laneStart, head.laneEnd]).toEqual([20, 28])
  })
})
