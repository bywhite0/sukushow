/**
 * SVG 生成：把一份谱面画成矢量图。
 *
 * 结构照参考仓库 pjsekai-scores-rs 的做法——`defs` 里放一次 CSS 与贴图，正文按层铺开。
 * 时间轴向上（0 秒在内容底部），与游戏下落式朝向一致。
 *
 * 分层（自下而上）：
 *   背景 → 轨道栏 → 轨道格线 → 小节线 → 拍线 → 同时押连线
 *   → Hold 宽带 → Hold 端头 → 音符本体 → Flick 附加元素
 *
 * 与参考仓库的差别：那边一张图切成多段嵌套 `<svg>` 横向并排（长曲分页），
 * 这边整谱一张纵向长图，故只有一个根 `<svg>`。
 */

import type { Chart, Note } from './chart';
import {
  type Layout, LANES, canvasWidth, contentHeight, edgeX, measures, noteSpan, timeY, trackWidth,
} from './layout';
import {
  type BandHalf, type FlickOverlay, type SpriteMeta,
  FLICK_ARROW, FLICK_ICON, FLICK_SIGN, NOTE_SPRITE, SPRITE_SCALE_X,
  bandHalves, cssRgba, flickOverlays, laneX, noteDepthWorld, noteWidthWorld, pxPerWorld, sliceCaps,
} from './geometry';

/** 未提供贴图时的兜底配色，沿用原版四类音符的观感。 */
const FALLBACK: readonly string[] = ['#ff5eab', '#2ec6ff', '#ff5eab', '#54d6ef'];

/** Flick 附加元素的顺序：箭头、Symbol、Sign。 */
export const FLICK_EXTRA = [FLICK_ARROW, FLICK_ICON, FLICK_SIGN] as const;

/** 贴图库：音符四类 + Flick 附加三层。`uri` 是 data URI（自包含）或外部路径。 */
export interface SpriteLibrary {
  /** 索引 = Note.type 的贴图 URI。 */
  notes: (string | undefined)[];
  /** 索引 = Note.type 的九宫格元数据。 */
  meta: (SpriteMeta | undefined)[];
  /** Flick 附加元素，顺序 = FLICK_EXTRA。 */
  extra: { uri: (string | undefined)[]; meta: (SpriteMeta | undefined)[] };
}

export const emptyLibrary = (): SpriteLibrary => ({
  notes: [], meta: [], extra: { uri: [], meta: [] },
});

export interface SvgOptions {
  layout: Layout;
  /** 是否画小节线。 */
  showMeasures: boolean;
  /** 是否画拍线（小节内的细分）。 */
  showBeats: boolean;
  /** 是否画同时押连线。 */
  showSimultaneous: boolean;
  /** 是否画轨道格线。 */
  showGrid: boolean;
  /** 是否标小节号。 */
  showBarNumbers: boolean;
  /** 背景色；`null` 表示透明。 */
  background: string | null;
  /** 外部样式表内容，追加在内置样式之后。 */
  extraCss?: string;
  /** 音符贴图缺失时是否退回纯色矩形。 */
  allowFallback: boolean;
  /**
   * 只渲染这段时间（秒），画布按它裁剪。
   *
   * 实现方式是 `viewBox` 开窗 + 剔除窗外元素：坐标口径完全不变（不做重排），
   * 长曲出局部图时文件也小得多。
   */
  range?: { from: number; to: number };
}

/** 渲染统计，便于脚本与测试自检。 */
export interface RenderStats {
  /** 画出的音符节点数（含 Hold 链节点）。 */
  notes: number;
  /** 瞬时音符数。 */
  instants: number;
  /** Hold 宽带半边数。 */
  holds: number;
  /** 小节线数。 */
  bars: number;
  /** 拍线数。 */
  beats: number;
  /** 同时押连线数。 */
  simultaneous: number;
  /** 用了兜底配色的音符数（贴图缺失）。 */
  fallback: number;
}

