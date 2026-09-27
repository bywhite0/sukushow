/**
 * 曲终横幅 RhythmGameComboResult（level56 GO 370），目前只接 AllPerfect（自动演奏恒为 AP）。
 *
 * 时序：LiveEnd.Is = FinishTime ≤ t，FinishTime = MusicsRecord.PlayTime(ms) / 1000。
 * ComboResultResolver.ShowAsync（@0x4B01A80）按 GetResultIndex（AP→0，FC→1，Clear→2，Finish→3）
 * 互斥激活 roots[idx]，播放 se_rhythm_finish_0004（AP），然后 animator.Play 4 s 的 clip。
 *
 * 分层（Canvas：world space，Default 层，order 10，overrideSorting）：
 *  1. Glow：粒子渲染器在 Default 层 order 1，低于 Canvas order 10，所以画在黑罩之下；
 *  2. Canvas：全屏黑罩 Bg（0,0,0,0.698）加上 UI Image（普通 alpha 混合，按层级顺序绘制）；
 *  3. 其余发射器：排序层比 Default 高，整体压在 Canvas 之上。
 * 所有粒子材质都是加色（Mobile/Particles/Additive、UI/Additive：Blend SrcAlpha One，
 * 输出 = tex × 顶点色），而加色与顺序无关，所以 2、3 两层各用一张 canvas 就是精确结果。
 *
 * 粒子按「距播放开始的时间」解析求解（位置、尺寸、颜色都是时间的纯函数），拖动进度也能复现同一帧。
 */
import { hudScale } from './hud';
import { sampleCurve } from './startAnim';
import {
  AP_BANNER_CURVES,
  AP_BANNER_EMITTERS,
  AP_BANNER_NODES,
  COMBO_RESULT_BG,
  COMBO_RESULT_CLIP_DURATION,
  type BannerEmitter,
  type BannerNode,
} from './comboResultClip';

export { COMBO_RESULT_CLIP_DURATION };

export const BANNER_TEX_BASE = '/rg/banner/';
/** 粒子单位：1 unit = 100 设计像素（与 HUD 同一 1920×1080 参考分辨率）。 */
export const BANNER_UNIT = 100;
/** 1920×1080 参考高度；maxParticleSize 按视口高度的比例换算（参照系为推断）。 */
const DESIGN_H = 1080;

// ── 随机数（确定性；Unity 自身的随机序列无法复现，只保证同一时刻同一结果）──────────
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 8) / 16777216;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const range = (r: readonly [number, number], u: number) => lerp(r[0], r[1], u);

// ── 曲线 / 渐变 ───────────────────────────────────────────────────
/** Unity AnimationCurve 求值：段内三次 Hermite（outSlope / inSlope），两端外钳制。 */
export function evalHermite(keys: readonly (readonly [number, number, number, number])[], x: number): number {
  const n = keys.length;
  if (n === 0) return 1;
  if (x <= keys[0]![0]) return keys[0]![1];
  if (x >= keys[n - 1]![0]) return keys[n - 1]![1];
  let i = 0;
  while (i < n - 2 && x >= keys[i + 1]![0]) i++;
  const [t0, v0, , o0] = keys[i]!;
  const [t1, v1, i1] = keys[i + 1]!;
  const dt = t1 - t0;
  if (!Number.isFinite(o0) || !Number.isFinite(i1)) return v0;
  const s = (x - t0) / dt;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * o0 * dt + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * i1 * dt;
}

function lerpKeys<K extends readonly number[]>(keys: readonly K[], x: number, pick: (k: K) => number[]): number[] {
  if (x <= keys[0]![0]) return pick(keys[0]!);
  const last = keys[keys.length - 1]!;
  if (x >= last[0]) return pick(last);
  let i = 0;
  while (x >= keys[i + 1]![0]) i++;
  const a = keys[i]!, b = keys[i + 1]!;
  const u = (x - a[0]) / (b[0] - a[0]);
  const pa = pick(a), pb = pick(b);
  return pa.map((v, j) => lerp(v, pb[j]!, u));
}

/** Gradient（Blend 模式）：颜色键与 alpha 键各自线性插值。 */
export function evalGradient(grad: NonNullable<BannerEmitter['grad']>, x: number): [number, number, number, number] {
  const [cols, alps] = grad;
  const [r, g, b] = lerpKeys(cols, x, (k) => [k[1], k[2], k[3]]);
  const [a] = lerpKeys(alps, x, (k) => [k[1]]);
  return [r!, g!, b!, a!];
}

/**
 * LimitVelocityOverLifetime（与 HitFx 同一口径）：超过上限的部分按 κ = −ln(1 − dampen) × 50
 * 指数衰减，v = lim + (v0 − lim)·e^(−κt)，对时间积分得位移。
 */
