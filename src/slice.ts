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

export function worldWidthOf(widthUnits: number) {
  return ((widthUnits - 6) * 0.2 + 1.15) * 0.75;
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

const UP_Y = Math.cos(PITCH);
const UP_Z = -Math.sin(PITCH);

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

function billboardCorners(x: number, y: number, unityZ: number, x0: number, x1: number, h: number) {
  const z = -unityZ;
  const hy = UP_Y * h / 2, hz = UP_Z * h / 2;
  const y0 = y - hy, y1 = y + hy, z0 = z - hz, z1 = z + hz;
  return [
    [x + x0, y0, z0],
    [x + x1, y0, z0],
    [x + x1, y1, z1],
    [x + x0, y1, z1],
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
    const c = billboardCorners(x, y, unityZ, p.x0, p.x1, worldH);
    n = pushQuad(pos, uv, col, n, cap, c, [[p.u0, 0], [p.u1, 0], [p.u1, 1], [p.u0, 1]], color);
  }
  return n;
}

/** 拖尾截面垂直于轨迹，端点使用 Unity 世界坐标。 */
export function pushTrailSegment(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  a: number[], b: number[], width: number, color: number[],
) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = a[2] - b[2];
  if (Math.hypot(dx, dy, dz) < 1e-8 || width <= 0) return n;
  // 轨迹方向与相机法线叉乘，得到朝向相机的带状截面。
  let sx = dy * UP_Y - dz * -UP_Z, sy = -dx * UP_Y, sz = dx * -UP_Z;
  const length = Math.hypot(sx, sy, sz);
  if (length < 1e-8) { sx = 1; sy = 0; sz = 0; }
  const scale = width / (2 * (length < 1e-8 ? 1 : length));
  sx *= scale; sy *= scale; sz *= scale;
  return pushQuad(pos, uv, col, n, cap, [
    [a[0] - sx, a[1] - sy, -a[2] - sz],
    [a[0] + sx, a[1] + sy, -a[2] + sz],
    [b[0] + sx, b[1] + sy, -b[2] + sz],
    [b[0] - sx, b[1] - sy, -b[2] - sz],
  ], [[0, 0], [1, 0], [1, 1], [0, 1]], color);
}

export function pushBillboard(
  pos: Float32Array, uv: Float32Array, col: Float32Array, n: number, cap: number,
  x: number, y: number, unityZ: number, w: number, h: number,
  color: number[], uTile = 1, vTile = 1, rot = 0,
) {
  if (!rot) {
    const c = billboardCorners(x, y, unityZ, -w / 2, w / 2, h);
    return pushQuad(pos, uv, col, n, cap, c, [[0, 0], [uTile, 0], [uTile, vTile], [0, vTile]], color);
  }
  // In-plane spin (Unity billboard startRotation), around the camera-facing normal.
  const z = -unityZ;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const corners: number[][] = [];
  for (const [lx, ly] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const) {
    const rx = lx * cos - ly * sin;
    const ry = lx * sin + ly * cos;
    corners.push([x + rx, y + UP_Y * ry, z + UP_Z * ry]);
  }
  return pushQuad(pos, uv, col, n, cap, corners, [[0, 0], [uTile, 0], [uTile, vTile], [0, vTile]], color);
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