/** XML 文本转义。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 数字格式化：去掉浮点噪声，最多三位小数。 */
function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * 内置样式表。类名沿用参考仓库那一套（`bar-line` / `beat-line` / `lane-line` …），
 * 配色按本仓库的平面图定。
 */
const DEFAULT_CSS = [
  '.bg{fill:#0d1220}',
  '.lane{fill:#111a2b}',
  '.edge{stroke:#54d6ef;stroke-opacity:.55;stroke-width:1.5}',
  '.lane-line{stroke:#dbe1ec;stroke-opacity:.10;stroke-width:1}',
  '.lane-line-major{stroke:#dbe1ec;stroke-opacity:.24;stroke-width:1}',
  '.bar-line{stroke:#ed5eaa;stroke-opacity:.55;stroke-width:1.5}',
  '.beat-line{stroke:#dbe1ec;stroke-opacity:.20;stroke-width:1}',
  '.simul{stroke:#d8f0ff;stroke-opacity:.55;stroke-width:1.5}',
  '.bar-text{font:11px/1 "Segoe UI",system-ui,sans-serif;fill:#ed5eaa;fill-opacity:.8}',
].join('\n');

/** 生成一张谱面 SVG。 */
export function renderSvg(chart: Chart, lib: SpriteLibrary, opt: SvgOptions): { svg: string; stats: RenderStats } {
  // 时长以谱面为准：时间轴靠它把 0 秒锚在内容底部，让调用方另行同步是个脚枪。
  const lay: Layout = { ...opt.layout, duration: chart.duration };
  const fullW = canvasWidth(lay);
  const fullH = contentHeight(chart, lay);
  const stats: RenderStats = { notes: 0, instants: 0, holds: 0, bars: 0, beats: 0, simultaneous: 0, fallback: 0 };

  // 出图窗口。坐标口径不变，只换 viewBox 并剔除窗外元素——
  // 这样整谱图与局部图的几何完全一致，局部图不必重排。
  let viewX = 0, viewY = 0, viewW = fullW, viewH = fullH;
  let cullTop = -Infinity, cullBottom = Infinity;
  if (opt.range) {
    const yTop = timeY(opt.range.to, lay), yBottom = timeY(opt.range.from, lay);
    viewY = yTop - lay.padY;
    viewH = (yBottom + lay.padY) - viewY;
    cullTop = viewY - 200;          // 留出元素自身高度（Flick Sign 会向上探出）
    cullBottom = viewY + viewH + 200;
  }
  const visible = (y: number) => y >= cullTop && y <= cullBottom;

  const body: string[] = [];
  const symbols: string[] = [];
  const grads: string[] = [];

  // ── 贴图入库：每张只内嵌一次，正文用 <use> 引用 ──────────────────────
  const symbolId = (name: string) => `sp-${name}`;
  for (let t = 0; t < 4; t++) {
    const uri = lib.notes[t], m = lib.meta[t];
    if (!uri || !m) continue;
    symbols.push(`<image id="${symbolId(NOTE_SPRITE[t])}" xlink:href="${esc(uri)}" width="${n(m.rect[2])}" height="${n(m.rect[3])}"/>`);
  }
  for (let i = 0; i < FLICK_EXTRA.length; i++) {
    const uri = lib.extra.uri[i], m = lib.extra.meta[i];
    if (!uri || !m) continue;
    symbols.push(`<image id="${symbolId(FLICK_EXTRA[i])}" xlink:href="${esc(uri)}" width="${n(m.rect[2])}" height="${n(m.rect[3])}"/>`);
  }

  // ── 背景与轨道 ────────────────────────────────────────────────────────
  if (opt.background) body.push(`<rect class="bg" x="0" y="${n(viewY)}" width="${n(viewW)}" height="${n(viewH)}"/>`);
  const trackW = trackWidth(lay);
  body.push(`<rect class="lane" x="${n(lay.padX)}" y="${n(viewY)}" width="${n(trackW)}" height="${n(viewH)}"/>`);

  // ── 轨道格线 ──────────────────────────────────────────────────────────
  if (opt.showGrid) {
    for (let lane = 1; lane < LANES; lane++) {
      const x = edgeX(lane, lay);
      const cls = lane % 5 === 0 ? 'lane-line-major' : 'lane-line';
      body.push(`<line class="${cls}" x1="${n(x)}" y1="${n(viewY)}" x2="${n(x)}" y2="${n(viewY + viewH)}"/>`);
    }
  }
  for (const edge of [0, LANES]) {
    const x = edgeX(edge, lay);
    body.push(`<line class="edge" x1="${n(x)}" y1="${n(viewY)}" x2="${n(x)}" y2="${n(viewY + viewH)}"/>`);
  }

  // ── 小节线与拍线 ──────────────────────────────────────────────────────
  const bars = measures(chart);
  if (opt.showMeasures) {
    for (const m of bars) {
      const y = timeY(m.time, lay);
      if (!visible(y)) continue;
      body.push(`<line class="bar-line" x1="${n(lay.padX)}" y1="${n(y)}" x2="${n(lay.padX + trackW)}" y2="${n(y)}"/>`);
      stats.bars++;
    }
  }
  if (opt.showBarNumbers) {
    for (let i = 0; i < bars.length; i++) {
      const y = timeY(bars[i].time, lay);
      if (!visible(y)) continue;
      body.push(`<text class="bar-text" x="${n(lay.padX + 3)}" y="${n(y - 3)}">${i + 1}</text>`);
    }
  }
  if (opt.showBeats) {
    for (let i = 0; i < bars.length; i++) {
      const t0 = bars[i].time;
      const t1 = i + 1 < bars.length ? bars[i + 1].time : chart.duration;
      const span = t1 - t0;
      const per = beatsPerBar(chart, t0);
      if (!(span > 0) || per <= 1) continue;
      for (let b = 1; b < per; b++) {
        const y = timeY(t0 + (span / per) * b, lay);
        if (!visible(y)) continue;
        body.push(`<line class="beat-line" x1="${n(lay.padX)}" y1="${n(y)}" x2="${n(lay.padX + trackW)}" y2="${n(y)}"/>`);
        stats.beats++;
      }
    }
  }

  // ── 同时押连线 ────────────────────────────────────────────────────────
  if (opt.showSimultaneous) {
    for (const line of chart.lines) {
      const y = timeY(line.time, lay);
      if (!visible(y)) continue;
      let min = Infinity, max = -Infinity;
      for (const p of line.points) {
        const [a, b] = noteSpan(p.note, lay, p.tail);
        if (a < min) min = a;
        if (b > max) max = b;
      }
      if (!(max > min)) continue;
      body.push(`<line class="simul" x1="${n(min)}" y1="${n(y)}" x2="${n(max)}" y2="${n(y)}"/>`);
      stats.simultaneous++;
    }
  }

  // ── Hold 宽带与端头 ───────────────────────────────────────────────────
  // 串链允许汇合（两个节点可指向同一后继），故顺链遍历要去重，否则汇合点会画两遍、
  // 统计也会超。`seen` 记录已处理的节点。
  const seen = new Set<number>();
  for (const root of chart.roots) {
    if (root.type !== 1) continue;
    let node: Note | undefined = root, tail: Note = root;
    while (node) {
      if (seen.has(node.uid)) break;
      seen.add(node.uid);
      const y0 = timeY(node.time, lay), y1 = timeY(node.end, lay);
      // 区间重叠而非两端都在窗内——长带可能两端都在窗外却横穿画面。
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      if (node.end > node.time && hi >= cullTop && lo <= cullBottom) {
        for (const half of bandHalves(node, lay)) {
          const { def, path } = bandElement(half, grads.length);
          grads.push(def);
          body.push(path);
          stats.holds++;
        }
        stats.notes++;
      }
      tail = node;
      node = node.next;
    }
    const yh = timeY(root.time, lay), yt = timeY(tail.end, lay);
    if (visible(yh)) body.push(capElement(root.time, root.l, root.r, lay, lib));
    if (visible(yt)) body.push(capElement(tail.end, tail.l2, tail.r2, lay, lib));
  }

  // ── 瞬时音符与 Flick 附加元素 ─────────────────────────────────────────
  for (let type = 0; type < 4; type++) {
    if (type === 1) continue;
    const uri = lib.notes[type], m = lib.meta[type];
    for (const note of chart.notes) {
      if (note.type !== type || note.prev) continue;
      const [x0, x1] = noteSpan(note, lay, false);
      const y = timeY(note.time, lay);
      if (!visible(y)) continue;
      if (uri && m) {
        body.push(slicedImage(symbolId(NOTE_SPRITE[type]), m, (x0 + x1) / 2, y, note.r - note.l + 1, type, lay));
      } else if (opt.allowFallback) {
        const h = Math.max(2, noteDepthWorld(type) * SPRITE_SCALE_X * pxPerWorld(lay));
        body.push(`<rect x="${n(x0)}" y="${n(y - h / 2)}" width="${n(Math.max(1, x1 - x0))}" height="${n(h)}" fill="${FALLBACK[type]}"/>`);
        stats.fallback++;
      } else {
        continue;
      }
      // Flick 的三层附加元素画在本体之上（原版 sortingOrder 21 / 25）。
      if (type === 2) {
        const overlays = flickOverlays(note, lay, {
          arrow: lib.extra.meta[0], icon: lib.extra.meta[1], sign: lib.extra.meta[2],
        });
        for (const o of overlays) body.push(flickElement(o, lib));
      }
      stats.notes++; stats.instants++;
    }
  }

  // ── 组装 ──────────────────────────────────────────────────────────────
  const css = opt.extraCss ? `${DEFAULT_CSS}\n${opt.extraCss}` : DEFAULT_CSS;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`,
    ` width="${n(viewW)}" height="${n(viewH)}" viewBox="${n(viewX)} ${n(viewY)} ${n(viewW)} ${n(viewH)}">`,
    `<defs><style>${css}</style>${symbols.join('')}${grads.join('')}</defs>`,
    body.join(''),
    `</svg>`,
  ].join('');

  return { svg, stats };
}

/** 取某时刻所在小节的拍数（拍号分子）。 */
function beatsPerBar(chart: Chart, time: number): number {
  let num = 4;
  for (const b of chart.beats) {
    if (time >= b.time) num = b.numerator;
    else break;
  }
  return Math.max(1, Math.round(num));
}

/**
 * Hold 宽带半边 → 渐变定义 + path。
 *
 * 渐变用 `userSpaceOnUse`，端点取几何上的两列中点投影——即垂直于带轴的方向。
 * 每个半边一条独立渐变（带轴各不相同），定义收集进根 `defs`。
 */
function bandElement(half: BandHalf, index: number): { def: string; path: string } {
  const [a, b, c, d] = half.corners;
  const id = `bg${index}`;
  const def = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`
    + ` x1="${n(half.gradFrom[0])}" y1="${n(half.gradFrom[1])}" x2="${n(half.gradTo[0])}" y2="${n(half.gradTo[1])}">`
    + `<stop offset="0" stop-color="${cssRgba(half.fromColor)}"/>`
    + `<stop offset="1" stop-color="${cssRgba(half.toColor)}"/></linearGradient>`;
  const path = `<path fill="url(#${id})" d="M ${n(a[0])} ${n(a[1])} L ${n(b[0])} ${n(b[1])} L ${n(c[0])} ${n(c[1])} L ${n(d[0])} ${n(d[1])} Z"/>`;
  return { def, path };
}

