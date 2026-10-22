/**
 * LLLL 游玩输入：把指针 / 触摸 / 键盘事件归一成判定用的触摸事件。
 *
 * 判定引擎吃的是轨道坐标 `lane`，屏幕 → lane 的换算由渲染器通过 `opts.toLane(x, y)` 提供：
 * 3D 透视 / 2D 俯视 / SIF 半圆的投影各不相同，原版固定的 24px/lane 公式只在 1920 宽画布上
 * 与 3D 视觉对齐，所以 `screenXToLane` 只作 `toLane` 缺省时的兜底。判定引擎在
 * `views/llll.ts` 侧：每帧 `drain()` 取走事件，按 `time` 处理。
 *
 * 与判定引擎的约定：
 * - `lane` 是 0..59 的浮点轨道坐标（29.5 = 屏幕正中），越界与空点照常上报，由引擎自己判断。
 * - `time` 是判定用歌曲时间（秒，已叠加判定偏移）；判定偏移为负 = 判定提前。
 * - `id` 在按下到抬起之间稳定：指针用 `PointerEvent.pointerId`，键盘用 1_000_000 起的大号
 *   自增 id（浏览器 pointerId 从 1 起，不会撞）。
 * - 键盘按 `PlayKeyLayout`（见 `playKeys.ts`）：分区键带 `span`（整段 lane 区间），Air 键发一条 `air` 事件；
 *   `chordMs` 内一起按下的相邻分区键在 began 上带同一个 `chord`（同按组）。
 */

import { DEFAULT_PLAY_KEY_LAYOUT, lookupKey, type PlayKeyLayout } from './playKeys';

/** 60 条轨道（0..59）的浮点坐标跨度：29.5 = 屏幕正中。 */
export const PLAY_LANE_CENTER = 29.5;
/** 原版 `TapPositionResolveBase`：相邻 lane 中心的间距 = 24 × scale 设计 px。 */
export const PLAY_LANE_PITCH = 24;
/** WidthRate 的分母：原版按 1920 设计宽。 */
export const PLAY_WIDTH_BASE = 1920;
/** 宽屏判定阈值：画布宽高比 ≥ 16:9 时 scale 固定为 1。 */
export const PLAY_WIDE_RATIO = 16 / 9;

/** 判定偏移面板范围（毫秒）。 */
export const PLAY_OFFSET_MIN = -200;
export const PLAY_OFFSET_MAX = 200;

export type PlayTouchPhase = 'began' | 'moved' | 'stationary' | 'ended' | 'canceled';

export interface PlayTouch {
  /** 一次按下的稳定编号：指针 = pointerId，键盘 = 1_000_000 起的自增值。 */
  id: number;
  phase: PlayTouchPhase;
  /** 相对舞台画布左上角的 CSS px（画布被 CSS 缩放时按 `getBoundingClientRect()` 换算）。 */
  x: number;
  y: number;
  /** 0..59 的浮点轨道坐标，29.5 = 屏幕正中。 */
  lane: number;
  /** 判定用歌曲时间（秒，已叠加判定偏移）。 */
  time: number;
  /** true = 键盘来源（x/y 取对应轨道中心的固定点）。 */
  keyboard: boolean;
  /** 键盘分区键：按下即触碰的 lane 区间。 */
  span?: readonly [number, number];
  /** 键盘 Air 键（类 Chunithm 抬手上滑）：只发 began，不进按住表。 */
  air?: boolean;
  /** 键盘同按组（只在分区键的 began 上）：同一只手一起压下的相邻分区键共用一个编号。 */
  chord?: number;
}

/** 画布宽高比是否达到 16:9（宽屏判定）。 */
export function isWideStage(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return width / height >= PLAY_WIDE_RATIO;
}

