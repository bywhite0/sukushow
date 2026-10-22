/**
 * LLLL「SIF（半圆）」取景与径向下落曲线。
 *
 * 参考 LoveLive! School Idol Festival 的判定环布局：判定环沿一条 **180° 半圆** 排开，
 * 音符从圆心（原包的「中心图标」）沿半径向外飞向判定弧，越接近判定弧越大。
 * 于是整条轨道是半圆盘：圆心在画面上方、判定弧从左侧经下方绕到右侧。
 *
 * 本预览器保留 LLLL 的 60 lane 坐标系与贴图，只把「x = 车道、z = 下落距离」的直角轨道
 * 换成极坐标：
 *
 * - **角度**：可玩轨道半宽 `LANE_HALF_WIDTH`（60 lane × `BASE_LANE_WIDTH` 0.15 / 2 = 4.5）
 *   映射到 ±90°，所以 lane 29.5 在正下方、lane 0 / 59 在左右两端（水平方向）；
 * - **半径**：`u` = 0（圆心 = 出生点）→ 1（判定弧）。判定弧半径取
 *   `ARC_RADIUS_WORLD = 2·LANE_HALF_WIDTH / π`，于是 **判定弧的弧长 = 可玩轨道跨度 9**：
 *   同一张音符在判定弧上的弧宽 / 车道间距与 3D、2D 完全一致，只有「轨道是弯的」这一点不同；
 * - **下落曲线**：SIF 的径向速度恒定（`r ∝ 剩余时间`），所以 `createArcSlope` 用线性映射，
 *   提前量时长仍取 3D 曲线在同样 `speed` 下的 `duration`（与 2D 一致），`NoteStartZ` 语义不变；
 * - **取景**：垂直俯视的透视相机。所有音符都在同一高度 `Y`、与相机等距 ⇒ 世界 → 屏幕等比
 *   （与 2D 同理），所以只需定下「判定弧半径占屏幕多少」与「圆心高度」，其余量都能反解。
 *
 * 取景参数（预览设置）：
 * - 「SIF 轨道半径」= 判定弧半径占 `min(舞台宽, 16:9 × 舞台高)` 的百分比（默认 38%）。
 *   取 min 是为了超宽画布下扇形仍然整块落在画面里（16:9 时等价于占宽 38%）；
 * - 「SIF 圆心高度」= 圆心占舞台高度的百分比（默认 25%，与 SIF 的 170/682 一致）。
 */
import { BORDER, Y, clamp, createSlope, spawnForStartZ, type Slope } from './geometry';
import { LANE_HALF_WIDTH, LINE_OVERHANG, TAP_LINE_ATLAS_H, TAP_LINE_WIDTH } from './flatView';

/**
 * 判定弧半径（世界单位）：180° 弧长 = 可玩轨道跨度 `2 · LANE_HALF_WIDTH`。
 *
 * 这样判定弧上的弧长尺度与 3D / 2D 的轨道宽度一致（一个 lane = 0.15 世界宽 = 3°），
 * 音符在判定弧上的横向大小不需要额外缩放。
 */
export const ARC_RADIUS_WORLD = (2 * LANE_HALF_WIDTH) / Math.PI;
/** 扇形的半角：180° 半圆（左侧 lane 0 → 正下方 lane 29.5 → 右侧 lane 59）。 */
export const ARC_HALF_ANGLE = Math.PI / 2;
/** SIF 参考比例：判定环所在的 1024×682 画面是 3:2，扇形按 16:9 基准取 min 以适配超宽画布。 */
export const ARC_ASPECT = 16 / 9;
/** 「SIF 轨道半径」（占 min(舞台宽, 16:9 × 舞台高) 的百分比）的可调范围与默认值。 */
export const ARC_RADIUS_MIN = 26;
/**
 * 上限 44：判定弧底端 = 圆心 + 半径，而默认圆心在 25% 高度，1.778 × 44% ≈ 78% 已经接近画布底边，
 * 再大就只能靠 `arcFrame` 的剩余空间封顶（`radiusCapped`）。圆心抬高后这段余量才用得满。
 */
export const ARC_RADIUS_MAX = 44;
export const ARC_RADIUS_DEFAULT = 38;
/** 「SIF 圆心高度」（占舞台高度的百分比）的可调范围与默认值。SIF 原比例 170/682 ≈ 24.9%。 */
export const ARC_CENTER_MIN = 12;
export const ARC_CENTER_MAX = 40;
export const ARC_CENTER_DEFAULT = 25;
/**
 * 判定弧贴图带的世界厚度：把 9-slice 判定线（设计宽 1612、高 54）等比缩到
 * 「轨道跨度 × `LINE_OVERHANG`」的弧长上，厚度 = 54 / 1612 × 弧长 —— 与 2D 里判定线
 * 贴图的高度 / 宽度比例一致。
 */
