/**
 * llll 原生谱面 → MusicScoreMakerData（PJSK 渲染管线可吃的最小结构）。
 *
 * 本项目的核心决策：**不做 12 轨压缩**。
 * 参考实现 `llll-chart2sus/pjsk_mapper.py` 会把 0–59 坐标压到 0–11
 * （`_map_lane_width`），那正是本项目要避开的量化损失。
 * 这里 laneStart / laneEnd 原样保留 llll 的 0–59 整数轨道，
 * 与 native 侧 60 轨渲染管线一一对应。
 *
 * 解析本身复用 `apps/llll-preview` 的 chart.ts（Flags 位域、Hold 串链、
 * 同时押分组），本文件只负责「Chart → MusicScoreMakerData」的编码。
 *
 * 结构字段对照（已核实 native/src/custom_score_json.h 的消费方式）：
 *   MusicScoreEventDataList: eventType 0=BPM(changeValue 数值)
 *                            1=HiSpeed  2=SE 音量  3=拍号(changeValue 字符串)
 *   NoteList: laneStart/laneEnd 含端点 0..59；category/noteBaseType 决定
 *             音符种类；Hold 用 previous/nextConnectionId 串链。
 */
import type { Chart, Note } from './chart'

export const TICKS_PER_BEAT = 480

/** llll 的 Flags type 位域语义（ir.py LinkLikeNoteType）。 */
export const enum LlllNoteType {
  Single = 0,
  Hold = 1,
  Flick = 2,
  Trace = 3,
}

/**
 * 单个音符的 (category, noteBaseType, critical)。
 * 取值经 custom_score_json.h 的谓词反推核对：
 *   isFlickNote      = base==3 || category==3
 *   isTraceNote      = base in {4,8,11} || category in {4,6,8}
 *   isTraceFlickNote = base==4 || category==8
 * 故 SINGLE→(0,1)、FLICK→(3,3) 与 pjsk_mapper.py 一致。
 *
 * TRACE 走 **friction 的 critical 形式** (4,11,critical)：
 * llll 源谱的トレース音符在游戏内是金色（贴图 ui_sc2_ingame_notes_trace
 * 主色均值 RGB(252,230,68)），而 PJSK 渲染管线的 friction 只有 critical 档
 * 才取金色贴图 SPR_NOTE_FRICTION_CRITICAL(226,197,109)；非 critical 档是
 * 青绿 SPR_NOTE_FRICTION(103,241,183)。故必须带 critical 才与源游戏同色。
 * 谓词不变（仍命中 isTraceNote: base==11），只是多一枚 type=1 的 critical 旗标。
 */
const TAP_KINDS: Record<number, readonly [number, number, boolean]> = {
  [LlllNoteType.Single]: [0, 1, false],
  [LlllNoteType.Flick]: [3, 3, false],
  [LlllNoteType.Trace]: [4, 11, true],
}

/** Hold 首/中/尾节点的 (category, noteBaseType)；中段走 base=6（Invisible 链节点）。 */
const HOLD_START = [1, 2] as const
const HOLD_RELAY = [13, 6] as const
const HOLD_END = [1, 1] as const

export interface RawNoteJson {
  id: number
  ticks: number
  laneStart: number
  laneEnd: number
  category: number
  type: number
  speedRatio: number
  noteLineType: number
  noteBaseType: number
  previousConnectionId: number
  nextConnectionId: number
  direction: number
  isSkip: boolean
  IsSingle: boolean
  IsConnectedFirst: boolean
  IsConnectedLast: boolean
}

export interface RawEventJson {
  id: number
  eventType: number
  ticks: number
  changeValue: number | string
}

export interface MusicScoreMakerData {
  VersionCode: number
  MusicScoreEventDataList: RawEventJson[]
  EventArray: unknown[]
  NoteList: RawNoteJson[]
  MusicScoreTicksMax: number
  MusicId: number
  FullComboDataHash: null
}

/** 秒 → tick：按 BPM 分段积分拍数，最后一次性取整（避免逐段累计误差）。 */
class TickConverter {
  private readonly times: number[] = [0]
  private readonly bpms: number[] = []
  private readonly beats: number[] = [0]

