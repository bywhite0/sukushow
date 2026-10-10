/**
 * 画布绘制工具：HUD / 过场 / 曲终横幅 / 背景共用。
 *
 * 这些图层原先是 DOM + CSS；改画到 2D 画布后，预览与视频导出走同一条绘制路径。
 * 这里的每个函数都对应原 DOM 里用到的一种 CSS 效果（object-fit、圆角填充、内外描边环、
 * -webkit-text-stroke 描边字、分组不透明度 / 滤镜、遮罩），尽量按浏览器的同一口径实现，
 * 以便与原 DOM 版本逐像素对照。
 */

export type Ctx = CanvasRenderingContext2D;

/** 与 .hud / .start-anim 的 font-family 相同。 */
export const HUD_FONT_FAMILY = '"FOT-Rodin Pro","Microsoft YaHei","PingFang SC",sans-serif';

export function hudFont(weight: number, size: number): string {
  return `${weight} ${size}px ${HUD_FONT_FAMILY}`;
}

// ── 贴图缓存 ─────────────────────────────────────────────────────
type ImageEntry = { img: HTMLImageElement; state: 'loading' | 'ok' | 'error'; done: Promise<void> };
const images = new Map<string, ImageEntry>();
export type ImageLoadProgress = { url: string; phase: 'download' | 'ready' };
type ImageProgressListener = (progress: ImageLoadProgress) => void;
const imageListeners = new Map<string, Set<ImageProgressListener>>();

function notifyImage(url: string, phase: ImageLoadProgress['phase']): void {
  const listeners = imageListeners.get(url);
  if (!listeners) return;
  const progress = { url, phase } satisfies ImageLoadProgress;
  for (const listener of listeners) listener(progress);
  if (phase === 'ready') imageListeners.delete(url);
}

function entry(url: string): ImageEntry {
  let e = images.get(url);
  if (e) return e;
  const img = new Image();
  img.decoding = 'async';
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  e = { img, state: 'loading', done };
  const rec = e;
  notifyImage(url, 'download');
  img.onload = () => {
    void img.decode().catch(() => undefined).then(() => {
      rec.state = img.naturalWidth > 0 ? 'ok' : 'error';
      notifyImage(url, 'ready');
      resolveDone();
    });
  };
  img.onerror = () => { rec.state = 'error'; notifyImage(url, 'ready'); resolveDone(); };
  img.src = url;
  images.set(url, e);
  return e;
}

/** 已解码的贴图；还在加载或加载失败时返回 null（并开始加载）。 */
export function image(url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  const e = entry(url);
  return e.state === 'ok' ? e.img : null;
}

/** 贴图是否加载失败（404 等）。 */
export function imageFailed(url: string): boolean {
  return images.get(url)?.state === 'error';
}

export function preloadImages(urls: readonly string[], onProgress?: ImageProgressListener): Promise<void> {
  if (typeof Image === 'undefined') return Promise.resolve();
  if (onProgress) {
    for (const url of urls) {
      const current = images.get(url);
      if (!current || current.state === 'loading') {
        let listeners = imageListeners.get(url);
        if (!listeners) imageListeners.set(url, listeners = new Set());
        listeners.add(onProgress);
        onProgress({ url, phase: 'download' });
      } else {
        onProgress({ url, phase: 'ready' });
      }
    }
  }
  return Promise.all(urls.map((u) => entry(u).done)).then(() => undefined);
}

/** 等到目前为止请求过的所有贴图都加载完（成功或失败）。导出前用。 */
export async function imagesSettled(): Promise<void> {
  for (;;) {
    const pending = [...images.values()].filter((e) => e.state === 'loading');
    if (!pending.length) return;
    await Promise.all(pending.map((e) => e.done));
  }
}

export async function loadHudFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([700, 800].map((w) => document.fonts.load(hudFont(w, 20), 'SCORE 0123456789増加×')))
    .catch(() => undefined);
}

// ── 几何 ─────────────────────────────────────────────────────────
export type Rect = { x: number; y: number; w: number; h: number };