export function dampedDistance(v0: number, lim: number, dampen: number, t: number): number {
  if (v0 <= lim || dampen <= 0) return v0 * t;
  const k = -Math.log(1 - Math.min(dampen, 0.999999)) * 50;
  return lim * t + (v0 - lim) * (1 - Math.exp(-k * t)) / k;
}

// ── 节点与动画 ───────────────────────────────────────────────────
type Prop = 'active' | 'x' | 'y' | 'scale.x' | 'scale.y' | 'r' | 'g' | 'b' | 'a';
const CURVES = new Map<string, Map<string, (typeof AP_BANNER_CURVES)[number]['keys']>>();
for (const c of AP_BANNER_CURVES) {
  let m = CURVES.get(c.path);
  if (!m) CURVES.set(c.path, (m = new Map()));
  m.set(c.prop, c.keys);
}

export type NodeState = {
  active: boolean;
  x: number; y: number; sx: number; sy: number;
  r: number; g: number; b: number; a: number;
};

export function nodeStateAt(node: BannerNode, t: number): NodeState {
  const m = CURVES.get(node.path);
  const get = (p: Prop, base: number) => {
    const keys = m?.get(p);
    return keys ? sampleCurve(keys, t) : base;
  };
  const c = node.rgba ?? [1, 1, 1, 1];
  return {
    active: get('active', node.active ? 1 : 0) > 0.5,
    x: get('x', node.x), y: get('y', node.y),
    sx: get('scale.x', node.sx), sy: get('scale.y', node.sy),
    r: get('r', c[0]), g: get('g', c[1]), b: get('b', c[2]), a: get('a', c[3]),
  };
}

const NODE_INDEX = new Map(AP_BANNER_NODES.map((n, i) => [n.path, i]));

/** GameObject 被激活的时刻（自身与所有祖先的 active 曲线都为 1 的最早时刻），即 playOnAwake 开播时刻。 */
export function activationTime(path: string): number {
  let idx = NODE_INDEX.get(path);
  let start = 0;
  while (idx !== undefined && idx >= 0) {
    const n = AP_BANNER_NODES[idx]!;
    const keys = CURVES.get(n.path)?.get('active');
    if (keys) {
      const on = keys.find((k) => k[4] > 0.5);
      if (!on) return Infinity;
      start = Math.max(start, on[0]);
    } else if (!n.active) return Infinity;
    idx = n.parent;
  }
  return start;
}

// ── 粒子 ─────────────────────────────────────────────────────────
export type BannerParticle = {
  emitter: number;
  spawn: number; life: number;
  speed: number; angle: number; r0: number;
  size: number; sizeY: number; rotSpeed: number; limit: number;
};

/**
 * 一次 Play 的全部粒子。随机数顺序：系统 startDelay → 每粒子 life、speed、angle、radius、
 * size、sizeY、rotation、limit。burst 共 cycles 轮，每轮间隔 repeatInterval，每轮发 count 个。
 * Circle 形状（radius · radiusThickness）：厚度 0 恰在边上；厚度 > 0 时在环带内按面积均匀取半径（分布为推断）。
 * 方向沿半径向外（Circle 发射方向）。
 */
export function spawnEmitter(e: BannerEmitter, index: number, playStart: number): BannerParticle[] {
  if (!Number.isFinite(playStart)) return [];
  const rnd = lcg(fnv1a(e.path));
  const delay = range(e.delay, rnd());
  const out: BannerParticle[] = [];
  const inner = e.radius * (1 - e.thickness);
  for (let c = 0; c < e.cycles; c++) {
    const spawn = playStart + delay + e.burstT + c * e.interval;
    for (let i = 0; i < e.count; i++) {
      const life = range(e.life, rnd());
      const speed = range(e.speed, rnd());
      const angle = rnd() * Math.PI * 2;
      const ur = rnd();
      const r0 = e.thickness === 0 ? e.radius : Math.sqrt(inner * inner + ur * (e.radius * e.radius - inner * inner));
      const size = range(e.size, rnd());
      const sizeY = e.sizeY ? range(e.sizeY, rnd()) : size;
      const rotSpeed = e.rotSpeed ? range(e.rotSpeed, rnd()) : 0;
      const limit = e.limit ? range(e.limit, rnd()) : Infinity;
      out.push({ emitter: index, spawn, life, speed, angle, r0, size, sizeY, rotSpeed, limit });
    }
  }
  return out;
}

export type ParticleFrame = {
  x: number; y: number; w: number; h: number; rot: number;
  r: number; g: number; b: number; a: number;
};