  constructor(bpms: Chart['bpms']) {
    const points = new Map<number, number>()
    for (const event of bpms) {
      const existing = points.get(event.time)
      if (existing !== undefined && existing !== event.bpm) {
        throw new Error(`同一时间存在冲突 BPM：${event.time}`)
      }
      points.set(event.time, event.bpm)
    }
    const ordered = [...points.entries()].sort((a, b) => a[0] - b[0])
    if (!ordered.length) {
      ordered.push([0, 120])
    }
    // t<=0 的 BPM 事件都算作初始值。
    let initial = ordered[0][1]
    for (const [time, bpm] of ordered) {
      if (time <= 0) initial = bpm
    }
    this.bpms.push(initial)
    for (const [time, bpm] of ordered) {
      if (time <= 0) continue
      this.beats.push(this.beats[this.beats.length - 1] + ((time - this.times[this.times.length - 1]) * this.bpms[this.bpms.length - 1]) / 60)
      this.times.push(time)
      this.bpms.push(bpm)
    }
  }

  /** 各 BPM 段的起始时刻（下标 1 起为变化点）。 */
  get changeTimes(): number[] {
    return this.times.slice(1)
  }

  get changeBpms(): number[] {
    return this.bpms.slice(1)
  }

  at(time: number): number {
    let index = this.times.length - 1
    while (index > 0 && this.times[index] > time) index -= 1
    const value = (this.beats[index] + ((time - this.times[index]) * this.bpms[index]) / 60) * TICKS_PER_BEAT
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`时间超出 ticks 范围：${time}`)
    }
    return Math.round(value)
  }
}

interface HoldPoint {
  time: number
  l: number
  r: number
}

/**
 * 沿 next 链收集一条 Hold 的所有端点（首节点的 l/r，后续各节点的 l2/r2），
 * **全部保留**，只去重完全重复的节点。
 *
 * 关于同 tick 节点（全语料 696 处，最小真实间隔 0.00018 s）：
 * PJSK 的 ticks 是整数，源谱面里相邻航点可能量化到同一 tick。这**不是**要消除
 * 的异常——渲染侧 `sortHoldSteps`（mmw_preview.cpp）明确支持同 tick：
 *
 *     n1.tick == n2.tick ? n1.lane < n2.lane : n1.tick < n2.tick
 *
 * 同 tick 的两个节点按 lane 排序，正是「长条在同一时刻横向瞬移」的表达方式
 * （源谱 203117_04 root=125 即为典型：长条停在 39-50，随后瞬间跳到 20-31）。
 * **丢掉中间航点会把瞬移改成斜移**，全语料最大几何偏差 39.4 轨（半个舞台），
 * 18 条链偏差 >2 轨——因此绝不折叠。
 *
 * 唯一需要处理的是**完全重复节点**（同 tick 且同 lane，6 处）：几何上
 * 无意义且会让连接链退化，直接跳过。
 */
function collectHoldPoints(root: Note, ticks: TickConverter): { tick: number; l: number; r: number }[] {
  const raw: HoldPoint[] = [{ time: root.time, l: root.l, r: root.r }]
  let cursor: Note | undefined = root
  let guard = 0
  while (cursor && guard++ < 4096) {
    raw.push({ time: cursor.end, l: cursor.l2, r: cursor.r2 })
    cursor = cursor.next
  }

  const out: { tick: number; l: number; r: number }[] = []
  for (const point of raw) {
    const tick = ticks.at(point.time)
    const last = out[out.length - 1]
    if (last && tick === last.tick && point.l === last.l && point.r === last.r) {
      // 同 tick 同 lane：完全重复，跳过
      continue
    }
    out.push({ tick, l: point.l, r: point.r })
  }
  return out
}

function makeNote(
  id: number,
  tick: number,
  laneStart: number,
  laneEnd: number,
  category: number,
  noteBaseType: number,
  critical = false,
): RawNoteJson {
  return {
    id,
    ticks: tick,
    laneStart,
    laneEnd,
    category,
    type: critical ? 1 : 0,
    speedRatio: 1,
    noteLineType: 0,
    noteBaseType,
    previousConnectionId: -1,
    nextConnectionId: -1,
    direction: 0,
    isSkip: false,
    IsSingle: true,
    IsConnectedFirst: false,
    IsConnectedLast: false,
  }
}

/**
 * 拍号事件：llll 的 Beats 数组；缺省 4/4。
 * changeValue 是 "分子/分母" 字符串（custom_score_json.h 只解析数值型事件，
 * 拍号事件对渲染无影响，保留以维持结构完整）。
 */