export const ARC_JUDGE_BAND = (TAP_LINE_ATLAS_H / TAP_LINE_WIDTH) * (2 * LANE_HALF_WIDTH * LINE_OVERHANG);

export interface ArcFrame {
  /** 舞台 CSS 尺寸。 */
  width: number;
  height: number;
  /** 世界单位 → CSS px（俯视下水平 = 垂直，等比）。 */
  scale: number;
  /** 相机位置（Three 坐标）。 */
  camY: number;
  camZ: number;
  /** 圆心在 Unity 世界里的 z（x 恒为 0）；音符在 `u = 0` 时落在这里。 */
  centerZ: number;
  /** 圆心在画布上的 y（CSS px，自上而下）。 */
  centerScreenY: number;
  /** 判定弧半径：世界单位 / 画布 CSS px。 */
  radius: number;
  radiusPx: number;
  /** 设置值是否被「剩余画布空间」压小（见 `arcFrame` 的 roomX / roomY）。 */
  radiusCapped: boolean;
  /** 判定弧的弧长（CSS px）= π × `radiusPx`。 */
  arcPx: number;
  /** 判定弧贴图带的世界厚度。 */
  bandWidth: number;
  /** 角度归一化用的世界半宽（= `LANE_HALF_WIDTH` × LaneWidth 缩放）。 */
  laneHalfWidth: number;
  /** 扇形半角（弧度，= π/2）。 */
  fanHalfAngle: number;
  /** 当前生效的「SIF 轨道半径 / 圆心高度」设置（百分比）。 */
  radiusOpt: number;
  centerOpt: number;
}

/** 预览设置的「SIF 轨道半径」百分比 → 占取景基准的比例（夹在可调范围内）。 */
export function arcRadiusFraction(percent: number): number {
  const p = Number.isFinite(percent) ? percent : ARC_RADIUS_DEFAULT;
  return clamp(p, ARC_RADIUS_MIN, ARC_RADIUS_MAX) / 100;
}

/** 预览设置的「SIF 圆心高度」百分比 → 占舞台高度的比例（夹在可调范围内）。 */
export function arcCenterFraction(percent: number): number {
  const p = Number.isFinite(percent) ? percent : ARC_CENTER_DEFAULT;
  return clamp(p, ARC_CENTER_MIN, ARC_CENTER_MAX) / 100;
}

/**
 * 由舞台尺寸 + 相机 fov 推出 SIF 半圆取景。
 *
 * `radiusPx` 由「判定弧半径 = `radiusPercent`% × min(宽, 16:9 高)」定死，`scale` 随之确定；
 * `camY` 反解自俯视透视（`scale = (h/2) / ((camY − Y)·tan(fov/2))`），
 * `camZ` 反解自「圆心落在 `centerPercent`% × 舞台高」—— 圆心上下移动时相机跟着走，
 * 圆心与判定弧仍然钉在新位置。所有音符都在 `y = Y` 的同一平面、与相机等距，所以画面等比。
 */
export function arcFrame(
  width: number, height: number, fovDeg = 60,
  radiusPercent = ARC_RADIUS_DEFAULT, centerPercent = ARC_CENTER_DEFAULT,
): ArcFrame {
  const ui = Math.min(width, height * ARC_ASPECT);
  const desiredPx = arcRadiusFraction(radiusPercent) * ui;
  const centerScreenY = arcCenterFraction(centerPercent) * height;
  // 圆心到画布底边 / 左右边缘的剩余空间：设置值再大也不让判定弧跑出画面（默认 38% / 25% 不会触发）。
  const roomY = Math.max(0, height - centerScreenY - height * 0.02);
  const roomX = Math.max(0, width / 2 - width * 0.02);
  const radiusPx = Math.min(desiredPx, roomY, roomX);
  const scale = radiusPx / ARC_RADIUS_WORLD;
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  /** 俯视相机的透视强度：`A = 半屏高 / tan(fov/2)` = 「相机到音符面的距离 × 像素/单位」。 */
  const A = height / (2 * tan);
  // 圆心放在判定线所在的 z 上只为了给世界坐标一个参照；相机 z 会把它反解回 centerScreenY。
  const centerZ = BORDER;
  const camY = Y + A / scale;
  // 屏幕 y = h/2 + (threeZ − camZ) × scale，圆心的 three z = −centerZ。
  const camZ = -centerZ - (centerScreenY - height / 2) / scale;
  return {
    width, height, scale, camY, camZ, centerZ, centerScreenY,
    radius: ARC_RADIUS_WORLD, radiusPx, radiusCapped: radiusPx < desiredPx - 1e-6,
    arcPx: Math.PI * radiusPx,
    bandWidth: ARC_JUDGE_BAND,
    // SIF 固定 180°、LaneWidth 不参与角度映射，所以归一化半宽恒为基准值。
    laneHalfWidth: LANE_HALF_WIDTH, fanHalfAngle: ARC_HALF_ANGLE,
    radiusOpt: clamp(Number.isFinite(radiusPercent) ? radiusPercent : ARC_RADIUS_DEFAULT, ARC_RADIUS_MIN, ARC_RADIUS_MAX),
    centerOpt: clamp(Number.isFinite(centerPercent) ? centerPercent : ARC_CENTER_DEFAULT, ARC_CENTER_MIN, ARC_CENTER_MAX),
  };
}