/**
 * RectTransform → 父框内矩形（与旧 DOM 版 place() 同一公式，y 向下）。
 * (ax, ay) 锚点，(px, py) 轴心，(x, y) anchoredPosition（y 向上）。
 */
export function placeRect(
  parentW: number, parentH: number,
  ax: number, ay: number, px: number, py: number,
  x: number, y: number, w: number, h: number,
): Rect {
  const pivotX = parentW * ax + x;
  const pivotY = parentH * ay + y;
  return { x: pivotX - px * w, y: parentH - (pivotY + (1 - py) * h), w, h };
}

/** 以 (cx, cy) 为中心缩放（CSS transform-origin: center）。 */
export function scaleAbout(ctx: Ctx, cx: number, cy: number, sx: number, sy = sx): void {
  if (sx === 1 && sy === 1) return;
  ctx.translate(cx, cy);
  ctx.scale(sx, sy);
  ctx.translate(-cx, -cy);
}

/** 当前变换下一个单位长度对应的设备像素（取 x 方向）。 */
export function deviceScale(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

// ── 图片 ─────────────────────────────────────────────────────────
/** object-fit: contain（默认居中）。 */
export function drawContain(ctx: Ctx, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number): void {
  const nw = (img as HTMLImageElement).naturalWidth || img.width;
  const nh = (img as HTMLImageElement).naturalHeight || img.height;
  if (!nw || !nh) return;
  const k = Math.min(w / nw, h / nh);
  const dw = nw * k, dh = nh * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 按 URL 画 contain 贴图；未加载完则跳过。 */
export function drawSprite(ctx: Ctx, url: string, x: number, y: number, w: number, h: number, fit: 'contain' | 'fill' = 'contain'): boolean {
  const img = image(url);
  if (!img) return false;
  if (fit === 'fill') ctx.drawImage(img, x, y, w, h);
  else drawContain(ctx, img, x, y, w, h);
  return true;
}

// ── 形状 ─────────────────────────────────────────────────────────
export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  // CSS border-radius 与 canvas roundRect 都会在半径之和超过边长时等比缩小。
  ctx.roundRect(x, y, w, h, Math.max(0, r));
}

export function fillRoundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, style: string | CanvasGradient): void {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = style;
  ctx.fill();
}

function clampRadius(w: number, h: number, r: number): number {
  return Math.max(0, Math.min(r, w / 2, h / 2));
}

/** box-shadow: inset 0 0 0 {width}px —— 圆角框内缘的一圈实心带（内缘半径 r − width）。 */
export function insetRing(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, width: number, color: string): void {
  const ro = clampRadius(w, h, r);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, ro);
  ctx.roundRect(x + width, y + width, w - 2 * width, h - 2 * width, Math.max(0, ro - width));
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}

/** box-shadow: 0 0 0 {width}px —— 圆角框外侧一圈实心带（外缘半径 r + width）。 */
export function outerRing(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, width: number, color: string): void {
  const ri = clampRadius(w, h, r);
  ctx.beginPath();
  ctx.roundRect(x - width, y - width, w + 2 * width, h + 2 * width, ri > 0 ? ri + width : 0);
  ctx.roundRect(x, y, w, h, ri);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}

/**
 * box-shadow: 0 0 {blur}px color（无偏移、无扩展）。只画在框外（CSS 会裁掉框内部分），
 * 所以用离屏偏移技巧：图形画到画面外，只让阴影落回原处，再裁掉框内。
 */
export function outerBlurShadow(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, blur: number, color: string): void {
  const k = deviceScale(ctx);
  const m = ctx.getTransform();
  ctx.save();
  // 裁掉框内
  ctx.beginPath();
  ctx.rect(x - blur * 4, y - blur * 4, w + blur * 8, h + blur * 8);
  ctx.roundRect(x, y, w, h, clampRadius(w, h, r));
  ctx.clip('evenodd');
  const off = 100000;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur * k;
  // shadowOffset 不受变换影响（设备像素）：把图形在用户空间平移 off，阴影在设备空间反向平移同样距离。
  ctx.shadowOffsetX = off * m.a;
  ctx.shadowOffsetY = off * m.b;
  ctx.beginPath();
  ctx.roundRect(x - off, y, w, h, clampRadius(w, h, r));
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();
}

