/**
 * LLLL 2D（俯视）取景与下落曲线。
 *
 * 2D 模式把整条轨道压到音符平面（y = `Y`）上，用一台垂直向下的透视相机拍摄。相机离得足够远，
 * 世界 → 屏幕近似仿射（等比缩放），于是：
 *
 * - **判定点对齐**：判定点（`BORDER`）钉在判定线贴图的中心高度 `judgeY`，音符判定点因此落在
 *   贴图正中；`judgeY` 由预览设置「2D 判定线位置」（占舞台高度 %，默认 73%）给出，上下移动时
 *   判定线贴图、两侧边线近端、下落窗口与轨道平面底边一起跟随；
 * - **判定线两端出轨道**：判定线贴图比轨道宽 `LINE_OVERHANG`（默认 12%），两端伸到轨道外面
 *   （3D 里贴图是固定 1612 设计 px，看起来也是压在轨道边线之外）；`lineScale` 让贴图等比
 *   缩到这个宽度；
 * - **轨道 = 可玩轨道跨度**：轨道宽度（`trackPercent`% × 舞台宽，默认 60%）量的是 60 个 lane
 *   的跨度（`LANE_HALF_WIDTH`），所以音符横向正好撑满轨道（与 3D 一致）；平面在 `y = PLANE_Y`
 *   （比音符面低 0.54），投影比例比音符面小 `planeFitX` 倍，于是把平面横向缩到
 *   `planeScaleX = 0.9·planeFitX`，投影边缘正好落在两侧边线（= 音符外沿）上；
 * - **等速下落**：俯视下 3D 的 `zAt` 曲线会「远端慢、近端快」，音符全挤在判定线附近；
 *   这里改成线性映射（屏幕位移 ∝ 时间），提前量时长仍取 3D 曲线在同样 `speed` 下的
 *   `duration`，所以 2D 的读谱窗口与 3D 一致、且全程匀速。
 */
import { BASE_LANE_WIDTH, BORDER, PLANE_Y, Y, clamp, createSlope, type Slope } from './geometry';

/** Plane prefab 的世界半宽（LaneWidth = 100 时）。 */
export const PLANE_HALF_WIDTH = 5;
/**
 * 可玩轨道的世界半宽（LaneWidth = 100 时）：60 个 lane × `BASE_LANE_WIDTH` 0.15 = 9 世界宽。
 *
 * 3D 里轨道两侧的可见边线（`laneOutline`，屏幕空间里按透视收敛的斜线）在判定线处正好压在
 * 音符外沿上（实测差 0.5%），所以 2D 的「轨道宽度」也取这个跨度：**音符横向撑满轨道**。
 */
export const LANE_HALF_WIDTH = 30 * BASE_LANE_WIDTH;
/**
 * 两侧轨道边线的世界半宽：原包 `LineBase` 的作者值 x = ∓5.03（比可玩轨道略外一点），
 * 3D 的 Fever 彩虹边线画在这里；2D 收到 `LANE_HALF_WIDTH`（见 `railX`）。
 */
export const RAIL_HALF_WIDTH = PLANE_HALF_WIDTH * 1.006;
/** 2D 轨道宽度（= 舞台宽的百分比）的可调范围与默认值，见预览设置「2D 轨道宽度」。 */
export const FLAT_TRACK_MIN = 30;
export const FLAT_TRACK_MAX = 90;
export const FLAT_TRACK_DEFAULT = 60;
/** 默认轨道宽度占舞台宽的比例（LaneWidth = 100 时）。比 3D 判定线（84%）窄，读谱更从容。 */
export const FLAT_TRACK_FRACTION = FLAT_TRACK_DEFAULT / 100;
/** 判定线贴图比轨道宽出的比例：两端各伸出 `(LINE_OVERHANG − 1)/2`，不让线头缩在轨道里。 */
export const LINE_OVERHANG = 1.12;
/** 判定线贴图（`sc2_ingame_tap_line`）在 UI 设计坐标里的宽度，见 renderer.buildUi。 */
export const TAP_LINE_WIDTH = 1612;
/** 判定线贴图中心相对舞台中心的 y 偏移（UI 设计坐标，屏幕向下为正）。3D 固定用它。 */
export const JUDGE_LINE_OFFSET = 253;
/**
 * 2D 判定线高度：占舞台高度的百分比（`judgeY = height × p%`），见预览设置「2D 判定线位置」。
 *
 * 默认 73% ≈ 3D 的 `h/2 + 253·uiScale`（16:9 时 0.5 + 253/1080 = 73.4%），上下移动时判定线贴图、
 * 轨道边线近端、下落窗口与轨道平面底边一起跟随。
 */
