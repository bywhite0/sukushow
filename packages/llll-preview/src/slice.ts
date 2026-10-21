/** Horizontal 9-slice and note-size helpers.
 * Cap width = (borderPx / ppu) * silhouetteScale.x, then scaled down if the
 * caps would exceed the target width (Unity SpriteDrawMode.Sliced).
 */

export const PITCH = 33.2 * Math.PI / 180;

/** HoldMeshView.cctor xmmword_1B001D0 / xmmword_1B00700 (HOLD_MESH.md). */
export const HOLD_CENTER: readonly [number, number, number] = [46 / 255, 198 / 255, 1];
export const HOLD_SIDE: readonly [number, number, number] = [45 / 255, 248 / 255, 1];
export const PHASE_START = 4.712389;
export const PHASE_STEP = 0.2;

export interface SpriteMeta {
  border: number[];
  rect: number[];
  ppu: number;
}

export function worldWidthOf(widthUnits: number, laneWidthOpt = 100) {
  return ((widthUnits - 6) * 0.2 + 1.15) * 0.75 * (laneWidthOpt / 100);
}

export function worldDepth(type: number) {
  return type === 3 ? 0.35 : 0.45;
}

/** Cosine pulse from HoldMeshView.ProcessView. RGB is not touched. */
export function holdAlpha(active: boolean, phase: number) {
  if (!active) return { center: 0.2, side: 0.6, phase };
  const c = Math.cos(phase) + 1;
  return { center: c * 0.05 + 0.7, side: c * 0.075 + 0.75, phase: phase + PHASE_STEP };
}

/** FlickSignView: 0.9 at t=0, 1.0 at 0.25, 1.1 at 0.5, period 1s. */
export function flickSignY(now: number) {
  let i = now % 1;
  if (i < 0) i += 1;
  let amp = 0.1;
  while (i > 0.5) { i -= 0.5; amp = -amp; }
  return amp * (1 - Math.cos(i * Math.PI * 2)) - amp + 1;
}

export function sliceCaps(meta: SpriteMeta | undefined, worldW: number, scaleX = 0.75) {
  const ppu = meta?.ppu || 100;
  const bw = meta?.rect[2] || 1;
  let left = ((meta?.border[0] || 0) / ppu) * scaleX;
  let right = ((meta?.border[2] || 0) / ppu) * scaleX;
  const sum = left + right;
  if (sum > worldW && sum > 0) {
    const k = worldW / sum;
    left *= k;
    right *= k;
  }
  const uL = (meta?.border[0] || 0) / bw;
  const uR = (meta?.border[2] || 0) / bw;
  return { left, right, mid: Math.max(0, worldW - left - right), uL, uR };
}

/**
 * Billboard 的「屏幕向上」方向（贴图竖轴）。
 *
 * 3D 里是相机俯角 `PITCH`：up = (0, cos P, −sin P)（Three 的 Z，unityZ 取反）。
 * 2D 俯视时相机垂直向下，屏幕向上 = unity +z ⇒ 调成 90° 后贴图平铺在 XZ 面。
 * 音符、flick 装饰、粒子、拖尾全部共用这一组基向量。
 */
export const billboard = {
  /** 当前俯角（弧度）。 */
  pitch: PITCH,
  /** 世界 +Y 分量。 */
  upY: Math.cos(PITCH),
  /** Three.js Z 分量（unityZ 取反）。 */
  upZ: -Math.sin(PITCH),
};

/** 切换 billboard 基向量（相机模式切换时由 renderer 调用）。 */
export function setBillboardPitch(pitch: number): void {
  billboard.pitch = pitch;
  billboard.upY = Math.cos(pitch);
  billboard.upZ = -Math.sin(pitch);
}

/** Billboard 竖轴在 Unity 坐标里的 z 分量（= −upZ），用于沿「上」偏移（flick sign 浮动等）。 */
export function billboardUpUnityZ(): number {
  return -billboard.upZ;
}

function put(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number,
  x: number, y: number, z: number, u: number, v: number,
  r: number, g: number, b: number, a: number,
) {
  pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
  uv[n * 2] = u; uv[n * 2 + 1] = v;
  col[n * 4] = r; col[n * 4 + 1] = g; col[n * 4 + 2] = b; col[n * 4 + 3] = a;
}