/**
 * 九宫格横向拉伸：左右端头保持原生尺寸（圆角不变形），仅中段拉伸。
 *
 * 用嵌套 `<svg>` + `viewBox` 裁源图、`preserveAspectRatio="none"` 按目标尺寸铺开。
 * 三段首尾相接；端头之和超过目标宽时 `sliceCaps` 已等比缩小，中段为 0。
 */
function slicedImage(
  symbol: string, meta: SpriteMeta, centerX: number, yCenter: number,
  widthUnits: number, type: number, lay: Layout,
): string {
  const k = pxPerWorld(lay);
  const worldW = noteWidthWorld(widthUnits) * SPRITE_SCALE_X;
  const w = worldW * k;
  const h = Math.max(2, noteDepthWorld(type) * SPRITE_SCALE_X * k);
  const sw = meta.rect[2] || 1, sh = meta.rect[3] || 1;
  const caps = sliceCaps(meta, worldW);
  const left = caps.left * k, right = caps.right * k;
  const mid = Math.max(0, w - left - right);
  const x = centerX - w / 2;
  const y = yCenter - h / 2;
  const sL = sw * caps.uL, sMid = sw * (1 - caps.uL - caps.uR), sR = sw * caps.uR;
  const out: string[] = [];
  const piece = (dx: number, dw: number, sx: number, sWidth: number) => {
    if (dw <= 0.01 || sWidth <= 0.01) return;
    out.push(`<svg x="${n(dx)}" y="${n(y)}" width="${n(dw)}" height="${n(h)}"`
      + ` viewBox="${n(sx)} 0 ${n(sWidth)} ${n(sh)}" preserveAspectRatio="none">`
      + `<use xlink:href="#${symbol}"/></svg>`);
  };
  piece(x, left, 0, sL);
  piece(x + left, mid, sL, sMid);
  piece(x + left + mid, right, sL + sMid, sR);
  return out.join('');
}