export const FLAT_JUDGE_MIN = 55;
export const FLAT_JUDGE_MAX = 90;
export const FLAT_JUDGE_DEFAULT = 73;
/** 轨道平面在画布底边之外再补长的世界长度：防止平面底边露在画面里。 */
export const PLANE_BOTTOM_MARGIN = 2;
/** 2D 相机俯角：垂直向下（Three 的 rotation.x = −FLAT_PITCH）。 */
export const FLAT_PITCH = Math.PI / 2;
/** 设计坐标系（HUD / laneUi）的基准尺寸。 */
export const UI_DESIGN_WIDTH = 1920;
export const UI_DESIGN_HEIGHT = 1080;

export interface FlatFrame {
  /** 舞台 CSS 尺寸。 */
  width: number;
  height: number;
  /** 世界单位 → CSS px（水平 = 垂直，俯视下两者等比）。 */
  scale: number;
  /** 判定点在画布上的 y（自上而下，CSS px）。 */
  judgeY: number;
  /** 判定线上方的可见世界长度（判定点 → 画布顶），即 2D 的下落区。 */
  field: number;
  /** 判定线下方的可见世界长度（判定点 → 画布底）。 */
  below: number;
  /** 相机位置（Three 坐标）。 */
  camY: number;
  camZ: number;
  /** 画布底边（音符面 y = `Y`）对应的 Three z：判定线贴图 / 边线近端都在这里收边。 */
  bottomZ: number;
  /**
   * 轨道平面自身高度（y = `PLANE_Y`）上、画布底边对应的 Three z，再往相机侧留
   * `PLANE_BOTTOM_MARGIN`：平面近端推到这里，底边才不会露在画面里。
   */
  planeNearZ: number;
  /**
   * 轨道平面的投影比例：平面在 y = `PLANE_Y`（比音符面低 0.54），离相机更远，所以同一个世界
   * 宽度在平面上投影得比音符面小，倍数 = `scale / planeScale`（> 1）。
   */
  planeFitX: number;
  /**
   * 平面在 X 上的缩放：把平面（与作为其子节点的 `LaneLines`）收/放到「投影宽度 = 轨道宽度」，
   * 于是平面边缘 = 两侧边线 = 音符外沿。3D 里是 1（原包宽度）。
   */
  planeScaleX: number;
  /** 两侧轨道边线的世界 x（= `LANE_HALF_WIDTH`，2D 与音符外沿重合；3D 的 Fever 边线在 ±5.03）。 */
  railX: number;
  /** 判定线贴图（UI 设计坐标）的中心 y：`(h/2 − judgeY) / uiScale`，屏幕向下为正。 */
  lineUiY: number;
  /** 判定线贴图的等比缩放：缩放后贴图宽度 = 轨道宽度 × `LINE_OVERHANG`。 */
  lineScale: number;
  /** 判定线在画布上的实际宽度（CSS px），比轨道宽 `LINE_OVERHANG` 倍。 */
  linePx: number;
  /** 轨道（平面 / 边线）在画布上的宽度（CSS px）。 */
  trackPx: number;
}

