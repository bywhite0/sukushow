/**
 * 音符贴图的九宫格与 Hold 宽带网格——口径对齐原版，本仓库独立实现。
 *
 * 依据：
 * - 贴图与九宫格边距：`sprite_meta.json`（border / rect / ppu），与 llll-preview-web 同源。
 * - 音符尺寸：`ISlopeResolver.GetNoteSize(width) = ((width − 6) * 0.2 + 1.15, 1.0)`，
 *   再乘 prefab 的 SpriteRenderer scale.x = 0.75。
 * - Hold 宽带：`HoldMeshView` 三列顶点（左/中/右），左列与右列取 SideColor、
 *   中列取 CenterColor，RGB 恒定、alpha 随是否按住变化。
 *
 * 平面视图的换算：原版一格轨宽 laneWidth = 0.15 世界单位。这里令一格 = `lanePx` 像素，
 * 于是 `pxPerWorld = lanePx / LANE_WORLD`，横向与纵向共用同一比例，
 * 贴图纵横比与原版一致。
 */

import type { Note } from './chart';
import type { Layout } from './view';
import { timeY } from './view';

/** 原版一格轨宽（SlopeResolver.laneWidth 出厂值）。 */
export const LANE_WORLD = 0.15;

/** 与 view.LANES 一致；此处本地引用避免循环依赖。 */
const LANES_REF = 60;

/** HoldMeshView.cctor 常量：中心列与两侧列的 RGB。 */
export const HOLD_CENTER: readonly [number, number, number] = [46, 198, 255];
export const HOLD_SIDE: readonly [number, number, number] = [45, 248, 255];
/** 未按住时两列的 alpha（CenterColor.a / SideColor.a）。 */
export const HOLD_CENTER_ALPHA = 0.2;
export const HOLD_SIDE_ALPHA = 0.6;

/** prefab 里 SpriteRenderer 的 scale.x，九宫格边距按它缩放。 */
export const SPRITE_SCALE_X = 0.75;

export interface SpriteMeta {
  name: string;
  /** Unity Vector4：左、下、右、上。 */
  border: number[];
  rect: number[];
  ppu: number;
}

/** 四类音符对应的贴图名，索引 = Note.type。 */
export const NOTE_SPRITE: readonly string[] = [
  'ui_sc2_ingame_notes_tap',
  'ui_sc2_ingame_notes_hold',
  'ui_sc2_ingame_notes_flick',
  'ui_sc2_ingame_notes_trace',
];

/** 世界单位 → 像素。 */
export function pxPerWorld(lay: Layout): number {
  return lay.lanePx / LANE_WORLD;
}

/** 原版 GetNoteSize(width).x，未乘 scale。 */
export function noteWidthWorld(widthUnits: number): number {
  return (widthUnits - 6) * 0.2 + 1.15;
}

/** 原版音符纵向厚度（世界单位）：Trace 比其他三类薄。 */
export function noteDepthWorld(type: number): number {
  return type === 3 ? 0.35 : 0.45;
}

/** 贴图在平面视图里的目标尺寸（像素）。 */
export function noteSpriteSize(widthUnits: number, type: number, lay: Layout): { w: number; h: number } {
  const k = pxPerWorld(lay);
  return { w: noteWidthWorld(widthUnits) * SPRITE_SCALE_X * k, h: noteDepthWorld(type) * SPRITE_SCALE_X * k };
}

export interface SliceCaps {
  left: number;
  right: number;
  mid: number;
  /** 左边界的归一化 u。 */
  uL: number;
  /** 右边界的归一化 u。 */
  uR: number;
}

/**
 * 九宫格横向三段：左右端头按 border/ppu×scale 取宽，若两端头之和超过目标宽度则等比缩到恰好铺满
 * （对应 Unity SpriteDrawMode.Sliced 的行为），此时中段为 0。
 */
export function sliceCaps(meta: SpriteMeta | undefined, worldW: number): SliceCaps {
  const ppu = meta?.ppu || 100;
  const bw = meta?.rect[2] || 1;
  let left = ((meta?.border[0] || 0) / ppu) * SPRITE_SCALE_X;
  let right = ((meta?.border[2] || 0) / ppu) * SPRITE_SCALE_X;
  const sum = left + right;
  if (sum > worldW && sum > 0) {
    const k = worldW / sum;
    left *= k;
    right *= k;
  }
  return {
    left, right, mid: Math.max(0, worldW - left - right),
    uL: (meta?.border[0] || 0) / bw,
    uR: (meta?.border[2] || 0) / bw,
  };
}

/**
 * Hold 宽带的一条半边：三列顶点里的相邻两列构成一个四边形。
 * 左半边 = 左列→中列（Side→Center），右半边 = 中列→右列（Center→Side）。
 */
export interface BandHalf {
  /** 四角，顺序：头排近列、头排远列、尾排远列、尾排近列。 */
  corners: [number, number][];
  /**
   * 渐变轴的两个端点。原版的顶点色**沿带长恒定**（左列恒 Side、中列恒 Center、
   * 右列恒 Side），色场只随「垂直于带身的距离」变化，所以渐变轴必须垂直于带轴，
   * 否则斜置的带子会沿长度漂色。
   */
  gradFrom: [number, number];
  gradTo: [number, number];
  /** 起点与终点各自的颜色（含 alpha）。 */
  fromColor: [number, number, number, number];
  toColor: [number, number, number, number];
}