/** Hold 头 / 尾的端头贴图，与瞬时音符同款九宫格。 */
function capElement(time: number, l: number, r: number, lay: Layout, lib: SpriteLibrary): string {
  const meta = lib.meta[1];
  if (!lib.notes[1] || !meta) return '';
  const x0 = laneX(l, lay), x1 = laneX(r + 1, lay);
  return slicedImage(`sp-${NOTE_SPRITE[1]}`, meta, (x0 + x1) / 2, timeY(time, lay), r - l + 1, 1, lay);
}

/**
 * Flick 的一层附加元素 → SVG。
 *
 * 箭头走横向平铺（单块宽 `tile`，末块按剩余宽度裁源图，不取整）；其余直接拉伸。
 * 镜像一律以元素自身中心为轴，用 `translate(2·cx, 0) scale(-1, 1)` 实现。
 */
function flickElement(o: FlickOverlay, lib: SpriteLibrary): string {
  const idx = o.kind === 'arrow' ? 0 : o.kind === 'icon' ? 1 : 2;
  const meta = lib.extra.meta[idx];
  if (!lib.extra.uri[idx] || !meta || o.w <= 0.01 || o.h <= 0.01) return '';
  const name = FLICK_EXTRA[idx];
  const sw = meta.rect[2] || 1, sh = meta.rect[3] || 1;
  const y = o.cy - o.h / 2;
  const parts: string[] = [];

  if (o.kind === 'arrow' && o.tile > 0.5) {
    let dx = -o.w / 2;
    while (dx < o.w / 2 - 0.5) {
      const remain = Math.min(o.tile, o.w / 2 - dx);
      parts.push(`<svg x="${n(o.cx + dx)}" y="${n(y)}" width="${n(remain)}" height="${n(o.h)}"`
        + ` viewBox="0 0 ${n(sw * (remain / o.tile))} ${n(sh)}" preserveAspectRatio="none">`
        + `<use xlink:href="#sp-${name}"/></svg>`);
      dx += o.tile;
    }
  } else {
    parts.push(`<svg x="${n(o.cx - o.w / 2)}" y="${n(y)}" width="${n(o.w)}" height="${n(o.h)}"`
      + ` viewBox="0 0 ${n(sw)} ${n(sh)}" preserveAspectRatio="none">`
      + `<use xlink:href="#sp-${name}"/></svg>`);
  }

  const inner = parts.join('');
  return o.flip ? `<g transform="translate(${n(o.cx * 2)},0) scale(-1,1)">${inner}</g>` : inner;
}
