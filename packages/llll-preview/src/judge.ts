/**
 * LLLL 手动判定状态机。
 *
 * 依据 4.12.0 客户端（`libil2cpp.so` + `dump.cs`）的
 * `NoteResolver` / `Manual*NotePolicy` / `*NoteContext` / `IJudgementResolver` / `ITapPositionResolver`
 * 逐指令还原，供预览「游玩模式」使用。AutoPlay 仍由 HUD 原有的按时间重放路径驱动，
 * 这里的 AutoPlay 分支只用于自检与对照。
 *
 * 数据域约定：
 * - 判定时刻、航点全部是歌曲时间（秒，float32 口径，见 `@sukushow/chart` 的 `getHolds`）。
 * - 触摸位置是轨道坐标 lane（0…59 浮点，29.5 = 屏幕正中），由渲染器按当前相机反投影得到；
 *   原版 `TapPositionResolveBase` 的屏幕公式在 1920×1080 下与 3D 投影一致（实测 24.08 px/lane）。
 * - 一个 Hold 链只产生一条 `JudgeNote`：链首是判定与连击的归属，链中节点只提供分段几何。
 *
 * 与原版的差异（预览口径，写入 docs/evidence.md）：
 * - 触摸事件自带发生时刻（`touch.time`），原版在帧头统一取 `currentTime`。
 * - 键盘输入（原版没有）：分区按键带 `span` 按区间触碰；Air 键（`air`）完成键盘起手的 Flick；
 *   同一只手同时压下的相邻分区键（`chord`）合起来只按一个音符（同时押除外）。
 * - 预览不还原对象池 / Version 复用，改为每张谱面一次性建表。
 * - 漏头后的 Hold 仍按原版逐航点 Miss（之后范围内的触摸照样能续上采样）；原版不认手指，松手不改判定状态，
 *   ribbon 与循环特效继续到离场（见 `renderer.holdDraw`）。
 * - Mental 扣减在 HUD 侧结算（`hud.applyJudgement`，扣量见 `score.mentalMinus`）：扣到 0 不失败，
 *   只是此后判定不再加分、技术分归零、曲终横幅取 Finish 档。
 */
import type { Chart, Note } from '@sukushow/chart/chart';
import { noteJudgementTimes, SIMULTANEOUS_WINDOW } from '@sukushow/chart/chart';
import type { NoteConditionType, NoteJudgementType } from './rgOptions';
import { buildLineHashTables } from './se';

/** 触摸阶段；与 Unity `TouchPhase` 同序：Began=0 / Moved=1 / Stationary=2 / Ended=3 / Canceled=4。 */
export type JudgeTouchPhase = 'began' | 'moved' | 'stationary' | 'ended' | 'canceled';

const PHASE: Record<JudgeTouchPhase, number> = {
  began: 0, moved: 1, stationary: 2, ended: 3, canceled: 4,
};

export interface JudgeTouch {
  /** 指针 id（键盘用互不冲突的大整数）。 */
  id: number;
  phase: JudgeTouchPhase;
  /** 轨道坐标（0…59 浮点，29.5 = 屏幕正中）。 */
  lane: number;
  /** 事件发生时的歌曲时间（秒）。 */
  time: number;
  /** 屏幕坐标（CSS px），Flick 的距离判定用；键盘输入没有。 */
  x?: number;
  y?: number;
  /** 键盘输入：没有划动轨迹，Flick 要靠 Air（`keyboardAir`）或起手即完成。 */
  keyboard?: boolean;
  /**
   * 键盘分区（预览自有）：按键同时触碰整个 lane 区间，与音符可点范围有交集即在范围内；
   * 同时押排序的距离取区间里离可点范围中点最近的点。缺省时按 `lane` 单点判定。
   */
  span?: readonly [number, number];
  /**
   * 键盘 Air（预览自有，类 Chunithm 抬手上滑）：不路由到音符、不算空点，
   * 只把键盘起手、仍在 `FlickValidTime` 内的 Flick 标记为划动完成。
   */
  air?: boolean;
  /**
   * 键盘同按组（预览自有）：同一只手同时压下的相邻分区键共用一个编号。同组的 Began 合起来只消费一个音符
   * （同一时刻 `SIMULTANEOUS_WINDOW` 内的同时押除外），多出来的键不再去抢后面已进窗口的音符、也不算空点；
   * Stationary / Moved 不受影响（Hold 续按、Trace 照常）。
   */
  chord?: number;
}