/** Two triangles. `z` is Three.js Z (already negated). Returns next vertex index. */
export function pushQuad(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  corners: number[][], uvs: number[][], color: number[],
) {
  if (n + 6 > cap) return n;
  const [a, b, c, d] = corners;
  const [ua, ub, uc, ud] = uvs;
  const [r, g, bl, al] = color;
  const tri = [a, b, c, a, c, d];
  const tuv = [ua, ub, uc, ua, uc, ud];
  for (let i = 0; i < 6; i++) {
    put(pos, uv, col, n, tri[i][0], tri[i][1], tri[i][2], tuv[i][0], tuv[i][1], r, g, bl, al);
    n++;
  }
  return n;
}

/** 四角沿 billboard 基向量展开；竖轴范围 `lo`→`hi`（默认 ±h/2，底部对齐时 0→h）。 */
function billboardCorners(
  x: number, y: number, unityZ: number, x0: number, x1: number, lo: number, hi: number,
) {
  const z = -unityZ;
  const yLo = y + billboard.upY * lo, yHi = y + billboard.upY * hi;
  const zLo = z + billboard.upZ * lo, zHi = z + billboard.upZ * hi;
  return [
    [x + x0, yLo, zLo],
    [x + x1, yLo, zLo],
    [x + x1, yHi, zHi],
    [x + x0, yHi, zHi],
  ];
}

/** Horizontal 3-patch slice, camera-facing. `x`/`unityZ` are lane coordinates. */
export function pushSlicedNote(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  x: number, y: number, unityZ: number, worldW: number, worldH: number,
  meta: SpriteMeta | undefined, color: number[] = [1, 1, 1, 1], scaleX = 0.75,
) {
  const { left, right, mid, uL, uR } = sliceCaps(meta, worldW, scaleX);
  const patches = [
    { x0: -worldW / 2, x1: -worldW / 2 + left, u0: 0, u1: uL },
    { x0: -worldW / 2 + left, x1: worldW / 2 - right, u0: uL, u1: 1 - uR },
    { x0: worldW / 2 - right, x1: worldW / 2, u0: 1 - uR, u1: 1 },
  ];
  for (const p of patches) {
    if (p.x1 - p.x0 <= 1e-6) continue;
    const c = billboardCorners(x, y, unityZ, p.x0, p.x1, -worldH / 2, worldH / 2);
    n = pushQuad(pos, uv, col, n, cap, c, [[p.u0, 0], [p.u1, 0], [p.u1, 1], [p.u0, 1]], color);
  }
  return n;
}

/** 拖尾截面垂直于轨迹，端点使用 Unity 世界坐标。 */
export function pushTrailSegment(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  a: number[] | { x: number; y: number; z: number }, b: number[] | { x: number; y: number; z: number },
  width: number, color: number[], endWidth = width, endColor = color,
) {
  const ax = Array.isArray(a) ? a[0] : a.x, ay = Array.isArray(a) ? a[1] : a.y, az = Array.isArray(a) ? a[2] : a.z;
  const bx = Array.isArray(b) ? b[0] : b.x, by = Array.isArray(b) ? b[1] : b.y, bz = Array.isArray(b) ? b[2] : b.z;
  const dx = bx - ax, dy = by - ay, dz = az - bz;
  if (Math.hypot(dx, dy, dz) < 1e-8 || (width <= 0 && endWidth <= 0) || n + 6 > cap) return n;
  // 轨迹方向与相机法线叉乘，得到朝向相机的带状截面。
  let sx = dy * billboard.upY - dz * -billboard.upZ, sy = -dx * billboard.upY, sz = dx * -billboard.upZ;
  const length = Math.hypot(sx, sy, sz);
  if (length < 1e-8) { sx = 1; sy = 0; sz = 0; }
  const scale = 1 / (2 * (length < 1e-8 ? 1 : length));
  sx *= scale; sy *= scale; sz *= scale;
  const start = Math.max(0, width), end = Math.max(0, endWidth);
  const x0 = ax - sx * start, y0 = ay - sy * start, z0 = -az - sz * start;
  const x1 = ax + sx * start, y1 = ay + sy * start, z1 = -az + sz * start;
  const x2 = bx + sx * end, y2 = by + sy * end, z2 = -bz + sz * end;
  const x3 = bx - sx * end, y3 = by - sy * end, z3 = -bz - sz * end;
  const [r, g, bl, al] = color;
  put(pos, uv, col, n++, x0, y0, z0, 0, 0, r, g, bl, al);
  put(pos, uv, col, n++, x1, y1, z1, 1, 0, r, g, bl, al);
  put(pos, uv, col, n++, x2, y2, z2, 1, 1, r, g, bl, al);
  put(pos, uv, col, n++, x0, y0, z0, 0, 0, r, g, bl, al);
  put(pos, uv, col, n++, x2, y2, z2, 1, 1, r, g, bl, al);
  put(pos, uv, col, n++, x3, y3, z3, 0, 1, r, g, bl, al);
  for (const i of [2, 4, 5]) col.set(endColor, (n - 6 + i) * 4);
  return n;
}

