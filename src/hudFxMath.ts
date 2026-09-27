/** Pure HUD FX helpers (AP/Voltage rings, combo flash, AP増加). RE: PLAN §31/35/46/47 + HUD_LAYOUT. */

/** Fractional part in [0, 1) for Image.Filled Radial360 fillAmount. Exact integers → 0. */
export function radialFillAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = value - Math.trunc(value);
  return f < 0 ? f + 1 : f;
}

/** Cross-100 / 200 / … trigger: floor(prev/100) != floor(cur/100) and cur >= 100. */
export function shouldComboHundredFlash(prevCombo: number, curCombo: number): boolean {
  if (curCombo < 100) return false;
  return Math.trunc(prevCombo / 100) !== Math.trunc(curCombo / 100);
}

/** StreamedClip cubic: ((a·dx+b)·dx+c)·dx+d (AssetStudio / Unity). */
function evalStreamedPoly(dx: number, a: number, b: number, c: number, d: number): number {
  return ((a * dx + b) * dx + c) * dx + d;
}

/** ComboAnimation 0.7833s — scale 1→1.6@0.7→1.7 (piecewise linear on normalized t). */
export function comboFlashScale(age: number, duration = 0.7833333611488342): number {
  if (age <= 0) return 1;
  if (age >= duration) return 1.7;
  const t = age / duration;
  if (t <= 0.7) return 1 + (1.6 - 1) * (t / 0.7);
  return 1.6 + (1.7 - 1.6) * ((t - 0.7) / 0.3);
}

/**
 * ComboAnimation Sprite*.color.a (sharedassets56 #96).
 * 0 until 1/30s → 1 hold until 1/6s → poly (8.5286,−7.889,0,1) → 0 @ duration.
 */