/** 一次判定。`kind` 为 `empty` 时是空点（没有命中任何音符）的触摸音效。 */
export interface JudgeEvent {
  kind: 'judge' | 'empty';
  /** 链首 Uid；空点为 -1。 */
  uid: number;
  /** NoteTypes：0 Single / 1 Hold / 2 Flick / 3 Trace。 */
  noteType: number;
  type: NoteJudgementType;
  condition: NoteConditionType;
  /** 判定发生的歌曲时间。 */
  time: number;
  /** 判定点的目标时间（Just / 航点时刻）。 */
  target: number;
  /** 音符中心 lane（特效与 SE 用）。 */
  lane: number;
  /** 音符宽度（lane 数，含两端）。 */
  width: number;
  /** SE 线哈希（`buildLineHashTables`）；0 表示无。 */
  lineHash: number;
  /** 是否是 Hold 的判定点。 */
  hold: boolean;
  /** 是否是 Hold 尾判（最后一个航点）。 */
  holdEnd: boolean;
  /** 是否是 Flick（起手与结算合并为一条）。 */
  flick: boolean;
  /** 是否是本音符的第一个判定（Hold 头 / Flick / Single / Trace）。 */
  head: boolean;
  /** Hold 航点序号（0 = 头，末位 = 尾）；非 Hold 为 -1。 */
  holdIndex: number;
}

/** 渲染器 / HUD 需要的单音符状态。 */
export interface NoteViewState {
  /** pending：还在下落；judged：已判定；missed：漏掉（继续下落到出屏）。 */
  phase: 'pending' | 'judged' | 'missed';
  /** Hold 已起判（`HoldStatus.index != -1`）且最近一次路由来的触摸不是 Canceled（原版 `_touched`）：ribbon 用「按住」的动态配色，循环特效常亮。 */
  holding: boolean;
  /** Hold 断链：漏头或有航点判 Miss。原版不认手指，松手本身不改判定状态，只是之后没有触摸来续采样。 */
  broken: boolean;
  /** 已结算的航点数（非 Hold 为 0/1）。 */
  judged: number;
  /** 所有判定点已结算：音符离开活跃表。 */
  finished: boolean;
  /** 离场原因是 Miss（尾判 Miss / 漏头僵尸）：头部图标继续下落到出屏。 */
  missed: boolean;
}

/** 单指判定窗口：`JudgementSingleResolver`（4.12.0）。 */
export const SINGLE_MIN_DIFF = 0.04;
export const SINGLE_MAX_DIFF = 0.125;
/** `JudgementHoldResolver`：没有 Perfect 档，PP 窗口更宽。 */
export const HOLD_MIN_DIFF = 0.04;
export const HOLD_MAX_DIFF = 0.125;
/** `JudgementFlickResolver`。 */
export const FLICK_MIN_DIFF = 0.07;
export const FLICK_MAX_DIFF = 0.1;
/** `FlickDistance`：屏幕距离平方（625 = 25² px）。 */
export const FLICK_DISTANCE = 625;
/** `FlickValidTime`：起手后允许划动的时长。 */
export const FLICK_VALID_TIME = 0.075;
/** `JudgementTraceResolver`。 */
export const TRACE_MIN_DIFF = 0.07;
/** Hold 采样 / 尾判窗口（原版 0.0167 s）。 */
export const HOLD_WINDOW = 0.0167;
/** `JudgementHoldResolver.IsHoldEnd`：`Round(diff, 3) ∈ [-0.1, 0]`。 */
export const HOLD_END_MIN_DIFF = -0.1;
/** `TapPositionResolveBase.SubRange` = 5 lane；音符左右各多 5.5 lane 的可点范围。 */
export const LANE_SUB_RANGE = 5.5;
/** `DelayOrderNoteCollection.Add` 的 Just 容差（float32 `1e-4`）。 */
const JUST_EPSILON = Math.fround(0.0001);

/** C# `Math.Round(double, 3)` = 银行家舍入（ToEven）。 */
export function round3(value: number): number {
  const scaled = value * 1000;
  const floor = Math.floor(scaled);
  const rest = scaled - floor;
  let n: number;
  if (rest > 0.5) n = floor + 1;
  else if (rest < 0.5) n = floor;
  else n = floor % 2 === 0 ? floor : floor + 1;
  return n / 1000;
}

/** `JudgementSingleResolver.Get`：`≤.025 PP / ≤.04 P / ≤.07 Great / ≤.1 Good / ≤.125 Bad / 其余 Miss`。 */
export function judgementForSingle(diff: number): NoteJudgementType {
  const d = Math.abs(round3(diff));
  if (d <= 0.025) return 5;
  if (d <= 0.04) return 4;
  if (d <= 0.07) return 3;
  if (d <= 0.1) return 2;
  if (d <= 0.125) return 1;
  return 0;
}

/** `JudgementHoldResolver.Get`：`≤.04 PP / ≤.07 Great / ≤.1 Good / ≤.125 Bad / 其余 Miss`。 */
export function judgementForHold(diff: number): NoteJudgementType {
  const d = Math.abs(round3(diff));
  if (d <= 0.04) return 5;
  if (d <= 0.07) return 3;
  if (d <= 0.1) return 2;
  if (d <= 0.125) return 1;
  return 0;
}

