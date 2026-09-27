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

/** ComboAnimation（#96）StreamedClip 键时刻，取 float32 原值。 */
const CLIP96_T1 = 0.03333333507180214;
const CLIP96_T_ALPHA = 0.1666666716337204;
const CLIP96_T2 = 0.699999988079071;

/**
 * ComboAnimation（sharedassets56 #96）SpriteUpperRoot localScale（StreamedClip 三次段，系数为 float32 原值）：
 * 1（到 1/30s）→ (−2.85, 3.25, 0, 1) 到 1.6 @0.7s → (−268.8, 30.4, 0.5333, 1.6) 到 1.7 @47/60s，之后保持 1.7。
 */
export function comboFlashScale(age: number, duration = 0.7833333611488342): number {
  if (age <= CLIP96_T1) return 1;
  if (age >= duration) return 1.7000000476837158;
  if (age < CLIP96_T2) return evalStreamedPoly(age - CLIP96_T1, -2.8500008583068848, 3.2500007152557373, 0, 1);
  return evalStreamedPoly(age - CLIP96_T2, -268.7996520996094, 30.399972915649414, 0.533333420753479, 1.600000023841858);
}

/**
 * ComboAnimation Sprite*.color.a (sharedassets56 #96).
 * 0 until 1/30s → 1 hold until 1/6s → poly (8.5286,−7.889,0,1) → 0 @ duration.
 */
