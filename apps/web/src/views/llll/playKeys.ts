/**
 * LLLL 游玩键位：60 轨等分成 N 个分区，每区绑一个键；另有一个 Air 键（类 Chunithm 抬手上滑）。
 *
 * 原版只有触摸输入，键位整体是预览自有口径：
 * - 分区按键 = 同时触碰该分区的整个 lane 区间（判定引擎按区间与可点范围求交），分区再少也不会有音符落空；
 * - Air 键在键盘起手的 Flick 的 `FlickValidTime` 内按下即完成划动；不设 Air 键时键盘 Flick 起手即完成；
 * - 同按合并：`chordMs` 内一起按下的相邻分区键算同一只手（同一个同按组），合起来只按一个音符（同时押除外），
 *   避免手台上一只手压到好几个分区时多出来的键去抢后面的音符。
 *
 * 键位用 `KeyboardEvent.code`（物理键位，与输入法、键盘布局无关）。布局对象视为不可变，修改都返回新对象。
 */

/** 60 条轨道（0..59）在浮点 lane 坐标上的外边界：lane i 占 [i − 0.5, i + 0.5]。 */
export const LANE_EDGE_LEFT = -0.5;
export const LANE_EDGE_RIGHT = 59.5;
export const PLAY_ZONES_MIN = 1;
export const PLAY_ZONES_MAX = 16;
/** 同按合并窗口（毫秒）：0 = 不合并。 */
export const PLAY_CHORD_MS_DEFAULT = 30;
export const PLAY_CHORD_MS_MAX = 80;

export interface PlayKeyLayout {
  /** 从左到右每个分区的键位（`KeyboardEvent.code`），长度即分区数。 */
  readonly zones: readonly string[];
  /** Air 键；null = 不用 Air，键盘 Flick 起手即完成。 */
  readonly air: string | null;
  /** 同按合并窗口（毫秒，0..80）：窗口内一起按下的相邻分区键归同一个同按组。 */
  readonly chordMs: number;
}

/** 默认：九区 `A S D F G H J K L`（区中心即 SIF 9 等分的中线），Air 为空格。 */
export const DEFAULT_PLAY_KEY_LAYOUT: PlayKeyLayout = {
  zones: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'],
  air: 'Space',
  chordMs: PLAY_CHORD_MS_DEFAULT,
};

/** 分区数加大时按顺序补位的键池（先中排、再上排、再下排）。 */
const KEY_POOL = [
  'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote',
  'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
  'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM',
];

/** 不能绑定：Esc 用于取消录入，Tab 留给焦点导航；Ctrl / Alt / Meta 按下时游玩输入整体不处理。 */
const RESERVED = new Set(['Escape', 'Tab', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight']);

export function isBindableKey(code: string): boolean {
  return /^[A-Za-z0-9]+$/.test(code) && !RESERVED.has(code);
}

/** 第 `index` 个分区（共 `count` 个）的 lane 区间：把 [-0.5, 59.5] 等分。 */
export function zoneSpan(index: number, count: number): [number, number] {
  const width = (LANE_EDGE_RIGHT - LANE_EDGE_LEFT) / count;
  return [LANE_EDGE_LEFT + width * index, LANE_EDGE_LEFT + width * (index + 1)];
}

export type PlayKeyTarget =
  | { kind: 'zone'; index: number; lane: number; span: readonly [number, number] }
  | { kind: 'air' };

/** 按键位找分区或 Air；未绑定返回 null。 */
export function lookupKey(layout: PlayKeyLayout, code: string): PlayKeyTarget | null {
  if (layout.air !== null && code === layout.air) return { kind: 'air' };
  const index = layout.zones.indexOf(code);
  if (index < 0) return null;
  const span = zoneSpan(index, layout.zones.length);
  return { kind: 'zone', index, lane: (span[0] + span[1]) / 2, span };
}

/** 改分区数：保留左侧已有的键，新增分区按键池补未占用的键。 */
export function resizeLayout(layout: PlayKeyLayout, count: number): PlayKeyLayout {
  const n = Math.min(PLAY_ZONES_MAX, Math.max(PLAY_ZONES_MIN, Math.trunc(count)));
  const zones = layout.zones.slice(0, n);
  const used = new Set<string>([...zones, ...(layout.air === null ? [] : [layout.air])]);
  for (const code of KEY_POOL) {
    if (zones.length >= n) break;
    if (!used.has(code)) { zones.push(code); used.add(code); }
  }
  return { ...layout, zones };
}

export type PlayKeySlot = number | 'air';

/**
 * 把 `code` 绑到 `slot`。已被别的槽占用时两边互换；
 * 只有「Air 为空、要抢分区的键」这一种换不了（分区不能没有键），返回错误说明。
 */
export function assignKey(layout: PlayKeyLayout, slot: PlayKeySlot, code: string): { layout: PlayKeyLayout } | { error: string } {
  if (!isBindableKey(code)) return { error: `${keyLabel(code)} 不能用作游玩键位。` };
  const zones = [...layout.zones];
  let air = layout.air;
  const current = slot === 'air' ? air : zones[slot]!;
  if (current === code) return { layout };
  const holder = air === code ? 'air' : zones.indexOf(code);
  if (holder !== -1) {
    if (holder !== 'air' && current === null) {
      return { error: `${keyLabel(code)} 已用于分区 ${holder + 1}，先给 Air 设别的键或改掉那个分区。` };
    }
    if (holder === 'air') air = current;
    else zones[holder] = current!;
  }
  if (slot === 'air') air = code;
  else zones[slot] = code;
  return { layout: { ...layout, zones, air } };
}

/** 同按合并窗口夹到 0..80 的整数毫秒；缺省或非有限值取默认。 */
export function clampChordMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PLAY_CHORD_MS_DEFAULT;
  return Math.min(PLAY_CHORD_MS_MAX, Math.max(0, Math.round(value)));
}

/** 读存档：键位结构不对、不可绑或有重复时键位回到默认；同按窗口单独校验（旧存档没有这一项也不丢键位）。 */
export function sanitizePlayKeyLayout(raw: unknown): PlayKeyLayout {
  if (!raw || typeof raw !== 'object') return DEFAULT_PLAY_KEY_LAYOUT;
  const { zones, air, chordMs } = raw as { zones?: unknown; air?: unknown; chordMs?: unknown };
  const fallback = { ...DEFAULT_PLAY_KEY_LAYOUT, chordMs: clampChordMs(chordMs) };
  if (!Array.isArray(zones) || zones.length < PLAY_ZONES_MIN || zones.length > PLAY_ZONES_MAX) return fallback;
  if (!zones.every((code): code is string => typeof code === 'string' && isBindableKey(code))) return fallback;
  if (air !== null && (typeof air !== 'string' || !isBindableKey(air))) return fallback;
  const all = air === null ? zones : [...zones, air];
  if (new Set(all).size !== all.length) return fallback;
  return { zones: [...zones], air, chordMs: fallback.chordMs };
}

const SYMBOLS: Record<string, string> = {
  Space: '空格', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
  ShiftLeft: '左 Shift', ShiftRight: '右 Shift', Enter: 'Enter', Backspace: 'Backspace',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
};

/** 键位的显示名：`KeyA` → A、`Digit1` → 1、`Numpad1` → Num 1，符号键给字符。 */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return SYMBOLS[code] ?? code;
}