/** `JudgementFlickResolver.Get`：`≤.07 PP / ≤.1 Great / 其余 Miss`。 */
export function judgementForFlick(diff: number): NoteJudgementType {
  const d = Math.abs(round3(diff));
  if (d <= FLICK_MIN_DIFF) return 5;
  if (d <= FLICK_MAX_DIFF) return 3;
  return 0;
}

/** `JudgementTraceResolver.Get`：`≤.07 PP / 其余 Miss`。 */
export function judgementForTrace(diff: number): NoteJudgementType {
  return Math.abs(round3(diff)) <= TRACE_MIN_DIFF ? 5 : 0;
}

/** `JudgementHoldResolver.IsHoldEnd`：`Round(diff, 3) ∈ [-0.1, 0]`。 */
export function isHoldEnd(diff: number): boolean {
  const d = round3(diff);
  return d >= HOLD_END_MIN_DIFF && d <= 0;
}

/** `ToCondition`：早于目标为 Fast（1），否则（含 0）为 Slow（2）。 */
export function conditionForDiff(diff: number): NoteConditionType {
  return diff < 0 ? 1 : 2;
}

/** 一个 Hold 链的分段（链中每个 `ChartNoteUnit` 一段）。 */
export interface HoldSegment {
  /** 段起点（Just）。 */
  just: number;
  /** 段终点（本段最后一个 Holds 端点；无 Holds 时等于 just）。 */
  end: number;
  /** 段首 lane。 */
  l1: number;
  r1: number;
  /** 段尾 lane。 */
  l2: number;
  r2: number;
}

interface JudgeNote {
  root: Note;
  type: number;
  /** 判定点时刻：`[Just, ...Holds]`（多段链为半拍重采样）。 */
  waypoints: number[];
  /** HoldStatus.holds：`waypoints.slice(1)`。 */
  holds: number[];
  /** 链尾终点（尾判目标时刻）。 */
  tailEnd: number;
  /** 链尾 Uid（尾判 SE 线哈希用）。 */
  tailUid: number;
  /** 段列表（Hold）；其余为空。 */
  segments: HoldSegment[];
  /** Hold 游标所在段（`ctx.Unit`）。 */
  unit: number;
  /** 待提交判定（`_result`），-1 = None。 */
  result: NoteJudgementType | -1;
  /** 头判 diff（`_diff`），Hold 中间采样沿用。 */
  lastDiff: number;
  /** 尾判窗口内最近一次触摸时刻（`_lastTouchedTime`，`Initialize` 置 -1）；> 0 即尾判成功的依据。 */
  lastTouched: number;
  /** 最近一次路由到本音符的触摸阶段（`_touchPhase`）。 */
  touchPhase: number;
  /** 尾判窗口命中过（`_isSuccessedEnd`）。 */
  successEnd: boolean;
  /** HoldStatus.index；-1 = 头未判定。 */
  holdIndex: number;
  /** Flick 起手：起手判定类型 / 起手时刻 / 起手位置 / 手指 id / 是否已划动完成 / 是否键盘起手。 */
  flickFirst: NoteJudgementType;
  flickAt: number;
  flickFinger: number;
  flickX: number;
  flickY: number;
  flicked: boolean;
  flickKeyboard: boolean;
  /** 统计。 */
  judged: number;
  finished: boolean;
  /** 离场原因是 Miss（尾判 Miss / 漏头僵尸）；尾判成功为 false。 */
  missedEnd: boolean;
  headJudged: boolean;
  headMissed: boolean;
  broken: boolean;
}

export interface JudgeOptions {
  /** 是否 AutoPlay（默认 false）。 */
  autoPlay?: boolean;
  /** AutoPlay 是否出 PerfectPlus（默认 false，与预览「PERFECT+」选项一致）。 */
  perfectPlus?: boolean;
  /** 空点判定：原版只在上半屏（y < Screen.height*0.5）播空点音效。 */
  emptyTouch?: (touch: JudgeTouch) => boolean;
  /** 键盘 Flick 是否要等 Air 键完成划动（默认 false：键盘起手即完成）。 */
  keyboardAir?: boolean;
}

export class JudgeEngine {
  private readonly notes: JudgeNote[] = [];
  private readonly state = new Map<number, NoteViewState>();
  private readonly hashes: ReturnType<typeof buildLineHashTables>;
  private auto: boolean;
  private pp: boolean;
  private keyboardAir: boolean;
  private readonly emptyTouch: ((touch: JudgeTouch) => boolean) | undefined;
  private time = 0;
  private events: JudgeEvent[] = [];
  /** 键盘同按组 → 该组 Began 已消费的音符 Just 与消费时刻（见 `JudgeTouch.chord`）。 */
  private readonly chordClaims = new Map<number, { just: number; at: number }>();