export function comboFlashAlpha(age: number, duration = 0.7833333611488342): number {
  if (age <= 0 || age >= duration) return 0;
  if (age < CLIP96_T1) return 0;
  if (age < CLIP96_T_ALPHA) return 1;
  return evalStreamedPoly(age - CLIP96_T_ALPHA, 8.528615951538086, -7.888969421386719, 0, 1);
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

/* ---------------------------------------------------------------------------
 * AP 継続（ScoreResolver.isApContinue，offset 0x158）。
 *
 * `Add` 里每次判定都做一次 `isApContinue &= (type & 0xFE) == 4`
 * （`0x49A1460`，`NoteJudgementTypes` Perfect=4 / PerfectPlus=5）⇒ 只要出现一次
 * Great 以下就**永久**关闭，直到 `Clear` 把它重置为 true（`0x49A2634`）。
 * 即「本局至今全程 Perfect 以上」。
 *
 * `UpdateCombo`（`0x49A1B40` → `0x49A4394`）里 `combo >= 1 && isApContinue` 才把
 * 8 个 `ComboEffectOutLine` 的渲染器打开；否则关闭。
 * ------------------------------------------------------------------------- */

/** Perfect 及以上（`(type & 0xFE) == 4`）。 */
export function isPerfectOrAbove(type: number): boolean {
  return (type & 0xfe) === 4;
}

/** 单次判定后推进 AP 継続状态。一旦为 false 不会因后续 Perfect 而恢复。 */
export function apContinueAfterHit(current: boolean, type: number): boolean {
  return current && isPerfectOrAbove(type);
}

/**
 * AP 継続特效是否显示。
 *
 * `UpdateCombo(int,bool)`（`0x49A1B40`）入口先做 `w21 = combo < 10 ? 0 : combo`，
 * 再把 `w21` 传给本层；层内 `cmp w22, #1 / b.lt` ⇒ 掩码后 <1 即整层关闭。
 * 合起来就是 **combo >= 10 且 isApContinue**（与数字行同一门槛）。
 */
export function apContinueEffectVisible(combo: number, isApContinue: boolean): boolean {
  return combo >= 10 && isApContinue;
}

/** 描边颜色 = `ColorModule` 渐变 rgb（两层同色）；贴图 `ui_sc2_ingame_num_combo_Effect` 本身纯白。 */
export const COMBO_EFFECT_RGB = { r: 0.04245281219482422, g: 0.5869302749633789, b: 1 } as const;
/** `_02`（下层）寿命 0.8s、`looping`；`_01`（上层）0.25s、单次。 */
export const COMBO_EFFECT_LOWER_LIFE = 0.8;
export const COMBO_EFFECT_UPPER_LIFE = 0.25;
/** 描边 `startColor.a`：`_02` = 186/255，`_01` = 1。 */
export const COMBO_EFFECT_LOWER_START_A = 0.729411780834198;
export const COMBO_EFFECT_UPPER_START_A = 1;
/**
 * Burst 数（`EmissionModule.m_Bursts[0]`，t=0）：描边 `_02` 4 颗、`_01` 5 颗；两层底光各 2 颗。
 * `ShapeModule` 是半径 1e-4 的圆、`startSpeed` 0 ⇒ 同一簇粒子完全重叠。
 */
export const COMBO_EFFECT_LOWER_BURST = 4;
export const COMBO_EFFECT_UPPER_BURST = 5;
export const COMBO_GLOW_BURST = 2;
/**
 * 上层激活延迟：ComboAnimation（sharedassets56 #96）里 `Sprite0~3/ComboEffectOutLine_01`
 * 的 `m_IsActive` 在 0.1167s（第 7 帧 @60fps）才 0→1；粒子是 `playOnAwake`，
 * `DoEffectCombo` 里那次 `Stop+Play` 发生在未激活期间，真正开播是这次激活。
 */
export const COMBO_EFFECT_UPPER_ACTIVATE_DELAY = 7 / 60;

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/**
 * `_01`（上层）`colorOverLifetime` alpha：键位 `atime` 0 / 10156 / 65535（归一化后
 * 0 / 0.155 / 1.0）对应 0 → 1 → 0，单次。
 */
export function comboEffectUpperAlpha(age: number): number {
  const t = age / COMBO_EFFECT_UPPER_LIFE;
  if (t <= 0) return 0;
  if (t >= 1) return 0;
  const peak = 10156 / 65535;
  return t < peak ? t / peak : (1 - t) / (1 - peak);
}

/**
 * `_02`（下层）`colorOverLifetime` alpha：键位 0 / 0.25 / 0.5 / 0.75 / 1.0 对应
 * 0.3529412 → 0.1176471（中段保持）→ 0.3529412，`looping` 常驻脉动。
 */
export function comboEffectLowerAlpha(age: number): number {
  const t = ((age / COMBO_EFFECT_LOWER_LIFE) % 1 + 1) % 1;
  const hi = 0.3529411852359772;
  const lo = 0.11764705926179886;
  if (t < 0.25) return lerp(hi, lo, t / 0.25);
  if (t < 0.75) return lo;
  return lerp(lo, hi, (t - 0.75) / 0.25);
}

/**
 * 加法混合（描边 `RhythmGame/Num Combo Effect` = Blend SrcAlpha One；
 * 上层底光 `Mobile/Particles/Additive`）下 N 颗同位粒子的叠加：亮度 = N × a（逐通道饱和）。
 * 预览按 N 个 `mix-blend-mode: plus-lighter` 副本实现；此函数给测试与估算用。
 */
export function additiveStack(a: number, n: number): number {
  return a * n;
}

/**
 * Alpha 混合（下层底光 `Mobile/Particles/Alpha Blended` = SrcAlpha OneMinusSrcAlpha）
 * 下 N 颗同色同位粒子的等效不透明度：1 − (1 − a)^N（逐像素，a = 贴图 alpha × 顶点 alpha）。
 * 预览直接叠 N 个元素让浏览器逐像素合成；此函数给测试与估算用。
 */
export function alphaBlendStack(a: number, n: number): number {
  return 1 - Math.pow(1 - a, n);
}

/**
 * `CharNumber.GetDigit`：在 `iTables = {9, 99, 999, …}` 里找第一个 ≥ n 的下标，位数 = 下标 + 1。
 * `ScoreResolver.Add`（0x49A1908–0x49A19AC）对新旧 combo 各算一次，
 * `isRefreshLoop = GetDigit(old) != GetDigit(new)`。
 */
export function comboDigitCount(n: number): number {
  let limit = 9;
  let digits = 1;
  while (n > limit && digits < 10) {
    limit = limit * 10 + 9;
    digits++;
  }
  return digits;
}

/** `UpdateCombo(int,bool)` 的 isRefreshLoop：位数变化时下层描边 + 底光 `Stop(true, Clear)` 后 `Play()`。 */
export function comboEffectRefreshLoop(prevCombo: number, combo: number): boolean {
  return comboDigitCount(prevCombo) !== comboDigitCount(combo);
}

/**
 * 数字列在 `ui_sc2_ingame_num_combo_Effect`（880×120）里的矩形。
 * 与着色器 `ImmCB_0` 列起点表一致：0, 0.102273, 0.181818, 0.284091 … 1.0（× 880）。
 * `1` 是窄字形（70px），其余 90px。
 */
export const COMBO_EFFECT_SHEET_W = 880;
export const COMBO_EFFECT_SHEET_H = 120;
export const COMBO_EFFECT_DIGIT_RECT: readonly { x: number; w: number }[] = [
  { x: 0, w: 90 },    // 0
  { x: 90, w: 70 },   // 1
  { x: 160, w: 90 },  // 2
  { x: 250, w: 90 },  // 3
  { x: 340, w: 90 },  // 4
  { x: 430, w: 90 },  // 5
  { x: 520, w: 90 },  // 6
  { x: 610, w: 90 },  // 7
  { x: 700, w: 90 },  // 8
  { x: 790, w: 90 },  // 9
];

/** 数字槽的布局尺寸（与 `.hud-cdigit` 一致）。 */
export const COMBO_EFFECT_SLOT_W = 90;
export const COMBO_EFFECT_SLOT_H = 120;
/** 描边粒子面片 `size3D` 0.85 × 1.09（100px/单位）。 */
export const COMBO_EFFECT_QUAD_W = 85;
export const COMBO_EFFECT_QUAD_H = 109;

/** 该数字列的宽度（1 是窄字形）。 */
export function comboEffectDigitWidth(digit: number): number {
  return COMBO_EFFECT_DIGIT_RECT[digit].w;
}

/**
 * 描边在槽内的绘制框（px，相对 90×120 槽左上角）与 mask 参数。
 *
 * 着色器（`RhythmGame/Num Combo Effect` 片元）：列宽 w = ImmCB[d+1] − ImmCB[d]；
 * - w ≥ 0.1（90px 列）：u = start + w × uv.x ⇒ 整列 90×120 铺满 85×109 面片；
 * - w ≤ 0.1（`1` 的 70px 列）：u = start + w × min(max(uv.x − 1/9, 0.02) × 9/7, 1)
 *   ⇒ 整块面片都采样：左侧 1/9 + 0.02 固定取 s = 0.0257 那一列，右侧 1/9 固定取列边界
 *   u = 0.181818（双线性与 `2` 的首列各半），中间 7/9 线性映射。
 *   这种非线性采样用 CSS mask 表达不了，改用 scripts/gen-combo-fx-tex.py 按同一公式预先采样的
 *   `ui_sc2_ingame_num_combo_Effect_1.png`，铺满整块面片（image = 'digit1'）。
 * 90px 列：横向缩放 85/90，纵向 109/120，居中于槽：
 *   宽 = 90 × 85/90 = 85，left = 2.5，top = (120 − 109) / 2。
 */
export function comboEffectOutlineBox(digit: number): {
  left: number; top: number; width: number; height: number;
  maskW: number; maskH: number; maskX: number;
  image: 'sheet' | 'digit1';
} {
  const r = COMBO_EFFECT_DIGIT_RECT[digit];
  const sx = COMBO_EFFECT_QUAD_W / 90;
  const sy = COMBO_EFFECT_QUAD_H / COMBO_EFFECT_SHEET_H;
  if (r.w < 90) {
    return {
      left: (COMBO_EFFECT_SLOT_W - COMBO_EFFECT_QUAD_W) / 2,
      top: (COMBO_EFFECT_SLOT_H - COMBO_EFFECT_QUAD_H) / 2,
      width: COMBO_EFFECT_QUAD_W,
      height: COMBO_EFFECT_QUAD_H,
      maskW: COMBO_EFFECT_QUAD_W,
      maskH: COMBO_EFFECT_QUAD_H,
      maskX: 0,
      image: 'digit1',
    };
  }
  const width = r.w * sx;
  return {
    left: (COMBO_EFFECT_SLOT_W - width) / 2,
    top: (COMBO_EFFECT_SLOT_H - COMBO_EFFECT_QUAD_H) / 2,
    width,
    height: COMBO_EFFECT_QUAD_H,
    maskW: COMBO_EFFECT_SHEET_W * sx,
    maskH: COMBO_EFFECT_SHEET_H * sy,
    maskX: r.x === 0 ? 0 : -r.x * sx,
    image: 'sheet',
  };
}

/**
 * 上层描边自身的缩放（ComboAnimation #96 `Sprite{i}/ComboEffectOutLine_01` localScale）。
 * 粒子 `scalingMode = Local`：尺寸只认自身 localScale，不继承 SpriteUpperRoot 的缩放；
 * 位置仍随父级缩放展开。Sprite0–2 与 SpriteUpperRoot 同一条曲线；Sprite3 在 0.7s 后停在 1.6。
 */
export function comboEffectUpperOutlineScale(slot: number, age: number): number {
  if (slot === 3) {
    if (age <= CLIP96_T1) return 1;
    if (age >= CLIP96_T2) return 1.600000023841858;
    return evalStreamedPoly(age - CLIP96_T1, -4.050001621246338, 4.05000114440918, 0, 1);
  }
  return comboFlashScale(age);
}

/* ---------------------------------------------------------------------------
 * 底光（ComboEffectBG_01）——每个描边下挂一枚柔和光斑（2 颗同位粒子）。
 *
 * `SizeModule` 两层都是 **disabled** ⇒ 尺寸恒为 `size3D`：上 2.0×2.5、下 2.3×2.8。
 * `scalingMode = Local` 且 ComboAnimation 里 BG 自身 scale 恒 1 ⇒ 上层底光不随跨百动画放大。
 * 材质：上 #21 `Mobile/Particles/Additive`（贴图 glow_002，RGB 纯白）；
 *       下 #22 `Mobile/Particles/Alpha Blended`（贴图 glow_002_alpha，RGB 逐像素在 202–255 间变化）。
 * 片元 = 贴图 × 顶点色，故下层颜色 = startColor × 贴图 RGB（逐像素）：
 * 由 scripts/gen-combo-fx-tex.py 预乘成 `sc2_effect_combo_glow_002_alpha_lower.png`。
 * 层级（`sortingOrder` 越小越靠后）：**上底光 1 → 数字 3/4 → 描边 9 → 下底光 10**。
 * ------------------------------------------------------------------------- */

/** 底光颜色 rgb（两层同色）。 */
export const COMBO_GLOW_RGB = { r: 0.4575, g: 0.7675, b: 1 } as const;
export const COMBO_GLOW_UPPER_W = 200;
export const COMBO_GLOW_UPPER_H = 250;
export const COMBO_GLOW_UPPER_ALPHA = 0.27450981736183167;
export const COMBO_GLOW_LOWER_W = 230;
export const COMBO_GLOW_LOWER_H = 280;
export const COMBO_GLOW_LOWER_ALPHA = 0.5882353186607361;
export const COMBO_GLOW_LIFE = 0.8;

/** 上层底光 `colorOverLifetime` alpha：0 → 0.5333@0.155 → 0（单次）。 */
export function comboGlowUpperCurve(age: number): number {
  const t = age / COMBO_GLOW_LIFE;
  if (t <= 0 || t >= 1) return 0;
  const peak = 10156 / 65535;
  const a = t < peak ? t / peak : (1 - t) / (1 - peak);
  return 0.5333333611488342 * a;
}

/** 下层底光 `colorOverLifetime` alpha：0.3529 → 0.1647@0.5 → 0.3529（`looping`）。 */
export function comboGlowLowerCurve(age: number): number {
  const t = ((age / COMBO_GLOW_LIFE) % 1 + 1) % 1;
  const hi = 0.3529411852359772;
  const lo = 0.16470588743686676;
  if (t < 0.5) return hi + (lo - hi) * (t / 0.5);
  return lo + (hi - lo) * ((t - 0.5) / 0.5);
}


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
