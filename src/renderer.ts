/**
 * 平面谱面渲染：Canvas 2D，横轴 = 60 格轨道，纵轴 = 时间。
 *
 * 音符外观与 Hold 宽带沿用原版：贴图取自 `ui_sc2_ingame_notes_*`，横向九宫格拉伸，
 * Hold 走三列顶点色宽带（左/右列 SideColor、中列 CenterColor）。几何口径见 `slice.ts`。
 */

import type { Chart, Note } from './chart';
import {
  type Layout, chainEnd, contentHeight, edgeX, noteSpan, measures, timeY, trackWidth,
} from './view';
import {
  type BandHalf, type SpriteMeta, NOTE_SPRITE, chainBandHalves, cssRgba,
  laneX, noteSpriteSize, sliceCaps,
} from './slice';

/** 未加载到贴图时的兜底配色，沿用原版四类。 */
const FALLBACK: readonly string[] = ['#ff5eab', '#2ec6ff', '#ff5eab', '#54d6ef'];
const LANE_TYPE_NAME = ['Single', 'Hold', 'Flick', 'Trace'] as const;

export interface RenderStats {
  /** 视口内绘制的音符节点数（含 Hold 链节点）。 */
  drawn: number;
  /** 视口内绘制的瞬时音符数。 */
  instants: number;
  /** 视口内绘制的 Hold 宽带半边数。 */
  holds: number;
  /** 谱面音符总数。 */
  total: number;
  /** 贴图是否已就绪。 */
  textured: boolean;
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

/** 音符贴图与九宫格元数据；由 `loadSprites` 填充。 */
export interface SpriteLibrary {
  images: (HTMLImageElement | undefined)[];
  meta: (SpriteMeta | undefined)[];
}

export const emptyLibrary = (): SpriteLibrary => ({ images: [], meta: [] });

/** 载入四类音符贴图与九宫格边距；任一缺失即回退为纯色矩形。 */
export async function loadSprites(base = '/rg'): Promise<SpriteLibrary> {
  const lib = emptyLibrary();
  let meta: Record<string, SpriteMeta> = {};
  try {
    const res = await fetch(`${base}/sprite_meta.json`);
    if (res.ok) meta = (await res.json()) as Record<string, SpriteMeta>;
  } catch { /* 回退纯色 */ }
  lib.images = NOTE_SPRITE.map(() => undefined);
  lib.meta = NOTE_SPRITE.map(name => meta[name]);
  await Promise.all(NOTE_SPRITE.map((name, i) => new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => { lib.images[i] = img; resolve(); };
    img.onerror = () => resolve();
    img.src = `${base}/sprites/${name}.png`;
  })));
  return lib;
}

export class FlatRenderer {
  private ctx: CanvasRenderingContext2D;
  private cache: { chart: Chart; measures: ReturnType<typeof measures> } | null = null;
  private lib: SpriteLibrary = emptyLibrary();

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');
    this.ctx = ctx;
  }

  setLibrary(lib: SpriteLibrary) { this.lib = lib; }

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
    return { ...stats, total: chart.notes.length, textured: this.textured() };
  }

  private textured(): boolean {
    return this.lib.images.some(Boolean);
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
      const img = this.lib.images[type];
      const meta = this.lib.meta[type];
      if (!img || !meta) ctx.fillStyle = FALLBACK[type];
      for (const n of chart.notes) {
        if (n.type !== type || n.prev) continue;
        if (n.time < topTime - 1 || n.time > bottomTime + 1) continue;
        const [x0, x1] = noteSpan(n, lay, false);
        const y = timeY(n.time, lay);
        if (img && meta) {
          this.drawSliced(img, meta, x0, y, Math.max(1, x1 - x0), n.r - n.l + 1, type, lay);
        } else {
          const th = Math.max(instantPx, noteSpriteSize(n.r - n.l + 1, type, lay).h);
          ctx.fillRect(x0, y - th / 2, Math.max(1, x1 - x0), th);
        }
        drawn++; instants++;
      }
    }

    // Hold 宽带：三列顶点色，逐节点画两条半边，顺序 = 源数组顺序。
    for (const root of chart.roots) {
      if (root.type !== 1) continue;
      const end = chainEnd(root);
      if (end < topTime - 1 || root.time > bottomTime + 1) continue;
      for (const half of chainBandHalves(root, lay)) {
        const ys = half.corners.map(c => c[1]);
        if (Math.min(...ys) > h + 4 || Math.max(...ys) < -4) continue;
        this.paintBand(half);
        drawn++; holds++;
      }
      // 头尾端头贴图（原版 Silhouette / Silhouette-End）。
      let tail = root; while (tail.next) tail = tail.next;
      this.paintCap(root, root.time, root.l, root.r, lay, topTime, bottomTime);
      this.paintCap(tail, tail.end, tail.l2, tail.r2, lay, topTime, bottomTime);
    }
    return { drawn, instants, holds };
  }

  /** Hold 头 / 尾的端头贴图，与瞬时音符同款九宫格。 */
  private paintCap(n: Note, time: number, l: number, r: number, lay: Layout, topTime: number, bottomTime: number) {
    if (time < topTime - 1 || time > bottomTime + 1) return;
    const img = this.lib.images[1];
    const meta = this.lib.meta[1];
    if (!img || !meta) return;
    const x0 = laneX(l, lay), x1 = laneX(r + 1, lay);
    const a = Math.min(x0, x1), b = Math.max(x0, x1);
    this.drawSliced(img, meta, a, timeY(time, lay), Math.max(1, b - a), r - l + 1, 1, lay);
  }

  /** 一个宽带半边：横向从一列渐变到另一列。 */
  private paintBand(half: BandHalf) {
    const ctx = this.ctx;
    const [a, b, c, d] = half.corners;
    const grad = ctx.createLinearGradient(half.gradFrom[0], half.gradFrom[1], half.gradTo[0], half.gradTo[1]);
    grad.addColorStop(0, cssRgba(half.fromColor));
    grad.addColorStop(1, cssRgba(half.toColor));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
    ctx.fill();
  }

  /** 九宫格横向拉伸：左右端头原样、中段拉伸，纵向整体缩放到原版厚度。 */
  private drawSliced(
    img: HTMLImageElement, meta: SpriteMeta, x0: number, yCenter: number,
    targetW: number, widthUnits: number, type: number, lay: Layout,
  ) {
    const ctx = this.ctx;
    const { w: worldW, h: worldH } = noteSpriteSize(widthUnits, type, lay);
    const w = Math.max(targetW, worldW);
    const h = Math.max(2, worldH);
    const rect = meta.rect;
    const sw = rect[2] || img.naturalWidth, sh = rect[3] || img.naturalHeight;
    const caps = sliceCaps(meta, worldW);
    const scale = worldW > 0 ? w / worldW : 1;
    const left = caps.left * scale, right = caps.right * scale;
    const mid = Math.max(0, w - left - right);
    const x = x0 + (targetW - w) / 2;
    const y = yCenter - h / 2;
    const uL = caps.uL, uR = caps.uR;
    const draw = (dx: number, dw: number, sx: number, sWidth: number) => {
      if (dw <= 0.01 || sWidth <= 0.01) return;
      ctx.drawImage(img, sx, 0, sWidth, sh, dx, y, dw, h);
    };
    // 端头若超出目标宽度，sliceCaps 已按比例缩小，三段仍首尾相接。
    draw(x, left, 0, sw * uL);
    draw(x + left, mid, sw * uL, sw * (1 - uL - uR));
    draw(x + left + mid, right, sw * (1 - uR), sw * uR);
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