  constructor(private readonly chart: Chart, options: JudgeOptions = {}) {
    this.auto = options.autoPlay ?? false;
    this.pp = options.perfectPlus ?? false;
    this.keyboardAir = options.keyboardAir ?? false;
    this.emptyTouch = options.emptyTouch;
    this.hashes = buildLineHashTables(chart);
    for (const root of chart.roots) this.notes.push(this.create(root));
  }

  private create(root: Note): JudgeNote {
    let tail = root;
    const segments: HoldSegment[] = [];
    if (root.type === 1) {
      for (let unit: Note | undefined = root; unit; unit = unit.next) {
        tail = unit;
        const end = unit.holds.length ? unit.holds[unit.holds.length - 1]! : unit.end;
        segments.push({ just: unit.time, end, l1: unit.l, r1: unit.r, l2: unit.l2, r2: unit.r2 });
      }
    }
    const waypoints = noteJudgementTimes(root, this.chart.bpms);
    const note: JudgeNote = {
      root, type: root.type, waypoints, holds: waypoints.slice(1), tailEnd: tail.end, tailUid: tail.uid,
      segments, unit: 0, result: -1, lastDiff: 0, lastTouched: -1, touchPhase: 0, successEnd: false,
      holdIndex: -1,
      flickFirst: 0, flickAt: 0, flickFinger: -1, flickX: 0, flickY: 0, flicked: false, flickKeyboard: false,
      judged: 0, finished: false, missedEnd: false, headJudged: false, headMissed: false, broken: false,
    };
    this.state.set(root.uid, { phase: 'pending', holding: false, broken: false, judged: 0, finished: false, missed: false });
    return note;
  }

  get autoPlay(): boolean { return this.auto; }

  setAutoPlay(on: boolean): void {
    this.auto = on;
    this.reset();
  }

  setPerfectPlus(on: boolean): void {
    this.pp = on;
  }

  /** 键盘 Flick 是否要等 Air 键（见 `JudgeOptions.keyboardAir`）；只影响之后的起手。 */
  setKeyboardAir(on: boolean): void {
    this.keyboardAir = on;
  }

  /** 回到起点；`time` 之前的判定点全部作废。 */
  reset(time = 0): void {
    this.time = time;
    this.events = [];
    this.chordClaims.clear();
    for (const note of this.notes) {
      note.result = -1;
      note.lastDiff = 0;
      note.lastTouched = -1;
      note.touchPhase = 0;
      note.successEnd = false;
      note.holdIndex = -1;
      note.flickFirst = 0;
      note.flickAt = 0;
      note.flickFinger = -1;
      note.flicked = false;
      note.flickKeyboard = false;
      note.judged = 0;
      note.finished = false;
      note.missedEnd = false;
      note.headJudged = false;
      note.headMissed = false;
      note.broken = false;
      note.unit = 0;
      // 跳转重开：已经完全落在 time 之前的音符不再补判，直接视为已结算。
      if (note.waypoints[note.waypoints.length - 1]! < time - 0.2) note.finished = true;
      this.state.set(note.root.uid, {
        phase: note.finished ? 'missed' : 'pending', holding: false, broken: false, judged: 0, finished: note.finished,
        // 跳转跳过的音符是「视为已结算」，不是判定 Miss，离场后不再绘制。
        missed: false,
      });
    }
  }

  /** 跳转后重建：手动模式直接重开一局。 */
  seek(time: number): void {
    this.reset(time);
  }

  /** 当前按住中的 Hold 数（HUD 持续音用）。 */
  holdingCount(): number {
    // 原版 `ManualHoldNotePolicy.ProcessTouch` 顶部：`if (_touched) ctx.Se.AddHold()`，
    // `_touched = HoldStatus.index != -1 && touchPhase != Canceled`，断链后依然成立。
    let n = 0;
    for (const note of this.notes) if (!note.finished && touched(note)) n++;
    return n;
  }

  noteState(uid: number): NoteViewState {
    return this.state.get(uid) ?? { phase: 'pending', holding: false, broken: false, judged: 0, finished: false, missed: false };
  }

  /**
   * 推进一步。`touches` 是本帧内按发生顺序排列的触摸事件。
   * 帧内顺序与原版 `NoteResolver.Process` 一致：ProcessView → 触摸路由 → 空点 → ProcessTouch。
   */
  process(time: number, touches: readonly JudgeTouch[] = []): readonly JudgeEvent[] {
    if (time < this.time - 1e-6) this.reset(time);
    this.time = time;
    this.events = [];
    // 同按组只在按下的一瞬有意义：1 s 前的记录不会再有同组的 Began。
    for (const [chord, claim] of this.chordClaims) if (claim.at < time - 1) this.chordClaims.delete(chord);
    if (this.auto) {
      this.processAuto(time);
      this.refreshStates();
      return this.events;
    }
    for (const note of this.notes) if (!note.finished) this.processView(note, time);
    let consumed = false;
    for (const touch of touches) consumed = this.route(touch) || consumed;
    if (!consumed) {
      for (const touch of touches) {
        if (touch.phase === 'began' && !touch.air && (this.emptyTouch?.(touch) ?? true)) { this.emitEmpty(touch.time); break; }
      }
    }
    for (const note of this.notes) if (!note.finished) this.processTouch(note, time);
    this.refreshStates();
    return this.events;
  }

