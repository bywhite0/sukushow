/**
 * 平面谱面渲染：Canvas 2D，横轴 = 60 格轨道，纵轴 = 时间。
 *
 * 音符外观与 Hold 宽带沿用原版：贴图取自 `ui_sc2_ingame_notes_*`，横向九宫格拉伸，
 * Hold 走三列顶点色宽带（左/右列 SideColor、中列 CenterColor）。几何口径见 `slice.ts`。
 */

import type { Chart, Note } from './chart';
import {
  type Layout, chainEnd, contentHeight, edgeX, noteSpan, measures, timeY, trackWidth, yTime,
} from './view';
import {
  type BandHalf, type FlickOverlay, type SpriteMeta, NOTE_SPRITE, SPRITE_SCALE_X,
  FLICK_ARROW, FLICK_ICON, FLICK_SIGN, chainBandHalves, cssRgba, flickOverlays,
  laneX, noteDepthWorld, noteWidthWorld, pxPerWorld, sliceCaps,
} from './slice';

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
  /** Flick 附加元素（箭头、Sign），按 `FLICK_EXTRA` 顺序。 */
  extra: { images: (HTMLImageElement | undefined)[]; meta: (SpriteMeta | undefined)[] };
}

/** Flick 附加元素的贴图顺序。 */
const FLICK_EXTRA = [FLICK_ARROW, FLICK_ICON, FLICK_SIGN] as const;

export const emptyLibrary = (): SpriteLibrary => ({ images: [], meta: [], extra: { images: [], meta: [] } });

