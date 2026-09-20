/** Fever 时段与边线颜色；几何仍为屏幕空间近似。 */

export type FeverWindow = { start: number; end: number };

export function isFeverAt(time: number, win: FeverWindow | null | undefined): boolean {
  if (!win) return false;
  return time >= win.start && time < win.end;
}

export const FEVER_LINE_CYCLE = 1.6;
export const FEVER_MOVE_CYCLE = 0.8;
/** 近似亮条长度占边线的比例，不是原始粒子的屏幕投影。 */
export const FEVER_MOVE_LENGTH = 0.044;

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

/** 屏幕空间往复近似，不代表原始 ParticleSystem 的运动轨迹。 */
export function feverMovePhase(time: number, feverStart: number): number {
  const t = ((time - feverStart) / FEVER_MOVE_CYCLE) % 2;
  const x = t < 0 ? t + 2 : t;
  return x < 1 ? x : 2 - x;
}

export function feverMoveLocalY(phase01: number): number {
  const u = Math.min(1, Math.max(0, phase01));
  return -703 + u * (694 - (-703));
}

export function feverMoveRgba(time: number, feverStart: number): [number, number, number, number] {
  return gradientRgba((time - feverStart) / FEVER_MOVE_CYCLE, MOVE_ALPHA);
}