/**
 * 相邻 lane 中心的间距（CSS px）。原版 `TapPositionResolveBase`：
 * `scale = 宽屏 ? 1 : max(1, WidthRate)`，间距 = `24 × scale`。
 *
 * WidthRate 在原版由 `ResolutionResolver` 按设备分辨率算出，仓库里没有现成定义；这里用
 * 「画布 CSS 宽 / 1920」作预览口径（主会话按 dump 的 ResolutionResolver 复核后可能要改这里）。
 */
function lanePitchPx(width: number, isWide: boolean): number {
  const widthRate = width / PLAY_WIDTH_BASE;
  const scale = isWide ? 1 : Math.max(1, widthRate);
  return PLAY_LANE_PITCH * scale;
}

/**
 * 屏幕 X → 轨道坐标（0..59，浮点）——**兜底公式，仅在 `opts.toLane` 缺省时使用**。
 *
 * 口径来自原版 `TapPositionResolveBase`：`scale = 宽屏 ? 1 : max(1, width/1920)`，
 * lane 中心间距 `24 × scale`，屏幕正中 = lane 29.5。它只在 1920 宽的画布上与 3D 视觉对齐；
 * 预览的 2D / SIF 相机与其它比例请由渲染器提供 `toLane`。
 */
export function screenXToLane(x: number, width: number, isWide: boolean): number {
  return (x - width * 0.5) / lanePitchPx(width, isWide) + PLAY_LANE_CENTER;
}

/** `screenXToLane` 的逆运算：轨道坐标 → 该轨道中心的屏幕 X（键盘事件拼 x 用）。 */
export function laneToScreenX(lane: number, width: number, isWide: boolean): number {
  return width * 0.5 + (lane - PLAY_LANE_CENTER) * lanePitchPx(width, isWide);
}

/**
 * 判定时钟 = 歌曲时间 + 判定偏移（秒）。触摸时刻与判定引擎的帧时钟都走这一个口径：
 * 只平移触摸时刻而不平移引擎时钟，超时 Miss 与 Hold 采样会按未偏移的时间先结算。
 */
export function playJudgeTime(songTime: number, offsetMs: number): number {
  return songTime + offsetMs / 1000;
}

/** 判定偏移夹到 −200..200 的整数毫秒；非有限值归 0。 */
export function clampPlayOffset(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.min(PLAY_OFFSET_MAX, Math.max(PLAY_OFFSET_MIN, Math.round(ms)));
}

export interface PlayInputOptions {
  /** 判定用歌曲时间（秒）；不含判定偏移，偏移由 PlayInput 自己叠加。 */
  clock: () => number;
  /**
   * 渲染器提供的屏幕 → lane 映射（画布 CSS 坐标，参数为相对画布左上角的 x/y）。
   * 3D / 2D / SIF 与任意画布比例都由它决定；缺省回落到 `screenXToLane` 兜底公式。
   */
  toLane?: (x: number, y: number) => number;
  /** 兜底公式的宽屏判定；缺省用画布宽高比 ≥ 16:9。 */
  isWide?: () => boolean;
  /** 画布 CSS 像素尺寸（不是 devicePixelRatio 后的 backing store 尺寸）；缺省取元素 rect。 */
  getSize?: () => { width: number; height: number };
  /**
   * 键盘监听目标，缺省 `document`（焦点在哪都能玩）。
   * Node 单测没有 DOM 时注入假 EventTarget；传 null 表示不监听键盘。
   */
  keyboardTarget?: EventTarget | null;
  /** 键位布局；缺省九区 `A S D F G H J K L` + 空格 Air。运行中用 `setKeyLayout` 换。 */
  keyLayout?: PlayKeyLayout;
  /**
   * 焦点控件是否自己消费这个键（消费则游玩输入不处理、不 preventDefault）。
   * 页面传 `keyboard.ts` 的 `controlOwnsKey`（按钮只吃 Space / Enter，鼠标点过的按钮连 Space 也还给页面）；
   * 缺省按「焦点在任意控件里」处理。
   */
  controlOwnsKey?: (target: EventTarget | null, code: string) => boolean;
}

/** 键盘 touch id 的起点：浏览器 pointerId 从 1 起，留足距离不会撞。 */
const KEYBOARD_TOUCH_ID_BASE = 1_000_000;