/** 粒子在 clip 时刻 t 的状态（设计像素，y 向上）；不在寿命内返回 null。 */
export function particleAt(p: BannerParticle, e: BannerEmitter, t: number): ParticleFrame | null {
  const age = t - p.spawn;
  if (age < 0 || age >= p.life) return null;
  const x = age / p.life;
  const dist = Number.isFinite(p.limit) ? dampedDistance(p.speed, p.limit, e.dampen, age) : p.speed * age;
  const rr = (p.r0 + dist) * BANNER_UNIT;
  const k = e.sizeKeys ? evalHermite(e.sizeKeys, x) : 1;
  const cap = e.maxSize * DESIGN_H;
  const g = e.grad ? evalGradient(e.grad, x) : [1, 1, 1, 1];
  return {
    x: Math.cos(p.angle) * rr,
    y: Math.sin(p.angle) * rr,
    w: Math.min(cap, Math.max(0, p.size * k * BANNER_UNIT)),
    h: Math.min(cap, Math.max(0, p.sizeY * k * BANNER_UNIT)),
    rot: p.rotSpeed * age,
    r: e.color[0] * g[0]!, g: e.color[1] * g[1]!, b: e.color[2] * g[2]!, a: e.color[3] * g[3]!,
  };
}

export const AP_PARTICLES: readonly BannerParticle[] = AP_BANNER_EMITTERS.flatMap((e, i) => spawnEmitter(e, i, activationTime(e.path)));

// ── 贴图 ─────────────────────────────────────────────────────────
type Tex = { img: HTMLImageElement; data: ImageData | null };

function loadTex(name: string): Promise<Tex> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      let data: ImageData | null = null;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const x = c.getContext('2d', { willReadFrequently: true })!;
        x.drawImage(img, 0, 0);
        data = x.getImageData(0, 0, c.width, c.height);
      } catch {
        data = null;
      }
      resolve({ img, data });
    };
    img.onerror = () => resolve({ img, data: null });
    img.src = `${BANNER_TEX_BASE}${name}.png`;
  });
}

/**
 * 逐像素相乘着色：rgb = tex.rgb × 颜色（可带横向渐变，对应 GradientColor 的左右顶点色），
 * alpha = tex.a × 渐变 alpha。返回可直接 drawImage 的画布。
 */
function tinted(tex: Tex, left: readonly number[], right: readonly number[] = left): HTMLCanvasElement | HTMLImageElement {
  if (!tex.data) return tex.img;
  const { width: w, height: h } = tex.data;
  const src = tex.data.data;
  const out = new ImageData(w, h);
  const d = out.data;
  for (let x = 0; x < w; x++) {
    const u = w > 1 ? x / (w - 1) : 0;
    const r = lerp(left[0]!, right[0]!, u), g = lerp(left[1]!, right[1]!, u), b = lerp(left[2]!, right[2]!, u);
    const a = lerp(left[3] ?? 1, right[3] ?? 1, u);
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      d[o] = src[o]! * r; d[o + 1] = src[o + 1]! * g; d[o + 2] = src[o + 2]! * b; d[o + 3] = src[o + 3]! * a;
    }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(out, 0, 0);
  return c;
}

const TINT_STEPS = 64;

// ── 渲染器 ───────────────────────────────────────────────────────
export class ComboResult {
  readonly root: HTMLDivElement;
  private readonly glow: HTMLCanvasElement;
  private readonly ui: HTMLCanvasElement;
  private readonly fx: HTMLCanvasElement;
  private tex = new Map<string, Tex>();
  private nodeImg = new Map<number, CanvasImageSource>();
  private tintCache = new Map<string, CanvasImageSource>();
  private ready: Promise<void> | null = null;
  private last: number | null = null;
  private readonly resize: ResizeObserver | null;