  // ---------------------------------------------------------------- AutoPlay

  private processAuto(time: number): void {
    const type: NoteJudgementType = this.pp ? 5 : 4;
    for (const note of this.notes) {
      if (note.finished) continue;
      const wp = note.waypoints;
      while (note.judged < wp.length && time >= wp[note.judged]!) {
        const last = note.judged === wp.length - 1;
        this.emit(note, type, 0, time, wp[note.judged]!, last, note.judged);
        note.judged++;
        if (last) note.finished = true;
      }
    }
  }

  // ------------------------------------------------------------ Manual: view

  /** `ProcessView`：Miss 兜底、Hold 游标推进、Hold 尾判提交。 */
  private processView(note: JudgeNote, now: number): void {
    if (note.type === 0) {
      if (now - note.root.time > SINGLE_MAX_DIFF) this.miss(note, now, note.root.time, false, 0);
      return;
    }
    if (note.type === 3) {
      if (now - note.root.time > TRACE_MIN_DIFF) this.miss(note, now, note.root.time, false, 0);
      return;
    }
    if (note.type === 2) {
      this.processFlickView(note, now);
      return;
    }
    // Hold：尾判成功块（`ManualHoldNotePolicy.ProcessView` @0x4AF29E4，4.12.0）：
    // `_lastTouchedTime > 0 && 尾段 LastTime − currentTime < 0.0167 && index == end`
    // → `Score.Add(Perfect+, None, currentTime, HoldStatus.Current)`。只看尾窗口内是否收到过触摸，不看采样结果。
    const end = note.holds.length - 1;
    if (note.lastTouched > 0 && note.tailEnd - now < HOLD_WINDOW && note.holdIndex === end) {
      note.result = -1;
      note.judged = note.waypoints.length;
      note.finished = true;
      this.emit(note, 5, 0, now, note.holds[end] ?? note.tailEnd, true, note.waypoints.length - 1);
      return;
    }
    // 游标每帧至多推进一段（原版是 if 不是 while）。
    const seg = note.segments[note.unit];
    if (seg && note.unit < note.segments.length - 1 && seg.end < now) note.unit++;
  }

  private processFlickView(note: JudgeNote, now: number): void {
    if (note.finished) return;
    if (note.flickFirst >= 1) {
      // 起手后 0.075 s 内没有划够距离 → 兜底 Good + Flick（松手不提前结算）。
      if (!note.flicked && now > note.flickAt + FLICK_VALID_TIME) {
        note.finished = true;
        this.emit(note, 2, 3, now, note.root.time, false, 0);
      }
      return;
    }
    if (now - note.root.time > FLICK_MAX_DIFF) this.miss(note, now, note.root.time, false, 0);
  }

  private miss(note: JudgeNote, now: number, target: number, hold: boolean, holdIndex: number): void {
    note.finished = true;
    note.missedEnd = true;
    note.headMissed = !note.headJudged;
    note.broken = note.type === 1;
    note.judged = Math.max(note.judged, holdIndex + 1);
    this.emit(note, 0, 0, now, target, holdIndex === note.waypoints.length - 1, holdIndex, hold);
  }

  // ----------------------------------------------------------- Manual: route

