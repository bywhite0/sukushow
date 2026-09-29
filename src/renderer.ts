/** 平面谱面渲染：Canvas 2D，横轴 = 60 格轨道，纵轴 = 时间。 */

import type { Chart, Note } from './chart';
import {
  type Layout, chainEnd, chainQuads, contentHeight, edgeX, instantRect,
  measures, noteSpan, timeY, trackWidth,
} from './view';

/** 音符配色沿用原版四类：Single / Hold / Flick / Trace。 */
const COLORS: readonly [number, number, number][] = [
  [1, 0.37, 0.67], [0.18, 0.78, 1], [1, 0.37, 0.67], [0.33, 0.84, 0.94],
];
const FILL: readonly string[] = COLORS.map(c => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`);
const FILL_DIM: readonly string[] = COLORS.map(c => `rgba(${c.map(v => Math.round(v * 255)).join(' ')},.72)`);
const LANE_TYPE_NAME = ['Single', 'Hold', 'Flick', 'Trace'] as const;

export interface RenderStats {
  /** 视口内绘制的音符节点数（含 Hold 链节点）。 */
  drawn: number;
  /** 视口内绘制的瞬时音符数。 */
  instants: number;
  /** 视口内绘制的 Hold 四边形数。 */
  holds: number;
  /** 谱面音符总数。 */
  total: number;
}

export interface RenderOptions {
  layout: Layout;
  /** 瞬时音符最小厚度（像素）。 */
  instantPx: number;
  /** 是否画小节线。 */
  showMeasures: boolean;
  /** 是否画同时押连线。 */
  showSimultaneous: boolean;
  /** 是否画轨道格线。 */
  showGrid: boolean;
}

export class FlatRenderer {
  private ctx: CanvasRenderingContext2D;
  private cache: { chart: Chart; measures: ReturnType<typeof measures> } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');
    this.ctx = ctx;
  }

  /** 谱面或拍号相关的预计算在换谱时重建。 */
  private prepared(chart: Chart) {
    if (this.cache?.chart !== chart) this.cache = { chart, measures: measures(chart) };
    return this.cache;
  }

  resize(): { w: number; h: number } {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    return { w, h };
  }

  render(chart: Chart, opt: RenderOptions): RenderStats {
    const { w, h } = this.resize();
    const dpr = this.canvas.width / Math.max(1, w);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const lay = opt.layout;
    const { measures: ms } = this.prepared(chart);
    const trackW = trackWidth(lay);
    const top = lay.padY - lay.scrollPx;
    const bottom = top + chart.duration * lay.pxPerSec;

    this.paintBackdrop(lay, trackW, h, top, bottom);
    if (opt.showMeasures) this.paintMeasures(ms, lay, trackW, h);
    if (opt.showGrid) this.paintGrid(lay, h);
    if (opt.showSimultaneous) this.paintSimultaneous(chart, lay, h);

    const stats = this.paintNotes(chart, lay, opt.instantPx, h);
    return { ...stats, total: chart.notes.length };
  }

  private paintBackdrop(lay: Layout, trackW: number, h: number, top: number, bottom: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0f1622';
    ctx.fillRect(lay.padX, Math.max(0, top), trackW, Math.min(h, bottom) - Math.max(0, top));
    ctx.fillStyle = 'rgba(84,214,239,.55)';
    ctx.fillRect(edgeX(0, lay), Math.max(0, top), 1.5, Math.min(h, bottom) - Math.max(0, top));
    ctx.fillRect(edgeX(60, lay) - 1.5, Math.max(0, top), 1.5, Math.min(h, bottom) - Math.max(0, top));
  }

  private paintGrid(lay: Layout, h: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(219,225,236,.10)';
    for (let lane = 1; lane < 60; lane++) {
      if (lane % 5 === 0) continue;
      ctx.fillRect(edgeX(lane, lay), 0, 1, h);
    }
    ctx.fillStyle = 'rgba(219,225,236,.24)';
    for (let lane = 5; lane < 60; lane += 5) ctx.fillRect(edgeX(lane, lay), 0, 1, h);
  }

  private paintMeasures(ms: ReturnType<typeof measures>, lay: Layout, trackW: number, h: number) {
    const ctx = this.ctx;
    for (const m of ms) {
      const y = timeY(m.time, lay);
      if (y < -2 || y > h + 2) continue;
      ctx.fillStyle = m.strong ? 'rgba(237,94,170,.55)' : 'rgba(219,225,236,.20)';
      ctx.fillRect(lay.padX, y, trackW, m.strong ? 1.5 : 1);
    }
  }

  private paintSimultaneous(chart: Chart, lay: Layout, h: number) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(216,240,255,.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const line of chart.lines) {
      const y = timeY(line.time, lay);
      if (y < -2 || y > h + 2) continue;
      let min = Infinity, max = -Infinity;
      for (const p of line.points) {
        const [a, b] = noteSpan(p.note, lay, p.tail);
        if (a < min) min = a;
        if (b > max) max = b;
      }
      ctx.moveTo(min, y);
      ctx.lineTo(max, y);
    }
    ctx.stroke();
  }

  private paintNotes(chart: Chart, lay: Layout, instantPx: number, h: number) {
    const ctx = this.ctx;
    const topTime = (0 - lay.padY + lay.scrollPx) / lay.pxPerSec;
    const bottomTime = (h - lay.padY + lay.scrollPx) / lay.pxPerSec;
    let drawn = 0, instants = 0, holds = 0;

    // 瞬时音符：同类型合批，减少状态切换。
    for (let type = 0; type < 4; type++) {
      if (type === 1) continue;
      ctx.fillStyle = FILL[type];
      for (const n of chart.notes) {
        if (n.type !== type || n.prev) continue;
        if (n.time < topTime - 1 || n.time > bottomTime + 1) continue;
        const r = instantRect(n, lay, instantPx);
        ctx.fillRect(r.x, r.y, r.w, r.h);
        drawn++; instants++;
      }
    }

    // Hold 链：按源顺序逐节点画四边形，节点头尾相接即连成折返路径。
    ctx.fillStyle = FILL_DIM[1];
    for (const root of chart.roots) {
      if (root.type !== 1) continue;
      const end = chainEnd(root);
      if (end < topTime - 1 || root.time > bottomTime + 1) continue;
      for (const q of chainQuads(root, lay)) {
        if (q.p[0][1] > h + 4 || q.p[2][1] < -4) continue;
        ctx.beginPath();
        ctx.moveTo(q.p[0][0], q.p[0][1]);
        ctx.lineTo(q.p[1][0], q.p[1][1]);
        ctx.lineTo(q.p[2][0], q.p[2][1]);
        ctx.lineTo(q.p[3][0], q.p[3][1]);
        ctx.closePath();
        ctx.fill();
        drawn++; holds++;
      }
    }
    return { drawn, instants, holds };
  }

  /** 命中测试：返回鼠标位置下的音符（先 Hold 后瞬时，取纵向最近者）。 */
  hitTest(chart: Chart, lay: Layout, x: number, y: number, instantPx: number, radius = 6): Note | null {
    const t = (y - lay.padY + lay.scrollPx) / lay.pxPerSec;
    let best: Note | null = null, bestDist = Infinity;
    for (const root of chart.roots) {
      if (root.type === 1) {
        const end = chainEnd(root);
        if (t < root.time - 0.05 || t > end + 0.05) continue;
        let node: Note | undefined = root;
        while (node) {
          if (t >= node.time && t <= node.end) {
            const [a, b] = noteSpan(node, lay, false);
            if (x >= a - radius && x <= b + radius) {
              const d = Math.abs(t - (node.time + node.end) / 2);
              if (d < bestDist) { bestDist = d; best = node; }
            }
          }
          node = node.next;
        }
        continue;
      }
      if (Math.abs(t - root.time) > Math.max(0.05, instantPx / lay.pxPerSec)) continue;
      const [a, b] = noteSpan(root, lay, false);
      if (x < a - radius || x > b + radius) continue;
      const d = Math.abs(t - root.time);
      if (d < bestDist) { bestDist = d; best = root; }
    }
    return best;
  }
}

export function noteLabel(note: Note): string {
  const name = LANE_TYPE_NAME[note.type] ?? 'Unknown';
  const span = note.l === note.r ? `轨道 ${note.l}` : `轨道 ${note.l}–${note.r}`;
  const parts = [`#${note.uid}`, name, span, `${note.time.toFixed(3)}s`];
  if (note.type === 1) {
    parts.push(`→ ${note.end.toFixed(3)}s（${(note.end - note.time).toFixed(3)}s）`);
    if (note.l2 !== note.l || note.r2 !== note.r) parts.push(`终点 ${note.l2}–${note.r2}`);
    if (note.holds.length > 1) parts.push(`${note.holds.length} 航点`);
  }
  return parts.join(' · ');
}

export function chartBounds(chart: Chart, lay: Layout) {
  return { width: lay.padX * 2 + trackWidth(lay), height: contentHeight(chart, lay) };
}