/**
 * 自己消费输入的控件：键盘焦点在其中时不抢键；指针在其上按下时不捕获、不上报
 * （舞台里叠着 3D / 2D / SIF 切换按钮，捕获会把它们的 click 改投到舞台上）。
 */
const CONTROL_SELECTOR = 'input, select, button, textarea, a, [contenteditable]:not([contenteditable="false"])';

type ClosestTarget = { closest?: (selector: string) => Element | null };

function isControlTarget(target: EventTarget | null | undefined): boolean {
  const element = target as ClosestTarget | null | undefined;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest(CONTROL_SELECTOR) !== null;
}

/**
 * 输入捕获：挂在舞台画布（或与画布同盒的容器）上，把事件攒进队列。
 *
 * 指针的 lane 走 `opts.toLane`（渲染器给的屏幕 → lane 映射），键盘按键位布局取分区（中心 lane + 区间）。
 * `attach()` 时把 `touch-action` / `user-select` 设为 `none`，`detach()` 还原原值；除了在按钮等
 * 控件上按下的指针，元素上的指针事件全部上报，不做位置过滤（空点、越界由判定引擎自己判断）。
 */
export class PlayInput {
  private readonly element: HTMLElement;
  private readonly opts: PlayInputOptions;
  private readonly queue: PlayTouch[] = [];
  /** 已按下（begin 未配对 end）的 pointerId。 */
  private readonly pointers = new Set<number>();
  /** 仍按住的指针最后位置：每帧补 stationary 事件（Unity 每帧都有 Stationary）。 */
  private readonly active = new Map<number, { lane: number; x: number; y: number; keyboard: boolean; span?: readonly [number, number] }>();
  /** 键盘 code → 本次按下的 touch id 与分区（keyup 配对用；按住期间改键位不影响这次按下）。 */
  private readonly keyIds = new Map<string, { id: number; lane: number; span: readonly [number, number] }>();
  private keyLayout: PlayKeyLayout;
  private nextKeyboardId = KEYBOARD_TOUCH_ID_BASE;
  /** 同按组：首键按下时刻（`KeyboardEvent.timeStamp`，毫秒）与组内分区序号。 */
  private chords: { id: number; start: number; zones: Set<number> }[] = [];
  private nextChordId = 1;
  private offsetMs = 0;
  private enabled = true;
  private attached = false;
  private keyTarget: EventTarget | null = null;
  /** attach 前的内联样式，detach 时原样写回。 */
  private savedStyle: { touchAction: string; userSelect: string } | null = null;

  constructor(element: HTMLElement, opts: PlayInputOptions) {
    this.element = element;
    this.opts = opts;
    this.keyLayout = opts.keyLayout ?? DEFAULT_PLAY_KEY_LAYOUT;
  }

  /** 换键位布局；已按住的键仍按按下时的分区松开。 */
  setKeyLayout(layout: PlayKeyLayout): void {
    this.keyLayout = layout;
  }