export function comboFlashAlpha(age: number, duration = 0.7833333611488342): number {
  if (age <= 0 || age >= duration) return 0;
  if (age < 1 / 30) return 0;
  if (age < 1 / 6) return 1;
  return evalStreamedPoly(age - 1 / 6, 8.5286, -7.889, 0, 1);
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** APIncreaseAnimation 0.75s — scale 1→1.5 via smoothstep(t/(7/12)). */
export function apRateFlashScale(age: number, duration = 0.75): number {
  if (age <= 0) return 1;
  const peakAt = (7 / 12) * duration; // 7/12 of full timeline in RE uses t/(7/12) with t in seconds of anim
  // RE: scale = lerp(1, 1.5, smoothstep(t / (7/12))) with t in [0, duration], clamped.
  const u = smoothstep(age / (7 / 12));
  return 1 + 0.5 * Math.min(1, u);
}

/** APIncreaseAnimation alpha 1→0 via 1−smoothstep(t/0.75). */
export function apRateFlashAlpha(age: number, duration = 0.75): number {
  if (age <= 0) return 1;
  if (age >= duration) return 0;
  return 1 - smoothstep(age / duration);
}

export const AP_RATE_FLASH_RGB = { r: 1, g: 0.2275, b: 0.6 } as const;
export const COMBO_FLASH_DURATION = 0.7833333611488342;
export const AP_RATE_FLASH_DURATION = 0.75;



/**
 * ApGageIncreaseAnimation / VoltageIncreaseAnimation (sharedassets56 #95/#97).
 * Duration 0.6s. Scale: 1 until 0.1s; then poly from key@0.1 (−12.8, 9.6, 0, 1) → 1.8 @0.6s.
 */
export const AP_GAGE_FLASH_DURATION = 0.6;

export function apGageFlashScale(age: number): number {
  if (age <= 0.1) return 1;
  if (age >= AP_GAGE_FLASH_DURATION) return 1.8;
  return evalStreamedPoly(age - 0.1, -12.8, 9.6, 0, 1);
}

/** fontColor.a: 0 until 0.1s; poly from key@0.1 (16, −12, 0, 1) → 0 @0.6s. */
export function apGageFlashAlpha(age: number): number {
  if (age < 0.1) return 0;
  if (age >= AP_GAGE_FLASH_DURATION) return 0;
  return evalStreamedPoly(age - 0.1, 16, -12, 0, 1);
}

/** ScoreAddTween @0x486177C — duration 0.2, u=min(age,0.2)*5. */
export const SCORE_ADD_TWEEN = 0.2;
/** scoreAddHideTime = t + 0.7 (same as judgement hide). */
export const SCORE_ADD_LIFE = 0.7;
/** Prefab rest anchored X (level56); tween end is 304. */
export const SCORE_ADD_REST_X = 305.8;
export const SCORE_ADD_REST_Y = -52;
/** Preview: shift whole float a bit left of binary X. */
export const SCORE_ADD_X_NUDGE = -40;

/** Anchored X: -48*u*(u-2)+256 (u in [0,1]). */
export function scoreAddTweenX(age: number): number {
  const u = Math.min(Math.max(age, 0), SCORE_ADD_TWEEN) * 5;
  return -48 * u * (u - 2) + 256;
}

/** Color.a: -0.4*u*(u-2)+0.6 → 0.6 at birth, 1 at u=1. */
export function scoreAddTweenAlpha(age: number): number {
  const u = Math.min(Math.max(age, 0), SCORE_ADD_TWEEN) * 5;
  return -0.4 * u * (u - 2) + 0.6;
}

/* ---------------------------------------------------------------------------
 * APRateEffect（level56 `ComboRoot/APRateUpper/APRateEffect` #227）。
 * 四个子发射器的 Transform 全为单位变换，因此都锚在 240×40 徽章的中心。
 * 主体是粉色四角星粒子（#564/#565）从徽章周围爆发；#563 Root / #530 Bg_core
 * 只是垫在后面的底光。
 * ------------------------------------------------------------------------- */

/** 三层贴图爆发的寿命（#563/#530 startLifetime 常量 1.0）。 */
export const AP_RATE_BURST_DURATION = 1;
/** clip #94 在 t=1/60s 才把 APRateEffect SetActive(true)，爆发整体延后一帧。 */
export const AP_RATE_BURST_ACTIVATE_DELAY = 1 / 60;
/** #563 Root 基准 2.54×0.63 世界单位（×100 ⇒ px）。 */
export const AP_RATE_BURST_ROOT = { w: 254, h: 63 } as const;
/** #530 Bg_core 基准 4×3。 */
export const AP_RATE_BURST_CORE = { w: 400, h: 300 } as const;
/** #565/#564 发射环：ShapeModule.radius 0.08 × ShapeModule.scale (13.5, 3)。 */
export const AP_RATE_BURST_RING = { rx: 108, ry: 24 } as const;
/** radiusThickness 0.3 ⇒ 出生半径落在 [0.7, 1] 的环带上。 */
export const AP_RATE_BURST_RING_INNER = 0.7;
/**
 * 底光两层的亮度增益。
 * 原包是 Additive 粒子，预览用 `mix-blend-mode:screen` 近似时会偏亮，
 * 故按与实机录像的实测比值（0.80）压一档。
 */
export const AP_RATE_BURST_ROOT_GAIN = 0.8;
/** `Bg_core` 的基准不透明度 = 原包 `startColor.a`（0.5372549）× 底光增益。 */
export const AP_RATE_BURST_CORE_ALPHA_GAIN = 0.5372549295425415 * 0.8;

interface CurveKey { t: number; v: number; i: number; o: number }

/** 非加权 Hermite 关键帧采样（与 fx.ts 的 lerpKeys 同式，Unity 非加权切线）。 */
function hermite(keys: CurveKey[], t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i].t) continue;
    const a = keys[i - 1], b = keys[i];
    const span = b.t - a.t;
    const k = span > 0 ? (t - a.t) / span : 0;
    const k2 = k * k, k3 = k2 * k;
    return (2 * k3 - 3 * k2 + 1) * a.v + (k3 - 2 * k2 + k) * span * a.o
      + (-2 * k3 + 3 * k2) * b.v + (k3 - k2) * span * b.i;
  }
  return last.v;
}

/** Gradient 的 alpha 键按线性插值（Unity 渐变语义）。 */
function linearKeys(keys: { t: number; v: number }[], t: number): number {
  if (!keys.length) return 1;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    if (t > keys[i].t) continue;
    const span = keys[i].t - keys[i - 1].t;
    const k = span > 0 ? (t - keys[i - 1].t) / span : 0;
    return keys[i - 1].v + (keys[i].v - keys[i - 1].v) * k;
  }
  return last.v;
}