/**
 * Camera-facing billboard。
 *
 * `uvRect`（[u0,v0,u1,v1]）用于只取贴图的一个子矩形 —— 2D 下 `PlaneEffectModel01`
 * 网格（击中光条 / flick 箭头）在 3D 走 `pushLocalQuad(..., PLANE_UV, true)`，
 * 平铺时必须保留同一个子矩形，否则整张图集（内容挤在下缘）会被拉满整个四边形，
 * 看上去就像特效「缩在下面、朝下」。
 *
 * `pivotBottom` 同理：3D 的光条/箭头以粒子为**底边**向上长，平铺后保持底部对齐，
 * 特效才会从音符位置朝屏幕上方（与音符下落反向）伸出。
 */
export function pushBillboard(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  x: number, y: number, unityZ: number, w: number, h: number,
  color: number[], uTile = 1, vTile = 1, rot = 0,
  uvRect?: readonly number[], pivotBottom = false,
) {
  const [u0, v0, u1, v1] = uvRect ?? [0, 0, uTile, vTile];
  const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const hw = w / 2;
  const lo = pivotBottom ? 0 : -h / 2, hi = pivotBottom ? h : h / 2;
  if (!rot) {
    const c = billboardCorners(x, y, unityZ, -hw, hw, lo, hi);
    return pushQuad(pos, uv, col, n, cap, c, uvs, color);
  }
  // In-plane spin (Unity billboard startRotation), around the camera-facing normal.
  const z = -unityZ;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const corners: number[][] = [];
  for (const [lx, ly] of [[-hw, lo], [hw, lo], [hw, hi], [-hw, hi]] as const) {
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    corners.push([x + rx, y + billboard.upY * ry, z + billboard.upZ * ry]);
  }
  return pushQuad(pos, uv, col, n, cap, corners, uvs, color);
}

/** Flat XY quad (local particle alignment). `z` is Three.js Z. */
export function pushLocalQuad(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  x: number, y: number, z: number, w: number, h: number,
  color: number[], uvRect: number[] = [0, 0, 1, 1], pivotBottom = false,
) {
  const [u0, v0, u1, v1] = uvRect;
  const x0 = x - w / 2, x1 = x + w / 2;
  const y0 = pivotBottom ? y : y - h / 2;
  const y1 = pivotBottom ? y + h : y + h / 2;
  return pushQuad(pos, uv, col, n, cap,
    [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
    [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], color);
}

/** Screen-space quad in pixels, origin at center, +Y up. */
export function pushScreen(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  cx: number, cy: number, w: number, h: number, rot: number,
  color: number[], u0 = 0, u1 = 1,
) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w / 2, hh = h / 2;
  const corner = (lx: number, ly: number) => [cx + lx * c - ly * s, cy + lx * s + ly * c, 0];
  return pushQuad(pos, uv, col, n, cap,
    [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
    [[u0, 0], [u1, 0], [u1, 1], [u0, 1]], color);
}