function buildTimeSignatureEvents(
  beats: { numerator: number; denominator: number; time: number }[],
): { time: number; value: string }[] {
  const signatures = new Map<number, string>()
  for (const beat of beats) {
    const value = `${beat.numerator}/${beat.denominator}`
    const existing = signatures.get(beat.time)
    if (existing !== undefined && existing !== value) {
      throw new Error(`同一时间存在冲突拍号：${beat.time}`)
    }
    signatures.set(beat.time, value)
  }
  const ordered = [...signatures.entries()].sort((a, b) => a[0] - b[0])
  if (!ordered.length) {
    return [{ time: 0, value: '4/4' }]
  }
  // t<=0 的事件折叠进 tick 0。
  const head = ordered.filter(([time]) => time <= 0)
  const tail = ordered.filter(([time]) => time > 0)
  return [{ time: 0, value: head.length ? head[head.length - 1][1] : ordered[0][1] },
    ...tail.map(([time, value]) => ({ time, value }))]
}

export interface ConvertOptions {
  /** llll 的 Offset 字段（秒）。非 0 时作为 sourceOffset 交给播放器，不写进谱面。 */
  offsetSec?: number
  /** 拍号数组；llll 原始谱面里为 Beats。 */
  beats?: { numerator: number; denominator: number; time: number }[]
}

/**
 * 把 llll 原生 Chart 编码成 MusicScoreMakerData。
 *
 * **轨道坐标 0–59 原样保留**，不经过任何 12 轨压缩。
 */
export function chartToMusicScore(chart: Chart, options: ConvertOptions = {}): MusicScoreMakerData {
  const ticks = new TickConverter(chart.bpms)
  const events: RawEventJson[] = []

  const pushEvent = (tick: number, eventType: number, changeValue: number | string) => {
    events.push({ id: events.length + 1, eventType, ticks: tick, changeValue })
  }

  // 固定头部：BPM / 拍号 / HiSpeed / SE 音量（与 pjsk_mapper 的顺序一致）。
  const signatures = buildTimeSignatureEvents(options.beats ?? [])
  pushEvent(0, 0, ticks.at(0) === 0 ? (chart.bpms[0]?.bpm ?? 120) : 120)
  pushEvent(0, 3, signatures[0].value)
  pushEvent(0, 1, 1)
  pushEvent(0, 2, 1)

  for (const [index, time] of ticks.changeTimes.entries()) {
    pushEvent(ticks.at(time), 0, ticks.changeBpms[index])
  }
  for (const signature of signatures.slice(1)) {
    pushEvent(ticks.at(signature.time), 3, signature.value)
  }

  const notes: RawNoteJson[] = []
  const nextId = () => events.length + notes.length + 1

  // Hold 链先写（与 pjsk_mapper 的排序口径一致：按起点时间、根 UID）。
  const holdRoots = chart.roots
    .filter((note) => note.type === LlllNoteType.Hold)
    .sort((a, b) => (a.time === b.time ? a.uid - b.uid : a.time - b.time))

  for (const root of holdRoots) {
    const points = collectHoldPoints(root, ticks)
    const baseId = nextId()
    points.forEach((point, index) => {
      const isFirst = index === 0
      const isLast = index === points.length - 1
      const [category, noteBaseType] = isLast ? HOLD_END : isFirst ? HOLD_START : HOLD_RELAY
      const item = makeNote(baseId + index, point.tick, point.l, point.r, category, noteBaseType)
      item.previousConnectionId = isFirst ? -1 : baseId + index - 1
      item.nextConnectionId = isLast ? -1 : baseId + index + 1
      item.IsSingle = false
      item.IsConnectedFirst = isFirst
      item.IsConnectedLast = isLast
      notes.push(item)
    })
  }

  // 非 Hold 音符（Single / Flick / Trace）。
  const taps = chart.notes
    .filter((note) => note.type !== LlllNoteType.Hold)
    .sort((a, b) => (a.time === b.time ? a.uid - b.uid : a.time - b.time))

  for (const note of taps) {
    const kind = TAP_KINDS[note.type]
    if (!kind) {
      throw new Error(`未知的 llll 音符类型：${note.type}（UID ${note.uid}）`)
    }
    const [category, noteBaseType, critical] = kind
    notes.push(makeNote(nextId(), ticks.at(note.time), note.l, note.r, category, noteBaseType, critical))
  }

  notes.sort((a, b) => (a.ticks === b.ticks ? a.id - b.id : a.ticks - b.ticks))

  return {
    VersionCode: 1,
    MusicScoreEventDataList: events,
    EventArray: [],
    NoteList: notes,
    MusicScoreTicksMax: notes.reduce((max, note) => Math.max(max, note.ticks), 0),
    MusicId: 0,
    FullComboDataHash: null,
  }
}

/** 判定是不是 llll 原生谱面（`{Notes, Bpms}`），用于导入时自动识别格式。 */
export function isLlllNativeChart(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.Notes) && Array.isArray(record.Bpms)
}
