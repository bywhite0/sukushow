/**
 * 用真实 llll 原生谱面跑适配层，核对：
 *   1. 不抛错、音符数与源一致（Hold 展开成多节点属预期）
 *   2. 轨道坐标全程落在 0–59（未被压缩）
 *   3. 产出能被 native 侧 custom_score_json.h 的谓词正确分类
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChart } from '../src/llll/chart'
import { chartToMusicScore } from '../src/llll/toMusicScore'

// 真实谱面属游戏资源、不进版本库；用 LLL_REAL_CHART 指向样本，未设置时整组跳过。
const SAMPLE = process.env.LLL_REAL_CHART ?? ''

function loadSample() {
  return JSON.parse(readFileSync(SAMPLE, 'utf8'))
}

describe.skipIf(!SAMPLE)('真实 llll 谱面（203115_04，3088 音符）', () => {
  it('转换成功且坐标全程不越界', () => {
    const raw = loadSample()
    const chart = parseChart(raw)
    expect(chart.notes.length).toBe(3088)

    const score = chartToMusicScore(chart)
    expect(score.NoteList.length).toBeGreaterThan(0)

    for (const note of score.NoteList) {
      expect(note.laneStart).toBeGreaterThanOrEqual(0)
      expect(note.laneEnd).toBeLessThanOrEqual(59)
      expect(note.laneStart).toBeLessThanOrEqual(note.laneEnd)
      expect(Number.isInteger(note.laneStart)).toBe(true)
      expect(Number.isInteger(note.laneEnd)).toBe(true)
    }
  })

  it('轨道用到 0–59 全域（证明没被压到 12 轨）', () => {
    const chart = parseChart(loadSample())
    const score = chartToMusicScore(chart)
    const maxLane = Math.max(...score.NoteList.map((n) => n.laneEnd))
    const minLane = Math.min(...score.NoteList.map((n) => n.laneStart))
    expect(minLane).toBeGreaterThanOrEqual(0)
    // 压缩到 12 轨时 maxLaneEnd 最多 11；这条谱面用到 50+。
    expect(maxLane).toBeGreaterThan(11)
  })

  it('Hold 链的 previous/next 互连闭合', () => {
    const chart = parseChart(loadSample())
    const score = chartToMusicScore(chart)
    const byId = new Map(score.NoteList.map((n) => [n.id, n]))

    for (const note of score.NoteList) {
      if (note.nextConnectionId !== -1) {
        const next = byId.get(note.nextConnectionId)
        expect(next, `note ${note.id} 的 next 指向不存在的 ${note.nextConnectionId}`).toBeDefined()
        expect(next!.previousConnectionId).toBe(note.id)
      }
      if (note.previousConnectionId !== -1) {
        const prev = byId.get(note.previousConnectionId)
        expect(prev, `note ${note.id} 的 prev 指向不存在的 ${note.previousConnectionId}`).toBeDefined()
        expect(prev!.nextConnectionId).toBe(note.id)
      }
    }
  })

  it('Hold 链节点时间严格递增（无量化重叠）', () => {
    const chart = parseChart(loadSample())
    const score = chartToMusicScore(chart)
    const byId = new Map(score.NoteList.map((n) => [n.id, n]))

    for (const note of score.NoteList) {
      if (note.IsConnectedFirst) {
        let cursor = note
        let guard = 0
        while (cursor.nextConnectionId !== -1 && guard++ < 4096) {
          const next = byId.get(cursor.nextConnectionId)!
          expect(next.ticks, `Hold 链在 id=${cursor.id}→${next.id} 处未递增`).toBeGreaterThan(cursor.ticks)
          cursor = next
        }
      }
    }
  })

  it('事件表包含 BPM 且 ticks 非负', () => {
    const chart = parseChart(loadSample())
    const score = chartToMusicScore(chart)
    const bpmEvents = score.MusicScoreEventDataList.filter((e) => e.eventType === 0)
    expect(bpmEvents.length).toBeGreaterThan(0)
    expect(bpmEvents[0].changeValue).toBeCloseTo(76, 5) // 源谱 Bpms[0].Bpm = 76
    for (const event of score.MusicScoreEventDataList) {
      expect(event.ticks).toBeGreaterThanOrEqual(0)
    }
  })
})