/** 预览设置的「2D 轨道宽度」百分比 → 占舞台宽的比例（夹在可调范围内）。 */
export function flatTrackFraction(trackPercent: number): number {
  const p = Number.isFinite(trackPercent) ? trackPercent : FLAT_TRACK_DEFAULT;
  return clamp(p, FLAT_TRACK_MIN, FLAT_TRACK_MAX) / 100;
}

/** 预览设置的「2D 判定线位置」百分比 → 判定点在舞台高度上的比例（夹在可调范围内）。 */
export function flatJudgeFraction(judgePercent: number): number {
  const p = Number.isFinite(judgePercent) ? judgePercent : FLAT_JUDGE_DEFAULT;
  return clamp(p, FLAT_JUDGE_MIN, FLAT_JUDGE_MAX) / 100;
}

/** 设计坐标缩放（与 renderer.resize 的 uiRoot.scale 同一规则）。 */
export function designScale(width: number, height: number): number {
  return Math.min(width / UI_DESIGN_WIDTH, height / UI_DESIGN_HEIGHT);
}

/**
 * 由舞台尺寸 + 相机 fov 推出 2D 俯视取景。
 *
 * `scale` 由「轨道宽度 = `trackPercent`% × 舞台宽」定死（轨道 = 60 个 lane 的跨度，音符正好
 * 撑满），其余量都是它的函数；`camY` 反解自透视投影（`scale = (h/2) / ((camY − Y)·tan(fov/2))`），
 * `camZ` 反解自「判定点落在 `judgeY = height × judgePercent%`」——判定线上下移动时，
 * 相机 z 跟着走，所以判定点仍然钉在新位置，`field` / `below` / 平面底边一起重算。
 */
export function flatFrame(
  width: number, height: number, fovDeg = 60, trackPercent = FLAT_TRACK_DEFAULT,
  judgePercent = FLAT_JUDGE_DEFAULT,
): FlatFrame {
  const uiScale = designScale(width, height);
  const judgeY = height * flatJudgeFraction(judgePercent);
  const tan = Math.tan((fovDeg * Math.PI) / 360);
  /** 俯视相机的透视强度：`A = 半屏高 / tan(fov/2)` = 「相机到音符面的距离 × 像素/单位」。 */
  const A = height / (2 * tan);
  /** 轨道平面比音符面低这么多（`Y − PLANE_Y`），投影比例因此比音符面小 `planeFitX` 倍。 */
  const drop = Y - PLANE_Y;
  /**
   * 「2D 轨道宽度」= 可玩轨道（60 个 lane，世界 ±`LANE_HALF_WIDTH`）占舞台宽的比例。
   * 轨道宽度在音符面上量（音符撑满轨道），所以 `scale` 直接线性于百分比。
   */
  const trackPx = flatTrackFraction(trackPercent) * width;
  const scale = trackPx / (2 * LANE_HALF_WIDTH);
  const field = judgeY / scale;
  const below = (height - judgeY) / scale;
  const camY = Y + A / scale;
  const camZ = -BORDER - (judgeY - height / 2) / scale;
  // 平面在 y = PLANE_Y，离相机更远 ⇒ 投影比例比音符面小 planeFitX 倍（> 1）。
  const planeScale = (scale * (camY - Y)) / (camY - PLANE_Y);
  const planeFitX = scale / planeScale;
  // 轨道 = 可玩轨道跨度：两侧边线压在音符外沿上（`LANE_HALF_WIDTH`），音符横向撑满轨道。
  const railX = LANE_HALF_WIDTH;
  // 平面（与作为其子节点的分割线）横向缩到「投影宽度 = 轨道宽度」⇒ 平面边缘 = 边线 = 音符外沿。
  // 平面在更低的 y 上，投影比例小 planeFitX 倍，所以要乘回去。
  const planeScaleX = (railX * scale) / (PLANE_HALF_WIDTH * planeScale);
  // 判定线两端要伸出轨道：整体比轨道宽 LINE_OVERHANG 倍（两端各伸出 6%）。
  const linePx = trackPx * LINE_OVERHANG;
  const lineScale = linePx / (TAP_LINE_WIDTH * uiScale);
  // 平面底边：按平面自身高度的投影比例换算到画布底边，再往相机侧留一段余量。
  const planeNearZ = camZ + height / 2 / planeScale + PLANE_BOTTOM_MARGIN;
  return {
    width, height, scale, judgeY, field, below, camY, camZ,
    bottomZ: -BORDER + below,
    planeNearZ, planeFitX, planeScaleX, railX,
    lineUiY: (height / 2 - judgeY) / uiScale,
    lineScale, linePx, trackPx,
  };
}