/**
 * 一个 Hold 节点的宽带半边。
 *
 * 原版三列的轨道坐标：
 *   GetLeftMeshX(xl)  = lane0Left + laneWidth * (xl + 1)   ⇒ 轨道坐标 l + 1
 *   GetRightMeshX(xr) = lane0Left + laneWidth * xr         ⇒ 轨道坐标 r
 *   GetCenterMeshX(m) = lane0Left + laneWidth * (m + 0.5)  ⇒ 轨道坐标 (l+r)/2 + 0.5
 * 即宽带比音符本体左右各内缩整一格：带宽 = (r − l − 1) 格 = (Width − 2) 格。
 */
export function bandHalves(note: Note, lay: Layout, active = false): BandHalf[] {
  const mid = (note.l + note.r) / 2, mid2 = (note.l2 + note.r2) / 2;
  const head = [note.l + 1, mid + 0.5, note.r];
  const tail = [note.l2 + 1, mid2 + 0.5, note.r2];
  const hx = head.map(p => laneX(p, lay));
  const tx = tail.map(p => laneX(p, lay));
  const y0 = timeY(note.time, lay), y1 = timeY(note.end, lay);
  const side: [number, number, number, number] = [...HOLD_SIDE, active ? 0.9 : HOLD_SIDE_ALPHA];
  const center: [number, number, number, number] = [...HOLD_CENTER, active ? 0.8 : HOLD_CENTER_ALPHA];
  const out: BandHalf[] = [];
  for (const [a, b] of [[0, 1], [1, 2]] as const) {
    // 带宽退化（Width ≤ 2）时该半边没有面积，原版会画出一条反向窄带，此处跳过。
    if (Math.abs(hx[b] - hx[a]) < 0.01 && Math.abs(tx[b] - tx[a]) < 0.01) continue;
    const corners: [number, number][] = [[hx[a], y0], [hx[b], y0], [tx[b], y1], [tx[a], y1]];
    out.push({
      corners,
      ...gradientAxis(corners),
      fromColor: a === 0 ? side : center,
      toColor: b === 2 ? side : center,
    });
  }
  return out;
}

/**
 * 把渐变轴摆到「垂直于带轴」的方向上。
 *
 * 直接取两列中点连线会得到一条水平轴，斜置带子据此上色就会沿长度漂色。
 * 这里把两列中点投影到过形心的带法线方向，得到真正的横向色场。
 */
function gradientAxis(c: [number, number][]): { gradFrom: [number, number]; gradTo: [number, number] } {
  const [ha, hb, tb, ta] = c;
  const headMid: [number, number] = [(ha[0] + hb[0]) / 2, (ha[1] + hb[1]) / 2];
  const tailMid: [number, number] = [(ta[0] + tb[0]) / 2, (ta[1] + tb[1]) / 2];
  const cx = (ha[0] + hb[0] + tb[0] + ta[0]) / 4;
  const cy = (ha[1] + hb[1] + tb[1] + ta[1]) / 4;
  // 带轴方向与其法线；带轴退化为点时退回水平。
  let dx = tailMid[0] - headMid[0], dy = tailMid[1] - headMid[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) { dx = 0; dy = 1; }
  const nx = -dy / Math.max(len, 1e-9), ny = dx / Math.max(len, 1e-9);
  // 两列中点各自沿法线投影到过形心的直线。
  const proj = (p: [number, number]): [number, number] => {
    const t = (p[0] - cx) * nx + (p[1] - cy) * ny;
    return [cx + nx * t, cy + ny * t];
  };
  const aMid: [number, number] = [(ha[0] + ta[0]) / 2, (ha[1] + ta[1]) / 2];
  const bMid: [number, number] = [(hb[0] + tb[0]) / 2, (hb[1] + tb[1]) / 2];
  const pa = proj(aMid), pb = proj(bMid);
  // 法线取反时保证起点仍是 a 列一侧。
  const forward = (pb[0] - pa[0]) * (bMid[0] - aMid[0]) + (pb[1] - pa[1]) * (bMid[1] - aMid[1]) >= 0;
  return forward ? { gradFrom: pa, gradTo: pb } : { gradFrom: pb, gradTo: pa };
}

/** 连续轨道坐标 → 画布 x（含镜像）。 */
export function laneX(pos: number, lay: Layout): number {
  return lay.padX + (lay.mirror ? LANES_REF - pos : pos) * lay.lanePx;
}

/** 链上各节点的宽带半边，顺序 = 源数组顺序。 */
export function chainBandHalves(root: Note, lay: Layout, active = false): BandHalf[] {
  const out: BandHalf[] = [];
  let node: Note | undefined = root;
  while (node) {
    if (node.end > node.time) out.push(...bandHalves(node, lay, active));
    node = node.next;
  }
  return out;
}

export function cssRgba(c: readonly [number, number, number, number]): string {
  return `rgba(${c[0]} ${c[1]} ${c[2]} / ${c[3]})`;
}