  /**
   * 把一个触摸事件路由到候选音符，返回是否被消费（`NoteResolver.Process` @0x499B7E8，4.12.0）。
   *
   * 每个触摸不分阶段（Ended / Canceled 也路由）遍历活跃音符：`IsOutOfRange && ShouldRange` 跳过；
   * `ShouldPassOtherNotes` 直通 `ProcessFinger`、不进候选也不消费；其余进 `DelayOrderNoteCollection`，
   * 按序 `ProcessFinger`，首个返回 true 即消费。Hold 的 `ShouldRange` 恒为 true、
   * `ShouldPassOtherNotes = index != -1`（@0x4AF2678）：已起判后只收可点范围内的触摸，且不认是哪根手指。
   */
  private route(touch: JudgeTouch): boolean {
    if (touch.air) {
      this.air(touch);
      return false;
    }
    const candidates: { note: JudgeNote; just: number; distance: number }[] = [];
    for (const note of this.notes) {
      if (note.finished) continue;
      if (note.type === 0 || note.type === 3) {
        if (note.result >= 1) continue;
      } else if (note.type === 2) {
        // 起手后 ShouldRange 变 false：同指的任何位置都直通 ProcessFinger（不消费手指），
        // 这样划出可点范围的划动也能完成手势。
        if (note.flickFirst >= 1) {
          if (note.flickFinger === touch.id) this.processFinger(note, touch);
          continue;
        }
      }
      const range = this.tapRange(note, touch.time);
      if (!range || !touchesRange(touch, range)) continue;
      if (note.type === 1 && note.holdIndex !== -1) {
        this.processFinger(note, touch);
        continue;
      }
      insertCandidate(candidates, { note, just: note.root.time, distance: touchDistance(touch, range) });
    }
    // 键盘同按组（预览自有）：组里已有 Began 消费过音符时，只许再按同一时刻的同时押；这一下也不算空点。
    const chord = touch.chord !== undefined && touch.phase === 'began' ? touch.chord : undefined;
    const claim = chord === undefined ? undefined : this.chordClaims.get(chord);
    let consumed = claim !== undefined;
    for (const cand of candidates) {
      if (claim && Math.abs(cand.just - claim.just) >= SIMULTANEOUS_WINDOW) continue;
      if (this.processFinger(cand.note, touch)) {
        if (chord !== undefined && !claim) this.chordClaims.set(chord, { just: cand.just, at: touch.time });
        consumed = true;
        break;
      }
    }
    // 预览自有：Flick 起手记下的手指抬起后作废（浏览器会复用 pointerId）。
    if (touch.phase === 'ended' || touch.phase === 'canceled') {
      for (const note of this.notes) if (note.type === 2 && note.flickFinger === touch.id) note.flickFinger = -1;
    }
    return consumed;
  }

  // ------------------------------------------------------ Manual: finger input

  /** `ProcessFinger`：返回 true 表示消费该手指。 */
  private processFinger(note: JudgeNote, touch: JudgeTouch): boolean {
    if (note.result > 0) return false;
    note.touchPhase = PHASE[touch.phase];
    if (note.type === 2) return this.fingerFlick(note, touch);
    if (note.type === 0) {
      if (note.headJudged || touch.phase !== 'began') return false;
      note.lastDiff = touch.time - note.root.time;
      const j = judgementForSingle(note.lastDiff);
      if (j < 1) return false;
      note.result = j;
      return true;
    }
    if (note.type === 3) {
      if (note.headJudged || touch.phase === 'ended' || touch.phase === 'canceled') return false;
      note.lastDiff = touch.time - note.root.time;
      const j = judgementForTrace(note.lastDiff);
      if (j < 1) return false;
      note.result = j;
      return true;
    }
    return this.fingerHold(note, touch);
  }

  /** `ManualHoldNotePolicy.ProcessFinger` @0x4AF3BE0（4.12.0）。 */
  private fingerHold(note: JudgeNote, touch: JudgeTouch): boolean {
    // Canceled 以外（含 Ended，即在尾窗口内松手）都记尾窗口命中。
    if (touch.phase !== 'canceled' && isHoldEnd(touch.time - note.tailEnd)) {
      note.successEnd = true;
      note.lastTouched = Math.max(note.lastTouched, touch.time);
    }
    if (note.holdIndex !== -1) {
      const current = note.holds[note.holdIndex]!;
      if ((note.touchPhase < 3 || note.successEnd) && Math.abs(touch.time - current) <= HOLD_WINDOW) {
        note.result = 5;
      }
      return false;
    }
    if (touch.phase !== 'began') return false;
    note.lastDiff = touch.time - note.segments[note.unit]!.just;
    const j = judgementForHold(note.lastDiff);
    if (j < 1) return false;
    note.result = j;
    return true;
  }

  /**
   * 键盘 Air（预览自有，类 Chunithm 抬手上滑）：键盘起手、尚未划动完成且仍在 `FlickValidTime` 内的
   * Flick 一律算划动完成（Air 不分位置，同一下可以完成多个）。指针起手的 Flick 仍要真的划动。
   */
  private air(touch: JudgeTouch): void {
    for (const note of this.notes) {
      if (note.finished || note.type !== 2 || note.flickFirst < 1 || note.flicked || !note.flickKeyboard) continue;
      if (touch.time > note.flickAt + FLICK_VALID_TIME) continue;
      note.flicked = true;
      note.flickFinger = -1;
    }
  }

