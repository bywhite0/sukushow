/**
 * 曲终横幅 RhythmGameComboResult（level56 GO 370），四档 AP / FC / Clear / Finish。
 * 自动演奏恒为 AP；其余三档由配置项手动选择预览。
 *
 * 时序：LiveEnd.Is = FinishTime ≤ t，FinishTime = MusicsRecord.PlayTime(ms) / 1000。
 * ComboResultResolver.ShowAsync（@0x4B01A80）按 GetResultIndex（AP→0，FC→1，Clear→2，Finish→3）
 * 互斥激活 roots[idx]，播放 ComboResultSeNames[idx]（AP 0004 … Finish 0001），然后 animator.Play 4 s 的 clip。
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
import { fnv1a, lcg } from './rng';
import { sampleCurve } from './startAnim';
import {
  COMBO_RESULT_BANNERS,
  COMBO_RESULT_BG,
  COMBO_RESULT_CLIP_DURATION,
  COMBO_RESULT_TEXTURES,
  type BannerClip,
  type BannerCurve,
  type BannerEmitter,
  type BannerNode,
} from './comboResultClip';

export { COMBO_RESULT_CLIP_DURATION };

/** GetResultIndex：0 AllPerfect、1 FullCombo、2 Clear、3 Finish。 */
export type ResultKind = 0 | 1 | 2 | 3;
export const RESULT_KINDS: readonly ResultKind[] = [0, 1, 2, 3];

export const BANNER_TEX_BASE = '/rg/banner/';
/** 粒子单位：1 unit = 100 设计像素（与 HUD 同一 1920×1080 参考分辨率）。 */
export const BANNER_UNIT = 100;
/** 1920×1080 参考高度；maxParticleSize 按视口高度的比例换算（参照系为推断）。 */
const DESIGN_H = 1080;

// ── 随机数（确定性；Unity 自身的随机序列无法复现，只保证同一时刻同一结果）──────────
export { fnv1a, lcg } from './rng';

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

/** 一档横幅的预处理结果：曲线按路径索引、节点下标、整次 Play 的全部粒子。 */
export type CompiledBanner = {
  clip: BannerClip;
  curves: Map<string, Map<string, BannerCurve['keys']>>;
  index: Map<string, number>;
  particles: readonly BannerParticle[];
};

export type NodeState = {
  active: boolean;
  x: number; y: number; sx: number; sy: number;
  r: number; g: number; b: number; a: number;
};

export function nodeStateAt(node: BannerNode, t: number, b: CompiledBanner = BANNERS[0]!): NodeState {
  const m = b.curves.get(node.path);
  const get = (p: Prop, base: number) => {
    const keys = m?.get(p);
    return keys ? sampleCurve(keys, t) : base;
  };
  const c = node.rgba ?? [1, 1, 1, 1];
  return {
    // 四个 Root 在 prefab 里只有当前档是 active；运行时由 RhythmGameComboResult 按结果档位 SetActive(true)，
    // 所以 Root 本身恒视为激活，只看其下节点的 active 与曲线。
    active: node.parent < 0 || get('active', node.active ? 1 : 0) > 0.5,
    x: get('x', node.x), y: get('y', node.y),
    sx: get('scale.x', node.sx), sy: get('scale.y', node.sy),
    r: get('r', c[0]), g: get('g', c[1]), b: get('b', c[2]), a: get('a', c[3]),
  };
}