/** 世界 x → 扇形角度：`x = ±laneHalfWidth` 映射到 ±90°，lane 29.5 在正下方（0°）。 */
export function arcAngle(x: number, laneHalfWidth = LANE_HALF_WIDTH): number {
  const half = laneHalfWidth > 0 ? laneHalfWidth : LANE_HALF_WIDTH;
  return clamp(x / half, -1, 1) * ARC_HALF_ANGLE;
}

/**
 * 世界 z → 径向比例 `u`（0 = 圆心 / 出生点，1 = 判定弧）。
 *
 * `spawnZ` 是下落曲线在出生点的 z（`Slope.spawn`）：`z = spawnZ` ⇒ u = 0，
 * `z = BORDER` ⇒ u = 1；超出范围钳位（判定的 0.18 s 内已经越过判定线、以及 Hold 尾巴在
 * 出生点之外的情况）。`NoteStartZ = 100` 时 `spawnZ == BORDER`，退化为整段都在判定弧上。
 */
export function arcRadiusAt(z: number, spawnZ: number): number {
  const span = spawnZ - BORDER;
  if (!(Math.abs(span) > 1e-9)) return z <= BORDER ? 1 : 0;
  return clamp(1 - (z - BORDER) / span, 0, 1);
}

export interface ArcPoint {
  /** Unity 世界坐标（x, z）。 */
  x: number;
  z: number;
  /** 径向比例（0 圆心 → 1 判定弧）。 */
  u: number;
  /** 扇形角度（弧度，0 = 正下方，负 = 左侧）。 */
  angle: number;
  /**
   * 贴图朝向：音符横轴沿切线、纵轴指向圆心。传给 `pushBillboard` / `pushSlicedNote`
   * 的 `rot`（俯视平面内旋转，见 slice.ts 的约定）。
   */
  rot: number;
}

/**
 * 把一个「直角轨道坐标」(x, z) 投影到半圆盘上。
 *
 * - 角度由 x 归一化得到（`arcAngle`），半径 = `u × ARC_RADIUS_WORLD`；
 * - 圆心在 `(0, centerZ)`。**Unity 的 z 越大 = 离相机越远 = 屏幕越靠上**（BORDER = −4.632 在
 *   判定线处、SPAWN = 52 在出生点），所以「圆心 → 判定弧」是屏幕向下，取
 *   `z = centerZ − cos(angle) · r`：lane 29.5（angle = 0）沿屏幕正下方落，lane 0 / 59 落在
 *   圆心左右两端（水平直径）上；
 * - `rot = angle`：局部 +x（贴图横轴）指向切线方向（lane 增大方向），局部 +y 指向圆心
 *   （= 3D 里「沿轨道向上、远离判定线」的那一侧），所以音符的竖轴朝向与 3D / 2D 一致。
 */
export function arcPoint(frame: ArcFrame, x: number, z: number, spawnZ: number): ArcPoint {
  const u = arcRadiusAt(z, spawnZ);
  const angle = arcAngle(x, frame.laneHalfWidth);
  const r = frame.radius * u;
  return {
    x: Math.sin(angle) * r,
    z: frame.centerZ - Math.cos(angle) * r,
    u, angle, rot: angle,
  };
}

/**
 * SIF 的线性径向下落曲线：`zAt(remaining) = BORDER + (spawn − BORDER) · remaining / duration`。
 *
 * - 径向速度恒定（SIF 的 `r ∝ 剩余时间`），屏幕上是匀速从圆心滑向判定弧；
 * - `duration` = 3D 曲线在同样 `speed` 下的 `duration` × `(1 − NoteStartZ/100)`，
 *   所以 `NoteStartZ` 与 3D 同义（只缩短读谱窗口，不改变判定线处的速度）；
 * - `spawn` 与 3D 的 `spawnForStartZ` 一致，`renderer` 的可见范围 / 轨道绘制直接复用。
 */
export function createArcSlope(speed: number, noteStartZ = 0): Slope {
  // 复用 3D 曲线做 speed 校验，并取出 spawn(0) 处的提前量时长（speed 5 时 ≈ 1.4516s）。
  const { duration: duration3D } = createSlope(speed, 0);
  const startZ = clamp(noteStartZ, 0, 100);
  const spawn = spawnForStartZ(startZ);
  const span = spawn - BORDER;
  const duration = Math.max(1e-6, duration3D * (1 - startZ / 100));
  return { duration, speed, spawn, zAt: (remaining: number) => BORDER + span * (remaining / duration) };
}