// ── 文字 ─────────────────────────────────────────────────────────
export type TextStyle = {
  size: number;
  weight: number;
  color: string;
  /** 水平对齐（flex justify-content / text-align）。 */
  align?: 'center' | 'left' | 'right';
  /** CSS letter-spacing（px）。 */
  letterSpacing?: number;
  /** -webkit-text-stroke 宽度与颜色。 */
  stroke?: { width: number; color: string };
  /** text-shadow（仅 y 偏移，无模糊）。 */
  shadow?: { dy: number; color: string };
};

const metricsCache = new Map<string, { asc: number; desc: number }>();

/** CSS 行框用的字体上下沿（与 layout 一样取整）。 */
export function fontExtents(ctx: Ctx, font: string): { asc: number; desc: number } {
  let m = metricsCache.get(font);
  if (!m) {
    ctx.save();
    ctx.font = font;
    const t = ctx.measureText('0');
    ctx.restore();
    m = { asc: Math.round(t.fontBoundingBoxAscent), desc: Math.round(t.fontBoundingBoxDescent) };
    // 字体还没加载完时量到的是回退字体，不缓存。
    if (typeof document === 'undefined' || document.fonts?.check(font)) metricsCache.set(font, m);
  }
  return m;
}

export function setTextStyle(ctx: Ctx, s: TextStyle): void {
  ctx.font = hudFont(s.weight, s.size);
  ctx.letterSpacing = `${s.letterSpacing ?? 0}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** 在框内按 flex 居中（竖直）+ 指定水平对齐排一行字，返回基线与起点。 */
export function textOrigin(ctx: Ctx, text: string, s: TextStyle, x: number, y: number, w: number, h: number): { x: number; y: number; width: number } {
  setTextStyle(ctx, s);
  const { asc, desc } = fontExtents(ctx, ctx.font);
  const width = ctx.measureText(text).width;
  const align = s.align ?? 'center';
  const ox = align === 'left' ? x : align === 'right' ? x + w - width : x + (w - width) / 2;
  const oy = y + (h - (asc + desc)) / 2 + asc;
  return { x: ox, y: oy, width };
}

export function drawText(ctx: Ctx, text: string, s: TextStyle, x: number, y: number, w: number, h: number): void {
  if (!text) return;
  const o = textOrigin(ctx, text, s, x, y, w, h);
  if (s.shadow) {
    ctx.fillStyle = s.shadow.color;
    ctx.fillText(text, o.x, o.y + s.shadow.dy);
  }
  ctx.fillStyle = s.color;
  ctx.fillText(text, o.x, o.y);
  if (s.stroke && s.stroke.width > 0) {
    ctx.lineWidth = s.stroke.width;
    ctx.strokeStyle = s.stroke.color;
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 4;
    ctx.strokeText(text, o.x, o.y);
  }
}

/**
 * 原 mountOutlinedText：底层 .hud-ol（描边色填充 + text-stroke）+ 顶层 .hud-face（纯色，无描边）。
 */
export function drawOutlinedText(
  ctx: Ctx, text: string,
  s: { size: number; weight: number; align?: 'center' | 'left' | 'right'; letterSpacing?: number },
  outline: { color: string; width: number }, face: string,
  x: number, y: number, w: number, h: number,
): void {
  drawText(ctx, text, { ...s, color: outline.color, stroke: { width: outline.width, color: outline.color } }, x, y, w, h);
  drawText(ctx, text, { ...s, color: face }, x, y, w, h);
}

// ── 分组合成（CSS opacity / filter / mask 的隔离组）──────────────────
const pool: HTMLCanvasElement[] = [];
const MAX_SCRATCH = 16;
const MAX_IDLE_PIXELS = 16 * 1024 * 1024;

function takeScratch(w: number, h: number): HTMLCanvasElement {
  const i = pool.findIndex(c => c.width === w && c.height === h);
  if (i >= 0) return pool.splice(i, 1)[0];
  const c = pool.length >= MAX_SCRATCH ? pool.shift()! : document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function returnScratch(scratch: HTMLCanvasElement): void {
  const pixels = scratch.width * scratch.height;
  if (pixels > MAX_IDLE_PIXELS) return;
  let idle = pixels + pool.reduce((sum, c) => sum + c.width * c.height, 0);
  while (pool.length && (pool.length >= MAX_SCRATCH || idle > MAX_IDLE_PIXELS)) {
    const removed = pool.shift()!;
    idle -= removed.width * removed.height;
  }
  pool.push(scratch);
}

export type GroupOptions = {
  alpha?: number;
  composite?: GlobalCompositeOperation;
  /** 合成时的 canvas filter（设备像素单位，如 drop-shadow）。 */
  filter?: string;
  /** 组内容画完后用来做遮罩的回调（在组画布上以 destination-in 绘制）。 */
  mask?: (g: Ctx) => void;
  /** 组内容在当前用户坐标下的包围盒，只清 / 合成这块区域。 */
  bounds?: Rect;
  /** 包围盒外扩（设备像素，给模糊 / 阴影留边）。 */
  pad?: number;
};

function deviceBounds(ctx: Ctx, r: Rect, pad: number, cw: number, ch: number): { x: number; y: number; w: number; h: number } | null {
  const m = ctx.getTransform();
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([px, py]) => [
    m.a * px! + m.c * py! + m.e, m.b * px! + m.d * py! + m.f,
  ]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0]!)) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]!)) - pad));
  const x1 = Math.min(cw, Math.ceil(Math.max(...pts.map((p) => p[0]!)) + pad));
  const y1 = Math.min(ch, Math.ceil(Math.max(...pts.map((p) => p[1]!)) + pad));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 有界无滤镜组按包围盒分配画布，滤镜及无边界组保持全尺寸；
 * 仍按原 alpha、遮罩、混合与滤镜顺序绘制 CSS 隔离组。
 */
export function drawGroup(ctx: Ctx, opts: GroupOptions, draw: (g: Ctx) => void): void {
  const alpha = opts.alpha ?? 1;
  if (alpha <= 0) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const box = opts.bounds ? deviceBounds(ctx, opts.bounds, opts.pad ?? 2, cw, ch) : { x: 0, y: 0, w: cw, h: ch };
  if (!box) return;
  const fullSize = !!opts.filter || !opts.bounds;
  const scratch = takeScratch(fullSize ? cw : box.w, fullSize ? ch : box.h);
  const g = scratch.getContext('2d')!;
  const offsetX = fullSize ? 0 : box.x, offsetY = fullSize ? 0 : box.y;
  const m = ctx.getTransform();
  const setGroupTransform = () => g.setTransform(m.a, m.b, m.c, m.d, m.e - offsetX, m.f - offsetY);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, scratch.width, scratch.height);
  g.beginPath();
  g.rect(box.x - offsetX, box.y - offsetY, box.w, box.h);
  g.clip();
  setGroupTransform();
  g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
  g.imageSmoothingQuality = ctx.imageSmoothingQuality;
  draw(g);
  if (opts.mask) {
    setGroupTransform();
    g.globalAlpha = 1;
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-in';
    opts.mask(g);
  }
  g.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.globalCompositeOperation = opts.composite ?? 'source-over';
  if (opts.filter) ctx.filter = opts.filter;
  if (fullSize) ctx.drawImage(scratch, 0, 0);
  else ctx.drawImage(scratch, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
  returnScratch(scratch);
}

/** 把贴图着成纯色（rgb = color，alpha = 贴图 alpha），用于 CSS 的 background-color + mask-image。 */
const tintCache = new Map<string, HTMLCanvasElement>();
export function tintedMask(url: string, color: string): HTMLCanvasElement | null {
  const key = `${url}|${color}`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const img = image(url);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}
