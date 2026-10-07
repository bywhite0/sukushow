/**
 * 平面布局：轨道 = 横轴（60 格），时间 = 纵轴（**向上递增**）。
 *
 * 游戏是下落式的——未来的音符从上方落下。这里沿用同一朝向：0 秒在内容底部、
 * 总时长在顶部，读谱方向和游戏里一致。参考仓库 pjsekai-scores-rs 的 SVG 也是这个朝向
 * （`y = time_height × Δt(bar, barStop)`，以末小节为基准向上量）。
 *
 * 与 2D 谱面实现 的差别：那边是视口 + 滚动偏移（看局部），这边是整谱定尺（出图），
 * 故没有 `scrollPx`，`pxPerSec` 直接决定成图高度。
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
  /** 上下留白。 */
  padY: number;
  /** 左右镜像。 */
  mirror: boolean;
  /** 谱面总时长（秒）。时间轴向上，靠它把 0 秒锚在内容底部。 */
  duration: number;
  /**
   * 轨道**左侧**侧栏宽度（像素）。
   *
   * 参考仓库 `pjsekai-scores-rs` 把小节号、BPM、事件名竖排在轨道两侧；本仓库只留左侧。
   * 为 0 时不占位，成图宽度与不带侧栏时一致。
   */
  sideWidth: number;
}

export const defaultLayout = (): Layout => ({
  lanePx: 16, pxPerSec: 340, padX: 16, padY: 16, mirror: false, duration: 0, sideWidth: 0,
});

/** 格线 x 坐标：edge ∈ 0…60，为 lane−1 与 lane 的分界。侧栏占位在轨道左侧。 */
export function edgeX(edge: number, lay: Layout): number {
  const base = lay.padX + lay.sideWidth;
  return base + (lay.mirror ? LANES - edge : edge) * lay.lanePx;
}

/** 时间 → 画布 y。时间向上：0 秒在内容底部，`duration` 在顶部。 */
export function timeY(time: number, lay: Layout): number {
  return lay.padY + (lay.duration - time) * lay.pxPerSec;
}

/** 画布 y → 时间。 */
export function yTime(y: number, lay: Layout): number {
  return lay.duration - (y - lay.padY) / lay.pxPerSec;
}

/** 轨道栏总宽（像素）。 */
export function trackWidth(lay: Layout): number {
  return LANES * lay.lanePx;
}

/** 成图总宽（像素）。 */
export function canvasWidth(lay: Layout): number {
  return trackWidth(lay) + lay.sideWidth + lay.padX * 2;
}

/** 成图总高（像素）。 */
export function contentHeight(chart: Chart, lay: Layout): number {
  return lay.padY * 2 + chart.duration * lay.pxPerSec;
}

/** 一个音符的横向范围（画布像素），已含镜像。 */
export function noteSpan(note: Note, lay: Layout, tail: boolean): [number, number] {
  const l = tail ? note.l2 : note.l, r = tail ? note.r2 : note.r;
  const a = edgeX(l, lay), b = edgeX(r + 1, lay);
  return a <= b ? [a, b] : [b, a];
}

export interface Quad { p: [number, number][] }

/**
 * Hold 单个节点的四边形：头 [l,r] → 尾 [l2,r2]，中间线性。
 *
 * 时间向上，故头的 y 大于尾的 y。四角顺序统一为
 * 「头排左 → 头排右 → 尾排右 → 尾排左」，与 `geometry.bandHalves` 一致。
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

/** 链的纵向末端时刻（秒）。 */
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

/**
 * 小节序号（1 起）。与 `measures` 同律推进，用于给每小节标号。
 * 返回 `time → 序号` 的升序数组。
 */
export function barNumbers(chart: Chart, limit = 20000): { time: number; bar: number; strong: boolean }[] {
  return measures(chart, limit).map((m, i) => ({ ...m, bar: i + 1 }));
}