/** 载入四类音符贴图与九宫格边距。 */
export async function loadSprites(base = '/rg'): Promise<SpriteLibrary> {
  const lib = emptyLibrary();
  const res = await fetch(`${base}/sprite_meta.json`);
  if (!res.ok) throw new Error(`无法载入贴图元数据：${res.status}`);
  const meta = (await res.json()) as Record<string, SpriteMeta>;
  lib.images = NOTE_SPRITE.map(() => undefined);
  lib.meta = NOTE_SPRITE.map(name => meta[name]);
  lib.extra.images = FLICK_EXTRA.map(() => undefined);
  lib.extra.meta = FLICK_EXTRA.map(name => meta[name]);
  for (const name of [...NOTE_SPRITE, ...FLICK_EXTRA]) {
    if (!meta[name]) throw new Error(`贴图元数据缺少 ${name}`);
  }
  const load = (names: readonly string[], images: (HTMLImageElement | undefined)[]) =>
    Promise.all(names.map((name, i) => new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images[i] = img; resolve(); };
      img.onerror = () => reject(new Error(`无法载入贴图：${name}`));
      img.src = `${base}/sprites/${name}.png`;
    })));
  await Promise.all([
    load(NOTE_SPRITE, lib.images),
    load(FLICK_EXTRA, lib.extra.images),
  ]);
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
    // 时间向上：画布顶边对应更晚的时刻，故这里取 min/max 而非上下。
    const tA = yTime(0, lay), tB = yTime(h, lay);
    const tMin = Math.min(tA, tB), tMax = Math.max(tA, tB);
    let drawn = 0, instants = 0, holds = 0;

    // 瞬时音符：同类型合批，减少状态切换。
    for (let type = 0; type < 4; type++) {
      if (type === 1) continue;
      const img = this.lib.images[type];
      const meta = this.lib.meta[type];
      for (const n of chart.notes) {
        if (n.type !== type || n.prev) continue;
        if (n.time < tMin - 1 || n.time > tMax + 1) continue;
        const [x0, x1] = noteSpan(n, lay, false);
        const y = timeY(n.time, lay);
        if (!img || !meta) continue;
        this.drawSliced(img, meta, (x0 + x1) / 2, y, n.r - n.l + 1, type, lay);
        // Flick 的箭头与 Sign 叠加在本体之上（原版 sortingOrder 21 / 25）。
        if (type === 2) this.paintFlick(n, lay);
        drawn++; instants++;
      }
    }

    // Hold 宽带：三列顶点色，逐节点画两条半边，顺序 = 源数组顺序。
    for (const root of chart.roots) {
      if (root.type !== 1) continue;
      const end = chainEnd(root);
      if (end < tMin - 1 || root.time > tMax + 1) continue;
      for (const half of chainBandHalves(root, lay)) {
        const ys = half.corners.map(c => c[1]);
        if (Math.min(...ys) > h + 4 || Math.max(...ys) < -4) continue;
        this.paintBand(half);
        drawn++; holds++;
      }
      // 头尾端头贴图（原版 Silhouette / Silhouette-End）。
      let tail = root; while (tail.next) tail = tail.next;
      this.paintCap(root, root.time, root.l, root.r, lay, tMin, tMax);
      this.paintCap(tail, tail.end, tail.l2, tail.r2, lay, tMin, tMax);
    }
    return { drawn, instants, holds };
  }

  /** Hold 头 / 尾的端头贴图，与瞬时音符同款九宫格。 */
  private paintCap(n: Note, time: number, l: number, r: number, lay: Layout, tMin: number, tMax: number) {
    if (time < tMin - 1 || time > tMax + 1) return;
    const img = this.lib.images[1];
    const meta = this.lib.meta[1];
    if (!img || !meta) return;
    const x0 = laneX(l, lay), x1 = laneX(r + 1, lay);
    this.drawSliced(img, meta, (x0 + x1) / 2, timeY(time, lay), r - l + 1, 1, lay);
  }

  /**
   * Flick 的三层附加元素：箭头（横向平铺）、Symbol、Sign。
   * 缺贴图时静默跳过——它们只是装饰，不影响音符本体。
   */
  private paintFlick(n: Note, lay: Layout) {
    const [arrowMeta, iconMeta, signMeta] = this.lib.extra.meta;
    if (!arrowMeta && !iconMeta && !signMeta) return;
    const overlays = flickOverlays(n, lay, { arrow: arrowMeta, icon: iconMeta, sign: signMeta });
    for (const o of overlays) {
      const img = o.kind === 'arrow' ? this.lib.extra.images[0]
        : o.kind === 'icon' ? this.lib.extra.images[1] : this.lib.extra.images[2];
      const meta = o.kind === 'arrow' ? arrowMeta : o.kind === 'icon' ? iconMeta : signMeta;
      if (!img || !meta || o.w <= 0.01 || o.h <= 0.01) continue;
      const sw = meta.rect[2] || img.naturalWidth, sh = meta.rect[3] || img.naturalHeight;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(o.cx, o.cy);
      if (o.flip) ctx.scale(-1, 1);
      if (o.kind === 'arrow' && o.tile > 0.5) {
        // 原版靠 UV repeat 平铺：重复次数 = 目标宽 / 单块宽，可为小数，
        // 故最后一块按剩余宽度裁源图，不做取整。
        const step = o.tile, total = o.w, x0 = -total / 2;
        let x = x0;
        while (x < x0 + total - 0.5) {
          const wRemain = Math.min(step, x0 + total - x);
          ctx.drawImage(img, 0, 0, sw * (wRemain / step), sh, x, -o.h / 2, wRemain, o.h);
          x += step;
        }
      } else {
        ctx.drawImage(img, 0, 0, sw, sh, -o.w / 2, -o.h / 2, o.w, o.h);
      }
      ctx.restore();
    }
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

  /** 九宫格横向拉伸：左右端头保持原生尺寸（圆角不变形），仅中段拉伸。 */
  private drawSliced(
    img: HTMLImageElement, meta: SpriteMeta, centerX: number, yCenter: number,
    widthUnits: number, type: number, lay: Layout,
  ) {
    const ctx = this.ctx;
    const k = pxPerWorld(lay);
    // 世界单位：与 sliceCaps 同口径，避免把像素宽当成世界宽。
    const worldW = noteWidthWorld(widthUnits) * SPRITE_SCALE_X;
    const w = worldW * k;
    const h = Math.max(2, noteDepthWorld(type) * SPRITE_SCALE_X * k);
    const rect = meta.rect;
    const sw = rect[2] || img.naturalWidth, sh = rect[3] || img.naturalHeight;
    const caps = sliceCaps(meta, worldW);
    const left = caps.left * k, right = caps.right * k;
    const mid = Math.max(0, w - left - right);
    const x = centerX - w / 2;
    const y = yCenter - h / 2;
    const uL = caps.uL, uR = caps.uR;
    const draw = (dx: number, dw: number, sx: number, sWidth: number) => {
      if (dw <= 0.01 || sWidth <= 0.01) return;
      ctx.drawImage(img, sx, 0, sWidth, sh, dx, y, dw, h);
    };
    // 端头超宽时 sliceCaps 已等比缩小，三段仍首尾相接。
    draw(x, left, 0, sw * uL);
    draw(x + left, mid, sw * uL, sw * (1 - uL - uR));
    draw(x + left + mid, right, sw * (1 - uR), sw * uR);
  }

  /** 命中测试：返回鼠标位置下的音符（先 Hold 后瞬时，取纵向最近者）。 */
  hitTest(chart: Chart, lay: Layout, x: number, y: number, instantPx: number, radius = 6): Note | null {
    const t = yTime(y, lay);
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
