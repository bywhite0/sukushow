/**
 * 屏幕 CSS 坐标 → 轨道 lane 的纯数学部分（渲染器与输入层共用）。
 *
 * lane 坐标 0…59 浮点，29.5 = 屏幕正中。三种相机模式各自把触点换算成「每 lane 多少
 * CSS px」或「相对判定弧圆心的角度」，再折成 lane。结果不 clamp：轨道外的触点按同一
 * 比例外推，越界由判定引擎处理。
 */

/** 屏幕正中的 lane 坐标。 */
export const LANE_CENTER = 29.5;

/**
 * 3D：由判定线处相邻两 lane 的投影屏幕 x 反算 lane。
 *
 * `lane0ScreenX` / `lane1ScreenX` 是 lane 29.5 与 30.5（跨画布正中）的屏幕 x，
 * `width` 是画布 CSS 宽 —— lane 29.5 的世界 x 为 0，恒落在画布正中。
 */
export function laneFromProjectedX(
  x: number, width: number, lane0ScreenX: number, lane1ScreenX: number,
): number {
  const pxPerLane = lane1ScreenX - lane0ScreenX;
  if (!(Math.abs(pxPerLane) > 1e-9)) return Number.NaN;
  return LANE_CENTER + (x - width / 2) / pxPerLane;
}

/** 2D：由每 lane 的屏幕像素宽（`frame.scale × lanePitch`）反算 lane。 */
export function laneFromFlatX(x: number, width: number, pxPerLane: number): number {
  if (!(Math.abs(pxPerLane) > 1e-9)) return Number.NaN;
  return LANE_CENTER + (x - width / 2) / pxPerLane;
}

/**
 * SIF：由「判定弧圆心 → 触点」的角度反算 lane（0 = 正下方 lane 29.5，正 = 右侧）。
 * 判定弧只有 180°，角度先夹到 [-π/2, π/2]。
 */
export function laneFromArcAngle(angle: number): number {
  const half = Math.PI / 2;
  const a = Math.max(-half, Math.min(half, angle));
  return LANE_CENTER + (a / half) * 30;
}