  constructor(private readonly stage: HTMLElement) {
    // 容器不设 z-index（不建立层叠上下文），加色层的 mix-blend-mode 才能直接与下面的画面相加。
    this.root = document.createElement('div');
    this.root.className = 'combo-result';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    const mk = (cls: string) => {
      const c = document.createElement('canvas');
      c.className = `cr-layer ${cls}`;
      this.root.append(c);
      return c;
    };
    this.glow = mk('cr-glow');
    this.ui = mk('cr-ui');
    this.fx = mk('cr-fx');
    stage.append(this.root);
    this.resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (this.last !== null) this.render(this.last);
    });
    this.resize?.observe(stage);
  }

  /** 预载贴图（首次调用时开始）。 */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    const names = new Set<string>();
    for (const n of AP_BANNER_NODES) if (n.sprite) names.add(n.sprite);
    for (const e of AP_BANNER_EMITTERS) names.add(e.tex);
    this.ready = Promise.all([...names].map(async (n) => this.tex.set(n, await loadTex(n)))).then(() => {
      AP_BANNER_NODES.forEach((n, i) => {
        const t = n.sprite ? this.tex.get(n.sprite) : undefined;
        if (!t) return;
        // rgb 曲线全是常量绑定（与 Image.color 相同），着色可预先算好；alpha 由 globalAlpha 逐帧给。
        const s = nodeStateAt(n, 0);
        const base = [s.r, s.g, s.b, 1];
        const mul = (g: readonly number[]) => [base[0]! * g[0]!, base[1]! * g[1]!, base[2]! * g[2]!, g[3]!];
        this.nodeImg.set(i, n.gradL && n.gradR ? tinted(t, mul(n.gradL), mul(n.gradR)) : tinted(t, base));
      });
      if (this.last !== null) this.render(this.last);
    });
    return this.ready;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  dispose(): void {
    this.resize?.disconnect();
    this.root.remove();
    this.tintCache.clear();
  }

  hide(): void {
    this.last = null;
    this.root.hidden = true;
  }

  /** 画 clip 时刻 t（秒，钳制在 [0, 4]；4 s 之后停在末帧）。 */
  render(t: number): void {
    void this.load();
    const time = Math.max(0, Math.min(COMBO_RESULT_CLIP_DURATION, t));
    this.last = time;
    this.root.hidden = false;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    const s = hudScale(w, h) * dpr;
    const ctxs = [this.glow, this.ui, this.fx].map((c) => {
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
      const x = c.getContext('2d')!;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.globalAlpha = 1;
      x.clearRect(0, 0, pw, ph);
      return x;
    });
    const [gx, ux, fx] = ctxs as [CanvasRenderingContext2D, CanvasRenderingContext2D, CanvasRenderingContext2D];

    // Bg：全屏黑罩（常量，无曲线）
    ux.fillStyle = `rgba(${COMBO_RESULT_BG[0] * 255},${COMBO_RESULT_BG[1] * 255},${COMBO_RESULT_BG[2] * 255},${COMBO_RESULT_BG[3]})`;
    ux.fillRect(0, 0, pw, ph);

    // UI：层级顺序；变换沿父链累乘（y 向上 → 画布 y 向下）
    const states = AP_BANNER_NODES.map((n) => nodeStateAt(n, time));
    const visible = (i: number): boolean => i < 0 || (states[i]!.active && visible(AP_BANNER_NODES[i]!.parent));
    const place = (x: CanvasRenderingContext2D, i: number) => {
      const n = AP_BANNER_NODES[i]!;
      if (n.parent >= 0) place(x, n.parent);
      const st = states[i]!;
      x.translate(st.x, -st.y);
      if (n.rot) x.rotate(-n.rot * Math.PI / 180);
      x.scale(st.sx, st.sy);
    };
    AP_BANNER_NODES.forEach((n, i) => {
      const img = this.nodeImg.get(i);
      if (!img || !visible(i)) return;
      const a = states[i]!.a;
      if (a <= 0) return;
      ux.setTransform(s, 0, 0, s, pw / 2, ph / 2);
      place(ux, i);
      ux.globalAlpha = Math.min(1, a);
      ux.drawImage(img, -n.w / 2, -n.h / 2, n.w, n.h);
    });

    // 粒子：加色
    gx.globalCompositeOperation = 'lighter';
    fx.globalCompositeOperation = 'lighter';
    for (const p of AP_PARTICLES) {
      const e = AP_BANNER_EMITTERS[p.emitter]!;
      if (!visible(NODE_INDEX.get(e.path) ?? -1)) continue;
      const f = particleAt(p, e, time);
      if (!f || f.a <= 0 || f.w <= 0 || f.h <= 0) continue;
      const img = this.particleImage(e.tex, f.r, f.g, f.b);
      if (!img) continue;
      const x = e.underCanvas ? gx : fx;
      x.setTransform(s, 0, 0, s, pw / 2, ph / 2);
      x.translate(f.x, -f.y);
      if (f.rot) x.rotate(-f.rot);
      x.globalAlpha = Math.min(1, f.a);
      x.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
    }
  }

  private particleImage(name: string, r: number, g: number, b: number): CanvasImageSource | null {
    const t = this.tex.get(name);
    if (!t) return null;
    const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * TINT_STEPS);
    const key = `${name}|${q(r)}|${q(g)}|${q(b)}`;
    let img = this.tintCache.get(key);
    if (!img) {
      if (this.tintCache.size > 1024) this.tintCache.clear();
      img = tinted(t, [q(r) / TINT_STEPS, q(g) / TINT_STEPS, q(b) / TINT_STEPS, 1]);
      this.tintCache.set(key, img);
    }
    return img;
  }
}
