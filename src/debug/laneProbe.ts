/**
 * 60 轨坐标验证（浏览器内执行）。
 *
 * 用途：确认 native 侧 laneToLeft 已从 `lane - 6`（12 轨）改成 `lane - 30`（60 轨），
 * 且 llll 的 0–59 坐标一路未被压缩。
 *
 * 原理：往 wasm 里塞一张「同一时刻、轨道 0 / 30 / 59 各一个音符」的谱，
 * 读 hit event 缓冲区的 center 字段。判定中心 = laneToLeft(lane) + width/2，
 * 故预期值：
 *
 *   轨道  0 → -30 + 0.5 = -29.5
 *   轨道 30 →   0 + 0.5 =  +0.5
 *   轨道 59 → +29 + 0.5 = +29.5
 *
 * 若仍是 12 轨公式（lane - 6），会得到 -5.5 / +24.5 / +53.5 —— 明显不同。
 *
 * 跑法：dev server 起来后，在浏览器控制台执行
 *   const { runLaneProbe } = await import('/src/debug/laneProbe.ts')
 *   await runLaneProbe()
 */
import { parseChart } from '../llll/chart'
import { chartToMusicScore } from '../llll/toMusicScore'

/** llll Flags 位域打包：type 4bit / r 6bit / l 6bit。 */
function flags(type: number, l: number, r: number): number {
  return (type & 15) | ((r & 63) << 4) | ((l & 63) << 16)
}

interface ProbeRuntime {
  module: {
    ccall: (name: string, ret: string | null, argTypes: string[], args: unknown[]) => number
    HEAPF32: Float32Array
  }
  loadSession: (options: unknown) => Promise<void>
}

export interface LaneProbeResult {
  ok: boolean
  lanes: [number, number][]
  centers: number[]
  expected: number[]
  verdict: string
}

export async function runLaneProbe(): Promise<LaneProbeResult> {
  const hook = (window as unknown as { __LLL_PJSK__?: { player: unknown } }).__LLL_PJSK__
  if (!hook) {
    throw new Error('缺少 window.__LLL_PJSK__ 钩子；请确认页面已启动。')
  }
  const player = hook.player as ProbeRuntime
  const module = player.module

  // 同时刻三个音符：最左轨 0、中央 30、最右轨 59。
  const chart = parseChart({
    Notes: [
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 0, 0) },
      { Uid: 2, just: '1.0', holds: [], Flags: flags(0, 30, 30) },
      { Uid: 3, just: '1.0', holds: [], Flags: flags(0, 59, 59) },
    ],
    Bpms: [{ Time: 0, Bpm: 120 }],
  })
  const score = chartToMusicScore(chart)

  await player.loadSession({
    scoreText: JSON.stringify(score),
    scoreFormat: 'custom-score-json',
    sourceOffsetMs: 0,
    effectiveLeadInMs: 2000,
    bgmBytes: null,
    coverBytes: null,
    metadata: {
      title: 'lane-probe',
      lyricist: null,
      composer: null,
      arranger: null,
      vocal: null,
      difficulty: null,
      customScoreInfo: false,
      scoreTitle: 'lane-probe',
      scoreCreator: null,
    },
  })

  const count = module.ccall('getHitEventCount', 'number', [], [])
  const ptr = module.ccall('getHitEventBufferPointer', 'number', [], [])
  const heap = module.HEAPF32
  const centers: number[] = []
  // 每条 hit event 7 个 float：[timeSec, center, width, kind, flags, endTimeSec, volume]
  for (let index = 0; index < count; index += 1) {
    centers.push(heap[ptr / 4 + index * 7 + 1])
  }
  centers.sort((a, b) => a - b)

  const expected = [-29.5, 0.5, 29.5]
  const ok =
    centers.length === expected.length && centers.every((value, index) => Math.abs(value - expected[index]) < 0.001)

  return {
    ok,
    lanes: score.NoteList.map((note) => [note.laneStart, note.laneEnd] as [number, number]),
    centers,
    expected,
    verdict: ok
      ? '60 轨生效（laneToLeft = lane - 30）'
      : '坐标不符预期——检查 laneToLeft / STAGE_NUM_LANES / MAX_LANE',
  }
}

/** 挂到 window 上，方便控制台直接调用。 */
export function installLaneProbe(): void {
  ;(window as unknown as { runLaneProbe?: typeof runLaneProbe }).runLaneProbe = runLaneProbe
}