/** 2D 的 fever 边线：两侧边线的 x 与可见轨道在 z 上的范围（判定线端 → 远端）。 */
export interface FlatRail {
  railX: number;
  zNear: number;
  zFar: number;
  /**
   * `LineMask` 已揭示的比例（0–1，0.4333s 走完）。3D 里火花 / 边线都被遮罩挡在揭示范围外，
   * 2D 没有 stencil，用这个比例把火花的出生位置限制在已揭示段里。
   */
  reveal?: number;
}

/**
 * 2D 下把 fever 边线层（`LineCoreMove` 彗星 / `LineParticle` 火花）贴到轨道边上。
 *
 * 3D 里这两层走的是「屏幕空间」的轨迹：彗星沿入场曲线 `(∓18.46,−9.4,0)` →
 * `(∓1.96,6.9,25.8)` 从画面外侧斜着飞进来，火花则由一个中心在 `x=∓6.87`（轨道之外）、
 * 沿边线方向排布的 box 发射器撒出。俯视投影后前者变成一条横穿轨道、直奔画面外的斜线，
 * 后者摊成轨道外的一条斜带 —— 都不再是「边线上的东西」。
 *
 * 所以 2D 改成：x 贴边线（`±railX`），z 按 `railT`（0 = 判定线端，1 = 远端）沿轨道边展开，
 * 粒子自身的漂移照常叠加（`drift` 由调用方按出生点算好，竖直漂移同样折到 z 上）。
 */
export function flatRailPoint(
  side: 'left' | 'right', rail: FlatRail, railT: number,
  drift: { x?: number; y?: number; z?: number } = {},
): { x: number; y: number; z: number } {
  const t = Math.min(1, Math.max(0, railT));
  return {
    x: (side === 'left' ? -1 : 1) * rail.railX + (drift.x ?? 0),
    y: Y,
    z: rail.zNear + t * (rail.zFar - rail.zNear) + (drift.y ?? 0) + (drift.z ?? 0),
  };
}

/**
 * 2D 线性下落曲线：`zAt(remaining) = BORDER + v · remaining`。
 *
 * - 速度 `v = field / duration3D`：可见长度在 3D 的同一提前量时长内走完，
 *   所以屏幕速度恒定、2D / 3D 的读谱窗口一致；
 * - `NoteStartZ` 与 3D 同义：只把出生点（顶边）往下挪，不改变判定线处的速度。
 */
export function createFlatSlope(speed: number, noteStartZ = 0, field: number): Slope {
  if (!Number.isFinite(field) || field <= 0) throw new Error('2D 可见下落长度需大于 0');
  // 复用 3D 曲线做 speed 校验，并取出 spawn(0) 处的提前量时长（speed 5 时 ≈ 1.4516s）。
  const { duration: duration3D } = createSlope(speed, 0);
  const startZ = clamp(noteStartZ, 0, 100);
  const v = field / duration3D;
  const spawn = BORDER + field * (1 - startZ / 100);
  const duration = (spawn - BORDER) / v;
  return { duration, speed, spawn, zAt: (remaining: number) => BORDER + v * remaining };
}