/** GameObject 被激活的时刻（自身与所有祖先的 active 曲线都为 1 的最早时刻），即 playOnAwake 开播时刻。 */
export function activationTime(path: string, b: CompiledBanner = BANNERS[0]!): number {
  let idx = b.index.get(path);
  let start = 0;
  while (idx !== undefined && idx >= 0) {
    const n = b.clip.nodes[idx]!;
    if (n.parent < 0) break; // Root 由代码激活（见 nodeStateAt）
    const keys = b.curves.get(n.path)?.get('active');
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
  speed: number;
  /** 出生位置（unit，y 向上）与平面内运动方向（单位向量；Box 发射沿视线，平面内为 0）。 */
  ox: number; oy: number; dx: number; dy: number;
  size: number; sizeY: number; rotSpeed: number; limit: number;
};

/**
 * 一次 Play 的全部粒子。随机数顺序：系统 startDelay → 每粒子 life、speed、angle、radius、
 * size、sizeY、rotation、limit。burst 共 cycles 轮，每轮间隔 repeatInterval，每轮发 count 个。
 * Circle 形状（radius · radiusThickness）：厚度 0 恰在边上；厚度 > 0 时在环带内按面积均匀取半径（分布为推断）。
 * 方向沿半径向外（Circle 发射方向）。绕 X 转 180° 只是镜像，均匀角分布下不影响。
 * Box 形状（boxThickness 0 = 整个体积）：在 scale.x × scale.y 矩形内均匀取点；发射方向沿形状局部 ±Z，
 * 即视线方向，平面投影下不产生位移（投影按正交处理，为推断）。
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
      let ox: number, oy: number, dx: number, dy: number;
      if (e.shape === 'box') {
        const box = e.box!;
        ox = (rnd() - 0.5) * box[0];
        oy = (rnd() - 0.5) * box[1];
        dx = 0; dy = 0;
      } else {
        const angle = rnd() * Math.PI * 2;
        const ur = rnd();
        const r0 = e.thickness === 0 ? e.radius : Math.sqrt(inner * inner + ur * (e.radius * e.radius - inner * inner));
        dx = Math.cos(angle); dy = Math.sin(angle);
        ox = dx * r0; oy = dy * r0;
      }
      const size = range(e.size, rnd());
      const sizeY = e.sizeY ? range(e.sizeY, rnd()) : size;
      const rotSpeed = e.rotSpeed ? range(e.rotSpeed, rnd()) : 0;
      const limit = e.limit ? range(e.limit, rnd()) : Infinity;
      out.push({ emitter: index, spawn, life, speed, ox, oy, dx, dy, size, sizeY, rotSpeed, limit });
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
  const k = e.sizeKeys ? evalHermite(e.sizeKeys, x) : 1;
  const cap = e.maxSize * DESIGN_H;
  const g = e.grad ? evalGradient(e.grad, x) : [1, 1, 1, 1];
  return {
    x: (p.ox + p.dx * dist) * BANNER_UNIT,
    y: (p.oy + p.dy * dist) * BANNER_UNIT,
    w: Math.min(cap, Math.max(0, p.size * k * BANNER_UNIT)),
    h: Math.min(cap, Math.max(0, p.sizeY * k * BANNER_UNIT)),
    rot: p.rotSpeed * age,
    r: e.color[0] * g[0]!, g: e.color[1] * g[1]!, b: e.color[2] * g[2]!, a: e.color[3] * g[3]!,
  };
}

function compile(clip: BannerClip): CompiledBanner {
  const curves = new Map<string, Map<string, BannerCurve['keys']>>();
  for (const c of clip.curves) {
    let m = curves.get(c.path);
    if (!m) curves.set(c.path, (m = new Map()));
    m.set(c.prop, c.keys);
  }
  const b: CompiledBanner = { clip, curves, index: new Map(clip.nodes.map((n, i) => [n.path, i])), particles: [] };
  b.particles = clip.emitters.flatMap((e, i) => spawnEmitter(e, i, activationTime(e.path, b)));
  return b;
}

/** 按 ResultKind 排列的四档横幅。 */
export const BANNERS: readonly CompiledBanner[] = COMBO_RESULT_BANNERS.map(compile);
export const AP_PARTICLES: readonly BannerParticle[] = BANNERS[0]!.particles;

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
/** 横幅画到的视口（与 HUD 相同）。 */
export type ResultView = { cssW: number; cssH: number; dpr: number };

export class ComboResult {
  private tex = new Map<string, Tex>();
  /** 每档每个节点预着色好的贴图（键 = kind × 1000 + 节点下标）。 */
  private nodeImg = new Map<number, CanvasImageSource>();
  private kind: ResultKind = 0;
  private tintCache = new Map<string, CanvasImageSource>();
  private ready: Promise<void> | null = null;
  private loaded = false;
  private last: number | null = null;

  /** 预载贴图（首次调用时开始）。 */
  load(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = Promise.all(COMBO_RESULT_TEXTURES.map(async (n) => this.tex.set(n, await loadTex(n)))).then(() => {
      BANNERS.forEach((b, k) => b.clip.nodes.forEach((n, i) => {
        const t = n.sprite ? this.tex.get(n.sprite) : undefined;
        if (!t) return;
        // rgb 曲线全是常量绑定（与 Image.color 相同），着色可预先算好；alpha 由 globalAlpha 逐帧给。
        const s = nodeStateAt(n, 0, b);
        const base = [s.r, s.g, s.b, 1];
        const mul = (g: readonly number[]) => [base[0]! * g[0]!, base[1]! * g[1]!, base[2]! * g[2]!, g[3]!];
        this.nodeImg.set(k * 1000 + i, n.gradL && n.gradR ? tinted(t, mul(n.gradL), mul(n.gradR)) : tinted(t, base));
      }));
      this.loaded = true;
    });
    return this.ready;
  }

  /** 贴图是否已全部就绪（导出前等待）。 */
  get texturesReady(): boolean {
    return this.loaded;
  }

  /** 当前显示的档位（roots[kind]）。 */
  get resultKind(): ResultKind {
    return this.kind;
  }

  setKind(kind: ResultKind): void {
    this.kind = kind;
  }

  get visible(): boolean {
    return this.last !== null;
  }

  /** 当前显示的 clip 时刻；隐藏时为 null。 */
  get clipTime(): number | null {
    return this.last;
  }

  dispose(): void {
    this.last = null;
    this.tintCache.clear();
  }

  hide(): void {
    this.last = null;
  }

  /** 设定 clip 时刻 t（秒，钳制在 [0, 4]；4 s 之后停在末帧），下一次 draw 画出。 */
  render(t: number): void {
    void this.load();
    this.last = Math.max(0, Math.min(COMBO_RESULT_CLIP_DURATION, t));
  }

  /**
   * 画当前帧（最上层）。原先三张叠放的 canvas（glow 加色 / ui 普通 / fx 加色）直接按顺序画进同一画布：
   * 加色层先在自身内相加再加到画面上，与逐个粒子直接加到画面上结果相同（饱和截断只影响已为 1 的通道）；
   * 普通 alpha 层按 source-over 结合律同样等价。
   */
  draw(ctx: CanvasRenderingContext2D, view: ResultView): void {
    const time = this.last;
    if (time === null) return;
    const pw = view.cssW * view.dpr, ph = view.cssH * view.dpr;
    if (pw <= 0 || ph <= 0) return;
    const s = hudScale(view.cssW, view.cssH) * view.dpr;
    const b = BANNERS[this.kind]!;
    const nodes = b.clip.nodes;
    const states = nodes.map((n) => nodeStateAt(n, time, b));
    const visible = (i: number): boolean => i < 0 || (states[i]!.active && visible(nodes[i]!.parent));
    ctx.save();
    // 原三张图层用画布默认的平滑质量（low），这里保持一致。
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    const particles = (under: boolean) => {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of b.particles) {
        const e = b.clip.emitters[p.emitter]!;
        if (!!e.underCanvas !== under) continue;
        if (!visible(b.index.get(e.path) ?? -1)) continue;
        const f = particleAt(p, e, time);
        if (!f || f.a <= 0 || f.w <= 0 || f.h <= 0) continue;
        const img = this.particleImage(e.tex, f.r, f.g, f.b);
        if (!img) continue;
        ctx.setTransform(s, 0, 0, s, pw / 2, ph / 2);
        ctx.translate(f.x, -f.y);
        if (f.rot) ctx.rotate(-f.rot);
        ctx.globalAlpha = Math.min(1, f.a);
        ctx.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    // 1. Glow（黑罩之下）
    particles(true);

    // 2. Bg：全屏黑罩（常量，无曲线）+ UI（层级顺序；变换沿父链累乘，y 向上 → 画布 y 向下）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(${COMBO_RESULT_BG[0] * 255},${COMBO_RESULT_BG[1] * 255},${COMBO_RESULT_BG[2] * 255},${COMBO_RESULT_BG[3]})`;
    ctx.fillRect(0, 0, pw, ph);
    const place = (i: number) => {
      const n = nodes[i]!;
      if (n.parent >= 0) place(n.parent);
      const st = states[i]!;
      ctx.translate(st.x, -st.y);
      if (n.rot) ctx.rotate(-n.rot * Math.PI / 180);
      ctx.scale(st.sx, st.sy);
    };
    nodes.forEach((n, i) => {
      const img = this.nodeImg.get(this.kind * 1000 + i);
      if (!img || !visible(i)) return;
      const a = states[i]!.a;
      if (a <= 0) return;
      ctx.setTransform(s, 0, 0, s, pw / 2, ph / 2);
      place(i);
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, -n.w / 2, -n.h / 2, n.w, n.h);
    });
    ctx.globalAlpha = 1;

    // 3. 其余发射器（加色，压在 Canvas 之上）
    particles(false);
    ctx.restore();
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