  private fingerFlick(note: JudgeNote, touch: JudgeTouch): boolean {
    if (note.flickFirst >= 1) {
      if (touch.id !== note.flickFinger || note.flicked) return false;
      if (note.touchPhase > 1) return false;
      if (touch.time > note.flickAt + FLICK_VALID_TIME) return false;
      const dx = (touch.x ?? touch.lane * 24) - note.flickX;
      const dy = (touch.y ?? 0) - note.flickY;
      if (dx * dx + dy * dy >= FLICK_DISTANCE) {
        note.flicked = true;
        note.flickFinger = -1;
      }
      return false;
    }
    if (touch.phase !== 'began') return false;
    note.lastDiff = touch.time - note.root.time;
    const j = judgementForFlick(note.lastDiff);
    if (j < 1) return false;
    note.flickFirst = j;
    note.flickAt = touch.time;
    note.flickFinger = touch.id;
    note.flickX = touch.x ?? touch.lane * 24;
    note.flickY = touch.y ?? 0;
    // 键盘起手：没有划动轨迹。开了 Air 就等 Air 键完成，否则起手即完成。
    note.flickKeyboard = touch.keyboard ?? false;
    if (touch.keyboard && !this.keyboardAir) note.flicked = true;
    return true;
  }

  // ------------------------------------------------------- Manual: judgement

  /** `ProcessTouch`：提交挂起的判定、漏判兜底、Hold 采样。 */
  private processTouch(note: JudgeNote, now: number): void {
    if (note.finished) return;
    if (note.type === 0) {
      if (note.result >= 1) this.commitSingle(note, now);
      return;
    }
    if (note.type === 3) {
      if (note.result >= 1 && now >= note.root.time) {
        note.result = -1;
        note.finished = true;
        note.headJudged = true;
        note.judged = 1;
        this.emit(note, 5, conditionForDiff(note.lastDiff), now, note.root.time, false, 0);
      }
      return;
    }
    if (note.type === 2) {
      if (note.flicked) {
        note.flicked = false;
        note.finished = true;
        note.headJudged = true;
        note.judged = 1;
        this.emit(note, note.flickFirst, conditionForDiff(note.lastDiff), now, note.root.time, false, 0);
      }
      return;
    }
    this.touchHold(note, now);
  }

  private commitSingle(note: JudgeNote, now: number): void {
    note.result = -1;
    note.finished = true;
    note.headJudged = true;
    note.judged = 1;
    this.emit(note, judgementForSingle(note.lastDiff), conditionForDiff(note.lastDiff), now, note.root.time, false, 0);
  }

  private touchHold(note: JudgeNote, now: number): void {
    const end = note.holds.length - 1;
    if (note.result >= 1) {
      if (note.holdIndex === -1) {
        // 头判提交。
        const type = note.result as NoteJudgementType;
        note.result = -1;
        note.headJudged = true;
        note.holdIndex = 0;
        note.judged = 1;
        this.emit(note, type, conditionForDiff(note.lastDiff), now, note.root.time, end === -1, 0);
        if (end === -1) note.finished = true;
        return;
      }
      if (note.holdIndex !== end) {
        // 中间采样提交（PP），condition 沿用头判 diff（原版如此）。
        const idx = note.holdIndex;
        note.result = -1;
        note.holdIndex++;
        note.judged++;
        this.emit(note, 5, conditionForDiff(note.lastDiff), now, note.holds[idx]!, false, idx + 1);
        return;
      }
      // 尾采样上的命中直接丢弃（`_result = -1`，@0x4AF3858）：尾判只由 ProcessView 按 `_lastTouchedTime` 提交。
      note.result = -1;
      return;
    }
    if (note.holdIndex === -1) {
      if (now > note.root.time + HOLD_MAX_DIFF) {
        // 漏头：转灰色僵尸，HoldStatus 从头开始逐采样 Miss。
        note.headMissed = true;
        note.broken = true;
        note.holdIndex = 0;
        note.judged = 1;
        this.emit(note, 0, 0, now, note.root.time, false, 0);
        if (end === -1) { note.finished = true; note.missedEnd = true; }
      }
      return;
    }
    const current = note.holds[note.holdIndex]!;
    // 采样窗口还没过：等（@0x4AF3384，`Current + 0.0167 >= currentTime`）。
    if (now <= current + HOLD_WINDOW) return;
    if (note.holdIndex === end) {
      // 尾窗口内收到过触摸（`_lastTouchedTime > 0`）就交给 ProcessView 的尾判成功块，否则尾 Miss。
      if (note.lastTouched > 0) return;
      note.finished = true;
      note.missedEnd = true;
      note.broken = true;
      note.judged = note.waypoints.length;
      this.emit(note, 0, 0, now, current, true, note.waypoints.length - 1);
      return;
    }
    note.holdIndex++;
    note.judged++;
    note.broken = true;
    this.emit(note, 0, 0, now, current, false, note.holdIndex);
  }

  // ------------------------------------------------------------- tap ranges