/** #563/#530 SizeModule.curve：[(0,0,out 7.9385),(0.2609,0.9385,in 0.4995)]，curveMultiplier 1.35。 */
const BURST_SIZE_KEYS: CurveKey[] = [
  { t: 0, v: 0, i: 7.9384613037109375, o: 7.9384613037109375 },
  { t: 0.2608909606933594, v: 0.9384613037109375, i: 0.4994986057281494, o: 0.4994986057281494 },
];
const BURST_SIZE_MULT = 1.35;
/** #563 Root ColorModule 的 alpha 键。 */
const BURST_ROOT_ALPHA: { t: number; v: number }[] = [
  { t: 0.008773937590600443, v: 1 },
  { t: 0.42983138780804153, v: 0 },
];
/** #530 Bg_core ColorModule 的 alpha 键。 */
const BURST_CORE_ALPHA: { t: number; v: number }[] = [
  { t: 0.008773937590600443, v: 1 },
  { t: 1, v: 0 },
];
/** #565/#564 SizeModule.curve：[(0,0,out 2),(1,1,in 0)]，curveMultiplier 1.0。 */
const BURST_PARTICLE_SIZE_KEYS: CurveKey[] = [
  { t: 0, v: 0, i: 2, o: 2 },
  { t: 1, v: 1, i: 0, o: 0 },
];
/** #565/#564 colorOverLifetime 的 maxGradient alpha 键。 */
const BURST_PARTICLE_ALPHA: { t: number; v: number }[] = [
  { t: 0.008773937590600443, v: 1 },
  { t: 1, v: 0 },
];

/**
 * Root / Bg_core 的尺寸倍率：0 → 0.9385×1.35 @0.2609，之后保持。
 * 两者共用同一条曲线；调用方把它乘到 254×63 / 400×300 的基准尺寸上。
 */
export function apRateBurstScale(age: number, life = AP_RATE_BURST_DURATION): number {
  if (age <= 0) return 0;
  if (age >= life) return BURST_SIZE_KEYS[1].v * BURST_SIZE_MULT;
  return hermite(BURST_SIZE_KEYS, age / life) * BURST_SIZE_MULT;
}

/** #563 Root 的 alpha：1 @0.0088 → 0 @0.4298（整个爆发里最先消失的一层）。 */
export function apRateBurstRootAlpha(age: number, life = AP_RATE_BURST_DURATION): number {
  if (age <= 0) return BURST_ROOT_ALPHA[0].v;
  return linearKeys(BURST_ROOT_ALPHA, age / life);
}

/** #530 Bg_core 的 alpha：1 @0.0088 → 0 @1.0（整寿命线性淡出）。 */
export function apRateBurstCoreAlpha(age: number, life = AP_RATE_BURST_DURATION): number {
  if (age <= 0) return BURST_CORE_ALPHA[0].v;
  return linearKeys(BURST_CORE_ALPHA, age / life);
}

/** #565/#564 的尺寸倍率，入参为该粒子自身寿命的归一化年龄。 */
export function apRateBurstParticleScale(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return hermite(BURST_PARTICLE_SIZE_KEYS, u);
}

/** #565/#564 的 alpha，入参为该粒子自身寿命的归一化年龄。 */
export function apRateBurstParticleAlpha(u: number): number {
  return linearKeys(BURST_PARTICLE_ALPHA, u);
}

/**
 * LimitVelocityOverLifetime 的位移积分（#565/#564 均 `enabled=True`）。
 *
 * Unity 语义：`v(t) = lim + (v0 − lim)·e^(−κt)`，其中 `κ = −ln(1 − dampen) × 50`
 * （同 `fx.ts` 的 HitFx 限速）。
 * 位移是它的积分：`s(t) = lim·t + (v0 − lim)·(1 − e^(−κt)) / κ`；
 * `dampen=0` 时退化为 `v0·t`。
 *
 * @param v0x,v0y 初速度（px/s，已含方向）
 * @param t 已存活时间（s）
 * @param limit 限速上限（px/s，`magnitude`）
 * @param dampen 阻尼（0–1）
 * @returns `[x, y]` 相对出生点的位移（px）
 */
export function apRateBurstTravel(
  v0x: number, v0y: number, t: number, limit: number, dampen: number,
): [number, number] {
  if (t <= 0) return [0, 0];
  const v0 = Math.hypot(v0x, v0y);
  if (v0 <= 1e-9) return [0, 0];
  // 阻尼系数：dampen=0 ⇒ κ=0（无限），此时速度恒为 v0。
  const kappa = dampen > 0 ? -Math.log(1 - Math.min(dampen, 0.999999)) * 50 : 0;
  // 沿初速方向的标量位移。
  let dist: number;
  if (kappa <= 1e-9) {
    dist = v0 * t;
  } else {
    const decay = 1 - Math.exp(-kappa * t);
    dist = limit * t + (v0 - limit) * decay / kappa;
  }
  const k = dist / v0; // 按方向等比缩放回 xy
  return [v0x * k, v0y * k];
}