  /** 这个键位当前是否绑定为游玩键（分区或 Air）：页面快捷键据此让路。 */
  bindsKey(code: string): boolean {
    return lookupKey(this.keyLayout, code) !== null;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.savedStyle = {
      touchAction: this.element.style.touchAction,
      userSelect: this.element.style.userSelect,
    };
    this.element.style.touchAction = 'none';
    this.element.style.userSelect = 'none';
    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerUp);
    this.element.addEventListener('pointercancel', this.onPointerCancel);
    this.keyTarget =
      this.opts.keyboardTarget !== undefined
        ? this.opts.keyboardTarget
        : typeof document !== 'undefined'
          ? document
          : null;
    this.keyTarget?.addEventListener('keydown', this.onKeyDown);
    this.keyTarget?.addEventListener('keyup', this.onKeyUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerCancel);
    this.keyTarget?.removeEventListener('keydown', this.onKeyDown);
    this.keyTarget?.removeEventListener('keyup', this.onKeyUp);
    this.keyTarget = null;
    if (this.savedStyle) {
      this.element.style.touchAction = this.savedStyle.touchAction;
      this.element.style.userSelect = this.savedStyle.userSelect;
      this.savedStyle = null;
    }
    this.pointers.clear();
    this.keyIds.clear();
    this.chords = [];
    this.active.clear();
  }

  /** 自动演奏 / 非游玩状态关掉捕获；关掉时清空按下状态，避免再启用时把旧按点当成还在按。 */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.pointers.clear();
      this.keyIds.clear();
    this.chords = [];
      this.active.clear();
    }
  }

  /** 判定偏移（毫秒）：负值 = 判定提前。范围由设置面板负责，这里只挡非有限值。 */
  setOffsetMs(ms: number): void {
    if (Number.isFinite(ms)) this.offsetMs = ms;
  }

  getOffsetMs(): number {
    return this.offsetMs;
  }

  /** 取走累积事件（按发生顺序），清空队列。 */
  drain(): PlayTouch[] {
    if (!this.queue.length) return [];
    return this.queue.splice(0, this.queue.length);
  }

  /** 仍按住的指针补成 stationary 事件（Hold 采样依赖每帧有触摸）；`time` 缺省取当前判定时间。 */
  activePointers(time = this.judgeTime()): PlayTouch[] {
    return [...this.active].map(([id, p]) => ({
      id, phase: 'stationary' as const, x: p.x, y: p.y, lane: p.lane, time, keyboard: p.keyboard,
      ...(p.span ? { span: p.span } : {}),
    }));
  }

  /**
   * 一帧的判定输入：`time` 是该帧的判定时钟（`playJudgeTime`），判定引擎按它推进；
   * `touches` = 累积事件 + 仍按住指针在该时钟上的 stationary。
   */
  frame(songTime: number): { time: number; touches: PlayTouch[] } {
    const time = playJudgeTime(songTime, this.offsetMs);
    return { time, touches: [...this.drain(), ...this.activePointers(time)] };
  }

  /** 判定时间 = 歌曲时间 + 判定偏移。 */
  private judgeTime(): number {
    return playJudgeTime(this.opts.clock(), this.offsetMs);
  }

  private size(): { width: number; height: number } {
    const size = this.opts.getSize?.();
    if (size) return size;
    const rect = this.element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  private isWide(size: { width: number; height: number }): boolean {
    return this.opts.isWide?.() ?? isWideStage(size.width, size.height);
  }

  private emit(
    phase: PlayTouchPhase, id: number, x: number, y: number, lane: number, keyboard: boolean,
    span?: readonly [number, number], chord?: number,
  ): void {
    this.queue.push({
      id, phase, x, y, lane, time: this.judgeTime(), keyboard, ...(span ? { span } : {}), ...(chord === undefined ? {} : { chord }),
    });
    if (phase === 'ended' || phase === 'canceled') this.active.delete(id);
    else this.active.set(id, { lane, x, y, keyboard, ...(span ? { span } : {}) });
  }

  /** 指针的 lane 由渲染器 `toLane` 决定；缺省回落到兜底公式。 */
  private laneOf(x: number, y: number, size: { width: number; height: number }): number {
    return this.opts.toLane ? this.opts.toLane(x, y) : screenXToLane(x, size.width, this.isWide(size));
  }

  private pushPointer(phase: PlayTouchPhase, event: PointerEvent): void {
    // 画布可能被 CSS 缩放：用元素 rect 换算 CSS px，不用 devicePixelRatio。
    const rect = this.element.getBoundingClientRect();
    const size = this.opts.getSize?.() ?? { width: rect.width, height: rect.height };
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    this.emit(phase, event.pointerId, x, y, this.laneOf(x, y, size), false);
  }

  private pushKeyboard(
    phase: PlayTouchPhase, id: number, zone: { lane: number; span: readonly [number, number] }, chord?: number,
  ): void {
    const size = this.size();
    // 键盘没有屏幕坐标：lane / span 直接取分区（跳过 toLane），x/y 只按兜底公式补全事件字段。
    const x = laneToScreenX(zone.lane, size.width, this.isWide(size));
    this.emit(phase, id, x, size.height * 0.75, zone.lane, true, zone.span, chord);
  }

  /**
   * 分区键归入同按组：组首键按下后 `chordMs` 内、与组内某个分区相邻（序号差 ≤ 1）的键并入该组，
   * 否则开新组。窗口从组首键算起，不随后续键顺延（滑过整排键不会连成一组）。`chordMs = 0` 不分组。
   */
  private chordOf(zone: number, at: number): number | undefined {
    const windowMs = this.keyLayout.chordMs;
    if (!(windowMs > 0)) return undefined;
    this.chords = this.chords.filter((group) => at - group.start <= windowMs);
    const group = this.chords.find((g) => [...g.zones].some((z) => Math.abs(z - zone) <= 1));
    if (group) {
      group.zones.add(zone);
      return group.id;
    }
    const id = this.nextChordId++;
    this.chords.push({ id, start: at, zones: new Set([zone]) });
    return id;
  }

  /** Air 键：一次性事件，不进按住表（不补 stationary、没有 ended）。 */
  private pushAir(): void {
    const size = this.size();
    this.queue.push({
      id: this.nextKeyboardId++, phase: 'began', x: size.width / 2, y: size.height * 0.75,
      lane: PLAY_LANE_CENTER, time: this.judgeTime(), keyboard: true, air: true,
    });
  }

  private controlOwnsKey(target: EventTarget | null, code: string): boolean {
    return this.opts.controlOwnsKey ? this.opts.controlOwnsKey(target, code) : isControlTarget(target);
  }

  private releasePointer(id: number): void {
    try {
      if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
    } catch {
      // pointerup 之后浏览器可能已经自动释放捕获。
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || isControlTarget(event.target)) return;
    this.pointers.add(event.pointerId);
    try {
      // 捕获后 move / up 即使移出画布也会回到这个元素。
      this.element.setPointerCapture(event.pointerId);
    } catch {
      // 合成事件或指针已失效时浏览器会抛 NotFoundError：began 照常上报。
    }
    this.pushPointer('began', event);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.pointers.has(event.pointerId)) return;
    this.pushPointer('moved', event);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    this.releasePointer(event.pointerId);
    this.pushPointer('ended', event);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.pointers.delete(event.pointerId)) return;
    this.releasePointer(event.pointerId);
    this.pushPointer('canceled', event);
  };

  private readonly onKeyDown = (event: Event): void => {
    if (!this.enabled) return;
    const key = event as KeyboardEvent;
    // 浏览器快捷键（Ctrl+F 等）不抢。
    if (key.ctrlKey || key.metaKey || key.altKey) return;
    const target = lookupKey(this.keyLayout, key.code);
    if (target === null) return;
    // 焦点控件自己消费这个键时放行；在 preventDefault 之前判断。
    if (this.controlOwnsKey(key.target, key.code)) return;
    event.preventDefault();
    // 长按的重复 keydown 不重复 began（按住是一个 began + 一个 ended）。
    if (key.repeat) return;
    if (target.kind === 'air') {
      this.pushAir();
      return;
    }
    const id = this.nextKeyboardId++;
    const zone = { id, lane: target.lane, span: target.span };
    this.keyIds.set(key.code, zone);
    this.pushKeyboard('began', id, zone, this.chordOf(target.index, key.timeStamp));
  };

  private readonly onKeyUp = (event: Event): void => {
    const key = event as KeyboardEvent;
    const zone = this.keyIds.get(key.code);
    // 不是本输入子系统按下的分区键（例如焦点在输入框里敲的、Air 键）不产生 ended。
    if (zone === undefined) return;
    event.preventDefault();
    this.keyIds.delete(key.code);
    this.pushKeyboard('ended', zone.id, zone);
  };
}
