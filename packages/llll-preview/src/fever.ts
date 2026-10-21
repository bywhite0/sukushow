/** Fever 边线颜色与拖尾因子；几何为屏幕空间近似。时段见 `@sukushow/chart/fever`。 */

/** libunity：模块使用同一粒子 seed、不同偏移，整数混合后执行 float32 转换。 */
function trailSeedFactor(seed: number, offset: number): number {
  let x = (seed + offset) >>> 0;
  const y = (Math.imul(x, 0x6ab51b9d) + 0x714acb3f) >>> 0;
  x = (x ^ (x << 11)) >>> 0;
  const bits = ((y ^ x ^ (x >>> 8)) & 0x7fffff) ^ (y >>> 19);
  return Math.fround(Math.fround(bits) * 1.1920930376163597e-7);
}

/** libunity 0x12AB270–0x12AB2BC。 */
export function feverTrailWidthFactor(seed: number): number {
  return trailSeedFactor(seed, 0xfedc345b);
}

/** libunity 0x12AB338–0x12AB388：colorOverLifetime 的独立 seed 偏移。 */
export function feverTrailColorFactor(seed: number): number {
  return trailSeedFactor(seed, 0x591bc05c);
}

export const FEVER_LINE_CYCLE = 1.6;
/**
 * `LineMove`（#604/#570）的寿命 / 发射周期。
 *
 * 它与**入场彗星** `LineCoreMove`（`n_L/R`，#607/#627）不是一回事：
 * - `LineCoreMove` 是沿边线从近端（判定线一侧）跑向远端的行进高光，只在 Fever 起点射一次，
 *   并「拖着」彩虹边线由近及远揭示（`LineMask` 的 `scale.y` 0→68）；
 * - `LineMove` 是每 0.8 s 从**轨道顶部中央** `(0.024, 9.021, 0)` 射出、向**轨道外扩散**的
 *   长条：尺寸恒为 `(0.11, 120)`（远超可见范围，两端一路扫出画面外），合速度
 *   `(∓0.35, 0, 1.3)`，`looping` ⇒ 每个寿命周期重新出发。它**不沿边线跑**。
 */
export const FEVER_MOVE_CYCLE = 0.8;
/** `LineMove` 条带尺寸（宽 × 长，世界单位）：`startSize=(0.11, 120, 0.1)`，长轴 120。 */
export const FEVER_MOVE_SIZE: readonly [number, number] = [0.10999999940395355, 120];
/**
 * `LineMove` 的发射点（轨道顶部中央）水平坐标 `ShapeModule.m_Position.x`。
 * 条带中心从这里以 ∓0.35 u/s 向外漂；3D 观感上它贴着边线（垂距 0.6px → 16px），
 * 所以 2D 平铺时以边线为基准、再叠加这段漂移，而不是画在轨道中央。
 */
export const FEVER_MOVE_EMIT_X = 0.024000000208616257;

// 4.12.0 level56 ParticleSystem #542/#604 的 ColorModule，ctime/atime 为 uint16。
const COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.019788190722465515, 0],
  [1, 0, 0.8173365592956543],
  [0, 0.8462276458740234, 1],
  [0.053014516830444336, 1, 0],
  [1, 0.950401782989502, 0],
  [1, 0.35973283648490906, 0],
];
type AlphaKey = readonly [number, number];
const LINE_ALPHA: readonly AlphaKey[] = [
  [0, 0], [6554, 0.7058823704719543], [33731, 1], [58982, 0.7058823704719543], [65535, 0],
];
const MOVE_ALPHA: readonly AlphaKey[] = [
  [0, 0], [13107, 0.47058823704719543], [32768, 1], [52428, 0.47058823704719543], [65535, 0],
];

function gradientRgba(phase: number, alphaKeys: readonly AlphaKey[]): [number, number, number, number] {
  const t = ((phase % 1) + 1) % 1;
  const x = t * 5;
  const i = Math.min(4, Math.floor(x));
  const f = x - i;
  const from = COLORS[i], to = COLORS[i + 1];
  const keyTime = t * 65535;
  const end = alphaKeys.findIndex(([time]) => time > keyTime);
  const [t0, a0] = alphaKeys[end - 1];
  const [t1, a1] = alphaKeys[end];
  return [
    from[0] + (to[0] - from[0]) * f,
    from[1] + (to[1] - from[1]) * f,
    from[2] + (to[2] - from[2]) * f,
    a0 + (a1 - a0) * (keyTime - t0) / (t1 - t0),
  ];
}

/** 原始 RGB/alpha 分别线性插值；预览相位锚定 Fever 起点。 */
export function feverLineRgba(time: number, feverStart: number): [number, number, number, number] {
  return gradientRgba((time - feverStart) / FEVER_LINE_CYCLE, LINE_ALPHA);
}



export function feverMoveRgba(time: number, feverStart: number): [number, number, number, number] {
  return gradientRgba((time - feverStart) / FEVER_MOVE_CYCLE, MOVE_ALPHA);
}
