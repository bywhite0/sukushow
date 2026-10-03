/** 平面布局：轨道 = 横轴（60 格），时间 = 纵轴（**向上递增**）。
 *
 * 游戏是下落式的——未来的音符从上方落下。平面视图沿用同一朝向，
 * 0 秒在内容底部、总时长在顶部，读谱方向和游戏里一致。
 */

import type { Chart, Note } from './chart';

export const LANES = 60;

export interface Layout {
  /** 每格轨道宽度（像素）。 */
  lanePx: number;
  /** 每秒对应的纵向像素。 */
  pxPerSec: number;
  /** 左右留白。 */
  padX: number;
  /** 顶部留白。 */
  padY: number;
  /** 纵向滚动偏移（像素）。 */
  scrollPx: number;
  /** 左右镜像。 */
  mirror: boolean;
  /** 谱面总时长（秒）。时间轴向上，靠它把 0 秒锚在内容底部。 */
  duration: number;
}

export const defaultLayout = (): Layout => ({
  lanePx: 14, pxPerSec: 90, padX: 16, padY: 16, scrollPx: 0, mirror: false, duration: 0,
});

/** 格线 x 坐标：edge ∈ 0…60，为 lane−1 与 lane 的分界。 */
export function edgeX(edge: number, lay: Layout): number {
  return lay.padX + (lay.mirror ? LANES - edge : edge) * lay.lanePx;
}

/** 时间 → 画布 y。时间向上：0 秒在内容底部，`duration` 在顶部。 */
export function timeY(time: number, lay: Layout): number {
  return lay.padY + (lay.duration - time) * lay.pxPerSec - lay.scrollPx;
}

/** 画布 y → 时间。 */
export function yTime(y: number, lay: Layout): number {
  return lay.duration - (y - lay.padY + lay.scrollPx) / lay.pxPerSec;
}

/**
 * 让某时刻落在视口底边——即视口显示 `[time, time + 视口高/pxPerSec]` 这一段，
 * 时间是这段里最早的时刻。截图与「定位到」都用它。
 */
export function scrollToBottom(time: number, lay: Layout, viewportH: number): number {
  return lay.padY + (lay.duration - time) * lay.pxPerSec - viewportH;
}

/**
 * 让某时刻落在视口中的判定线位置。
 *
 * 2D 播放时与 3D 走带保持同一语义：当前时刻不随镜头上下漂移，
 * 而是通过推进 `scrollPx` 让未来音符向固定判定线靠近。
 */
export function scrollToLine(time: number, lay: Layout, lineY: number): number {
  return lay.padY + (lay.duration - time) * lay.pxPerSec - lineY;
}

/** 轨道栏总宽（像素）。 */
export function trackWidth(lay: Layout): number {
  return LANES * lay.lanePx;
}

/** 谱面在给定缩放下的总高（像素）。 */
export function contentHeight(chart: Chart, lay: Layout): number {
  return lay.padY * 2 + chart.duration * lay.pxPerSec;
}

/** 一个音符的横向范围（屏幕像素），已含镜像。 */
export function noteSpan(note: Note, lay: Layout, tail: boolean): [number, number] {
  const l = tail ? note.l2 : note.l, r = tail ? note.r2 : note.r;
  const a = edgeX(l, lay), b = edgeX(r + 1, lay);
  return a <= b ? [a, b] : [b, a];
}

export interface Rect { x: number; y: number; w: number; h: number }

/** 瞬时音符（Single / Flick / Trace）的矩形：纵向给最小可见厚度。 */
export function instantRect(note: Note, lay: Layout, minPx: number): Rect {
  const [x0, x1] = noteSpan(note, lay, false);
  const y = timeY(note.time, lay);
  return { x: x0, y: y - minPx / 2, w: Math.max(1, x1 - x0), h: minPx };
}

export interface Quad { p: [number, number][] }

/**
 * Hold 单个节点的四边形：头 [l,r] → 尾 [l2,r2]，中间线性。
 *
 * 时间向上，故头的 y 大于尾的 y。四角顺序统一为
 * 「头排左 → 头排右 → 尾排右 → 尾排左」，与 `slice.bandHalves` 一致。
 */
export function holdQuad(note: Note, lay: Layout): Quad {
  const [hl, hr] = noteSpan(note, lay, false);
  const [tl, tr] = noteSpan(note, lay, true);
  const y0 = timeY(note.time, lay), y1 = timeY(note.end, lay);
  return { p: [[hl, y0], [hr, y0], [tr, y1], [tl, y1]] };
}

/** 一条 Hold 链的全部节点四边形，顺序 = 源数组顺序。 */
export function chainQuads(root: Note, lay: Layout): Quad[] {
  const out: Quad[] = [];
  let node: Note | undefined = root;
  while (node) {
    if (node.end > node.time) out.push(holdQuad(node, lay));
    node = node.next;
  }
  return out;
}

/** 链的纵向范围（秒）。 */
export function chainEnd(root: Note): number {
  let tail = root;
  while (tail.next) tail = tail.next;
  return tail.end;
}

export interface Measure { time: number; strong: boolean }

/**
 * 小节线：沿 BPM 段与拍号段推进，每小节一条，段首为强拍。
 * `limit` 防止异常数据生成过多线。
 */
export function measures(chart: Chart, limit = 20000): Measure[] {
  const out: Measure[] = [];
  if (!chart.bpms.length) return out;
  const beats = chart.beats.length ? chart.beats : [{ numerator: 4, denominator: 4, time: chart.bpms[0].time }];
  const segments: { start: number; end: number; bpm: number; numerator: number }[] = [];
  const starts = [...new Set([...chart.bpms.map(b => b.time), ...beats.map(b => b.time)])].sort((a, b) => a - b);
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i], end = i + 1 < starts.length ? starts[i + 1] : chart.duration;
    if (end <= start) continue;
    const bpm = [...chart.bpms].reverse().find(b => b.time <= start)?.bpm ?? chart.bpms[0].bpm;
    const beat = [...beats].reverse().find(b => b.time <= start) ?? beats[0];
    segments.push({ start, end, bpm, numerator: Math.max(1, Math.round(beat.numerator)) });
  }
  for (const seg of segments) {
    const barSec = (60 / seg.bpm) * seg.numerator;
    if (!(barSec > 0)) continue;
    for (let t = seg.start; t < seg.end - 1e-6; t += barSec) {
      out.push({ time: t, strong: Math.abs(t - seg.start) < 1e-6 });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** 音符总数（含 Hold 链的全部节点）。 */
export function noteCount(chart: Chart): number {
  return chart.notes.length;
}