  /** 当前时刻的触摸区间；Hold 按当前段线性插值，与 `TapPositionHoldResolver` 一致。 */
  private tapRange(note: JudgeNote, time: number): { left: number; right: number; middle: number } | null {
    if (note.type !== 1) {
      return {
        left: note.root.l - LANE_SUB_RANGE,
        right: note.root.r + LANE_SUB_RANGE,
        middle: (note.root.l + note.root.r) / 2,
      };
    }
    const seg = note.segments[note.unit];
    if (!seg) return null;
    const span = seg.end - seg.just;
    const t = span > 0 ? Math.max(0, Math.min(1, (time - seg.just) / span)) : 0;
    const l = seg.l1 + (seg.l2 - seg.l1) * t, r = seg.r1 + (seg.r2 - seg.r1) * t;
    return { left: l - LANE_SUB_RANGE, right: r + LANE_SUB_RANGE, middle: (l + r) / 2 };
  }

  /** 判定点对应的音符中心 lane 与宽度（特效 / SE 用）。 */
  private geometryAt(note: JudgeNote, target: number): { lane: number; width: number } {
    if (note.type !== 1 || !note.segments.length) {
      return { lane: (note.root.l + note.root.r) / 2, width: note.root.r - note.root.l + 1 };
    }
    let seg = note.segments[note.segments.length - 1]!;
    for (const cur of note.segments) {
      if (target < cur.end) { seg = cur; break; }
    }
    const span = seg.end - seg.just;
    const t = span > 0 ? Math.max(0, Math.min(1, (target - seg.just) / span)) : 0;
    const l = seg.l1 + (seg.l2 - seg.l1) * t, r = seg.r1 + (seg.r2 - seg.r1) * t;
    return { lane: (l + r) / 2, width: r - l + 1 };
  }

  // ---------------------------------------------------------------- emitting

  private lineHash(note: JudgeNote, holdEnd: boolean): number {
    const table = holdEnd ? this.hashes.second : this.hashes.first;
    return table.get(holdEnd ? note.tailUid : note.root.uid) ?? 0;
  }

  private emit(
    note: JudgeNote, type: NoteJudgementType, condition: NoteConditionType,
    time: number, target: number, holdEnd: boolean, holdIndex: number, flick = note.type === 2,
  ): void {
    const geo = this.geometryAt(note, target);
    this.events.push({
      kind: 'judge', uid: note.root.uid, noteType: note.type, type, condition,
      time, target, lane: geo.lane, width: geo.width, lineHash: this.lineHash(note, holdEnd),
      hold: note.type === 1, holdEnd, flick, head: holdIndex === 0, holdIndex,
    });
  }

  private emitEmpty(time: number): void {
    this.events.push({
      kind: 'empty', uid: -1, noteType: -1, type: 0, condition: 0,
      time, target: time, lane: 0, width: 0, lineHash: 0, hold: false, holdEnd: false, flick: false,
      head: false, holdIndex: -1,
    });
  }

  private refreshStates(): void {
    for (const note of this.notes) {
      const st = this.state.get(note.root.uid)!;
      if (note.headMissed) st.phase = 'missed';
      else if (note.headJudged) st.phase = 'judged';
      else st.phase = 'pending';
      // 原版 `ManualHoldNotePolicy`：ribbon 的动态配色与循环特效只看 `_touched`
      // （`HoldStatus.index != -1 && touchPhase != Canceled`），断链后 index 仍在推进，所以按住外观一直持续到音符离场。
      st.holding = touched(note) && !note.finished;
      st.broken = note.broken;
      st.judged = note.judged;
      st.finished = note.finished;
      st.missed = note.missedEnd;
    }
  }
}

/** 触摸是否落在可点范围内：键盘分区按区间求交，指针按单点。 */
function touchesRange(touch: JudgeTouch, range: { left: number; right: number }): boolean {
  if (touch.span) return touch.span[0] <= range.right && touch.span[1] >= range.left;
  return touch.lane >= range.left && touch.lane <= range.right;
}

/** 同时押排序的距离：到可点范围中点；键盘分区取区间里离中点最近的点。 */
function touchDistance(touch: JudgeTouch, range: { middle: number }): number {
  const point = touch.span ? Math.min(touch.span[1], Math.max(touch.span[0], range.middle)) : touch.lane;
  return Math.abs(point - range.middle);
}

/** 原版 `_touched`（`ManualHoldNotePolicy.ProcessTouch` 顶部）：Hold 已起判且最近路由来的触摸不是 Canceled。 */
function touched(note: JudgeNote): boolean {
  return note.type === 1 && note.holdIndex !== -1 && note.touchPhase !== PHASE.canceled;
}

/** `DelayOrderNoteCollection.Add`：按 Just 升序、同刻按到区间中点的距离升序，单趟插入。 */
function insertCandidate<T extends { just: number; distance: number }>(list: T[], cand: T): void {
  const just = Math.fround(cand.just);
  for (let i = 0; i < list.length; i++) {
    const cur = list[i]!;
    if (Math.fround(Math.fround(cur.just) + JUST_EPSILON) >= just && cur.distance > cand.distance) {
      list.splice(i, 0, cand);
      return;
    }
  }
  list.push(cand);
}
