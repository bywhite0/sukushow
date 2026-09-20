import * as THREE from 'three';
import type { Chart } from './chart';
import { BORDER, Y, edges, worldX } from './geometry';
import type { FxFile, FxGrad, FxMM, FxNode, FxPrefab } from './rgAssets';
import { fxMaterial } from './shaders';
import { PITCH, pushBillboard, pushLocalQuad } from './slice';

const MAX_SPARKS = 2400;
const SEEK = 0.5;
const PLANE_UV = [0.375, 0, 0.625, 0.25];
/** PlaneEffectModel01 is 100×100 with bottom-center pivot (resources.assets #889). */
const PLANE_MESH = 100;
/** Quad mesh is 1×1 centered (unity default resources #10210). */
const QUAD_MESH = 1;

interface Spec {
  offset: number[];
  scale: number[];
  qx: number; qy: number; qz: number; qw: number;
  life: FxMM; speed: FxMM; size: FxMM; sizeY: FxMM; rot: FxMM; grav: number;
  col: number[]; size3d: boolean; sizeY0: number;
  shape: {
    en: boolean; type: number; angle: number; radius: number;
    sx: number; sy: number; sz: number;
    px: number; py: number; pz: number;
    rotx: number; roty: number; rotz: number; randDir: number;
  };
  grad?: FxGrad; gradMin?: FxGrad; gradTwo: boolean;
  sizeOl?: FxMM; sizeOlY?: FxMM; sizeSep: boolean;
  limitEn: boolean; limitDamp: number; limitSpeed: FxMM;
  rotOlEn: boolean; rotOl: FxMM;
  trailEn: boolean; trailLife: number; trailMinDist: number; trailWidth: number;
  trailSizeWidth: boolean; trailInherit: boolean; trailGrad?: FxGrad;
  bursts: { t: number; count: FxMM; cycles: number; interval: number }[];
  rate: FxMM;
  align: number; mesh: number; slice: boolean; combo: boolean; tex: string;
  role: 'core' | 'impact' | 'parr' | 'p2' | 'plain';
  base: number; loop: boolean; dur: number; followHead: boolean;
  /** Emitter clock: next one-shot burst index / loop wrap / rate accumulator. */
  burstI: number; rateAcc: number; cycle: number;
}
interface Spark {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  age: number; life: number; sx: number; sy: number; sliceSize: number;
  r: number; g: number; b: number; a: number; grav: number;
  align: number; mesh: number; slice: boolean; tex: string;
  pitchLocal: boolean; spin: number; followHead: boolean;
  grad?: FxGrad; sizeOl?: FxMM; sizeOlY?: FxMM; sizeSep: boolean;
  limitEn: boolean; limitDamp: number; limitSpeed: number;
  fever?: boolean;
  firstStep?: number;
  omega: number;
  trailEn: boolean; trailLife: number; trailMinDist: number; trailWidth: number;
  trailSizeWidth: boolean; trailInherit: boolean; trailGrad?: FxGrad;
  trail: { x: number; y: number; z: number; t: number }[];
}
interface Live {
  uid: number; age: number; dur: number; loop: boolean; x: number; width: number; specs: Spec[]; sparks: Spark[];
  abs?: boolean; fever?: boolean;
}

function lerpKeys(keys: { t: number; v: number }[] | undefined, t: number) {
  if (!keys?.length) return 1;
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
function sample(m: FxMM | undefined, rnd: number) {
  if (!m) return 0;
  if (m.k === 3) {
    const a = m.lo, b = m.hi;
    return a + (b - a) * rnd;
  }
  if (m.k === 1 || m.k === 2) {
    const hi = lerpKeys(m.keys, rnd);
    const lo = m.k === 2 ? lerpKeys(m.minKeys, rnd) : hi;
    return (m.mult || 1) * (lo + (hi - lo) * (m.k === 2 ? rnd : 0));
  }
  return m.v || 0;
}
function gradAt(g: FxGrad | undefined, t: number) {
  if (!g?.rgb?.length) return [1, 1, 1, 1];
  const rgb = g.rgb, a = g.a || [];
  let r = rgb[0].r, gc = rgb[0].g, b = rgb[0].b;
  for (let i = 1; i < rgb.length; i++) {
    if (t > rgb[i].t && i < rgb.length - 1) continue;
    const span = rgb[i].t - rgb[i - 1].t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - rgb[i - 1].t) / span)) : 0;
    r = rgb[i - 1].r + (rgb[i].r - rgb[i - 1].r) * k;
    gc = rgb[i - 1].g + (rgb[i].g - rgb[i - 1].g) * k;
    b = rgb[i - 1].b + (rgb[i].b - rgb[i - 1].b) * k;
    break;
  }
  let al = a.length ? a[0].v : 1;
  for (let i = 1; i < a.length; i++) {
    if (t > a[i].t && i < a.length - 1) continue;
    const span = a[i].t - a[i - 1].t;
    const k = span > 0 ? Math.min(1, Math.max(0, (t - a[i - 1].t) / span)) : 0;
    al = a[i - 1].v + (a[i].v - a[i - 1].v) * k;
    break;
  }
  return [r, gc, b, al];
}
function qrot(qx: number, qy: number, qz: number, qw: number, x: number, y: number, z: number) {
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}
function qmul(ax: number, ay: number, az: number, aw: number, bx: number, by: number, bz: number, bw: number) {
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
/** Unity Quaternion.Euler (ZXY) from degrees — used for ParticleSystem shape.rotation. */
function eulerDeg(x: number, y: number, z: number) {
  const rx = x * Math.PI / 180, ry = y * Math.PI / 180, rz = z * Math.PI / 180;
  const sx = Math.sin(rx * 0.5), cx = Math.cos(rx * 0.5);
  const sy = Math.sin(ry * 0.5), cy = Math.cos(ry * 0.5);
  const sz = Math.sin(rz * 0.5), cz = Math.cos(rz * 0.5);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
/** World TRS of a node via parent chain (fx.json transforms match note_prefabs). */
function worldOf(nodes: FxNode[], index: number) {
  const chain: FxNode[] = [];
  for (let p = index; p >= 0 && nodes[p]; p = nodes[p].parent) chain.push(nodes[p]);
  chain.reverse();
  let x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, qx = 0, qy = 0, qz = 0, qw = 1;
  for (const n of chain) {
    const p = qrot(qx, qy, qz, qw, n.px, n.py, n.pz);
    x += p[0]; y += p[1]; z += p[2];
    sx *= n.sx || 1; sy *= n.sy || 1; sz *= n.sz || 1;
    [qx, qy, qz, qw] = qmul(qx, qy, qz, qw, n.rx, n.ry, n.rz, n.rw || 1);
  }
  return { x, y, z, sx, sy, sz, qx, qy, qz, qw };
}
function loopAngle(width: number) {
  const v = (width - 3) * 0.017 - 1;
  return Math.max(-32 * v ** 5, 0.3);
}
/** Corehorizon local X-rot ≈ camera pitch → Local alignment ≈ view billboard. */
function isPitchLocal(qx: number, qy: number, qz: number, qw: number) {
  if (Math.abs(qy) > 0.05 || Math.abs(qz) > 0.05) return false;
  const angle = 2 * Math.atan2(Math.abs(qx), Math.abs(qw || 1));
  return Math.abs(angle - PITCH) < 0.12;
}

class FxBatch {
  pos: Float32Array; uv: Float32Array; col: Float32Array; slice: Float32Array;
  n = 0;
  geo = new THREE.BufferGeometry();
  mesh: THREE.Mesh;
  constructor(readonly cap: number, mat: THREE.Material, order: number) {
    this.pos = new Float32Array(cap * 3);
    this.uv = new Float32Array(cap * 2);
    this.col = new Float32Array(cap * 4);
    this.slice = new Float32Array(cap);
    const use = (arr: Float32Array, size: number) => new THREE.BufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', use(this.pos, 3));
    this.geo.setAttribute('uv', use(this.uv, 2));
    this.geo.setAttribute('tint', use(this.col, 4));
    this.geo.setAttribute('sliceW', use(this.slice, 1));
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }
  reset() { this.n = 0; }
  flush() {
    this.geo.setDrawRange(0, this.n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.sliceW as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

/** GPU quads for the six note-effect prefabs. Not a full ParticleSystem. */

/** LimitVelocityOverLifetime — BannerFxMath / PLAN (50 Hz discrete → continuous). */
function applyLimitVelocity(s: { vx: number; vy: number; vz: number; limitDamp: number; limitSpeed: number }, dt: number) {
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  const lim = Math.max(0, s.limitSpeed);
  if (sp <= lim || sp <= 1e-8) return;
  const damp = Math.min(0.999999, Math.max(0, s.limitDamp));
  const kappa = -Math.log(1 - damp) * 50;
  const next = lim + (sp - lim) * Math.exp(-kappa * dt);
  const scale = next / sp;
  s.vx *= scale;
  s.vy *= scale;
  s.vz *= scale;
}

export class HitFx {
  readonly group = new THREE.Group();
  private mode: 'off' | 'current' | 'limited' | 'full' = 'current';
  private feverOn = false;
  private specs = new Map<string, Spec[]>();
  private live: Live[] = [];
  private batches = new Map<string, FxBatch>();
  private last = Number.NaN;
  private sparks = 0;
  constructor(private fx: FxFile, private tex: Record<string, THREE.Texture>) {
    const mats = new Map(fx.mats.map(m => [m.id, m]));
    for (const prefab of fx.prefabs) this.specs.set(prefab.id, this.compile(prefab, mats));
    for (const prefab of fx.fever || []) this.specs.set(prefab.id, this.compile(prefab, mats));
  }
  private compile(prefab: FxPrefab, mats: Map<string, FxFile['mats'][number]>) {
    const cores = new Map((prefab.coreUnits || []).map(c => [c.node, c.baseSize]));
    const parr = new Set([...(prefab.pArr || []), prefab.p00].filter(i => i >= 0));
    const p2 = new Set(prefab.pArr2 || []);
    const out: Spec[] = [];
    prefab.nodes.forEach((n, i) => {
      if (!n.active || !n.ps?.en || n.rend?.off) return;
      const mat = mats.get(n.rend?.mat || '');
      if (!mat || !this.tex[mat.tex]) return;
      const shader = mat.shader || '';
      const slice = shader.includes('9Slice');
      const combo = shader.includes('Num Combo');
      const role = i === prefab.impact ? 'impact' : cores.has(i) ? 'core' : parr.has(i) ? 'parr' : p2.has(i) ? 'p2' : 'plain';
      if (!this.batches.has(mat.tex + shader)) {
        // materials 194/195: _BorderW 0.495, _TexW 256 (assets.json)
        const material = fxMaterial(this.tex[mat.tex], slice ? 0.495 : 0, 256, combo);
        const batch = new FxBatch(16000, material, 40 + (n.rend?.sortOrder || 0));
        this.batches.set(mat.tex + shader, batch);
        this.group.add(batch.mesh);
      }
      const shape = n.ps.shape;
      const tr = worldOf(prefab.nodes, i);
      const colMod = n.ps.col;
      out.push({
        offset: [tr.x, tr.y, tr.z],
        scale: [tr.sx, tr.sy, tr.sz],
        qx: tr.qx, qy: tr.qy, qz: tr.qz, qw: tr.qw,
        life: n.ps.life || { k: 0, v: 1, lo: 0, hi: 0, mult: 1 },
        speed: n.ps.speed || { k: 0, v: 0, lo: 0, hi: 0, mult: 1 },
        size: n.ps.size || { k: 0, v: 1, lo: 0, hi: 0, mult: 1 },
        sizeY: n.ps.sizeY || { k: 0, v: 1, lo: 0, hi: 0, mult: 1 },
        rot: n.ps.rot || { k: 0, v: 0, lo: 0, hi: 0, mult: 1 },
        grav: n.ps.grav || 0,
        col: [n.ps.col0R, n.ps.col0G, n.ps.col0B, n.ps.col0A],
        size3d: !!n.ps.size3d, sizeY0: n.ps.sizeY?.v ?? 1,
        shape: {
          en: !!shape?.en, type: shape?.type || 0, angle: shape?.angle || 0, radius: shape?.radius || 0,
          sx: shape?.sx || 1, sy: shape?.sy || 1, sz: shape?.sz || 1,
          px: shape?.px || 0, py: shape?.py || 0, pz: shape?.pz || 0,
          rotx: shape?.rotx || 0, roty: shape?.roty || 0, rotz: shape?.rotz || 0,
          randDir: shape?.randDir || 0,
        },
        grad: colMod?.en ? colMod.max : undefined,
        gradMin: colMod?.en && colMod.mode === 3 ? colMod.min : undefined,
        gradTwo: !!(colMod?.en && colMod.mode === 3),
        sizeOl: n.ps.sizeol?.en ? n.ps.sizeol.curve : undefined,
        sizeOlY: n.ps.sizeol?.en && n.ps.sizeol.sep ? n.ps.sizeol.y : undefined,
        sizeSep: !!(n.ps.sizeol?.en && n.ps.sizeol.sep),
        limitEn: !!n.ps.limit?.en,
        limitDamp: n.ps.limit?.dampen ?? 0,
        limitSpeed: n.ps.limit?.speed || { k: 0, v: 1, lo: 1, hi: 1, mult: 1 },
        rotOlEn: !!n.ps.rotol?.en,
        rotOl: (n.ps.rotol?.en
          ? ((n.ps.rotol.sep ? n.ps.rotol.x : n.ps.rotol.curve) || n.ps.rotol.curve)
          : undefined) || { k: 0, v: 0, lo: 0, hi: 0, mult: 0 },
        trailEn: !!n.ps.trail?.en,
        trailLife: Math.max(0.05, (n.ps.trail?.life?.v ?? n.ps.trail?.life?.lo ?? 0.35) || 0.35),
        trailMinDist: n.ps.trail?.minVertexDist ?? 0.2,
        trailWidth: Math.max(0.01, (n.ps.trail?.width?.v ?? n.ps.trail?.width?.lo ?? 1) || 1),
        trailSizeWidth: !!n.ps.trail?.sizeWidth,
        trailInherit: n.ps.trail?.inheritColor !== false,
        trailGrad: n.ps.trail?.en ? n.ps.trail.colMax : undefined,
        bursts: (n.ps.bursts || []).map(b => ({
          t: b.t, count: b.count, cycles: Math.max(1, b.cycles || 1), interval: b.interval || 0,
        })),
        rate: n.ps.rate || { k: 0, v: 0, lo: 0, hi: 0, mult: 0 },
        align: n.rend?.align || 0,
        mesh: n.rend?.mode === 4 ? (n.rend.mesh?.includes('Plane') ? 2 : 1) : 0,
        slice, combo, tex: mat.tex + shader, role, base: cores.get(i) || 0,
        loop: !!n.ps.loop, dur: Math.max(0.05, n.ps.dur || 1),
        // Hold 核心贴住当前头部；飞散粒子仍保留世界坐标。
        followHead: prefab.id === 'holdLoop' && (role === 'core' || n.name === 'Core'),
        burstI: 0, rateAcc: 0, cycle: 0,
      });
    });
    return out;
  }
  private total() { return this.live.reduce((n, fx) => n + fx.sparks.length, 0); }
  /** SetWidth laws from NoteEffectPool (binary @0x3F47620 / 0x3F48058 / 0x3F47A6C). */
  private sized(spec: Spec, width: number, rnd: number, burstCount?: FxMM) {
    let startX = sample(spec.size, rnd);
    let startY = spec.size3d ? sample(spec.sizeY, rnd) : startX;
    let count = Math.max(1, Math.round(sample(burstCount || spec.bursts[0]?.count, rnd) || 1));
    let shapeSx = spec.shape.sx, angle = spec.shape.angle;
    if (spec.role === 'core') {
      // startSizeX only; Y keeps serialized sizeY0. Node scale (~0.005) applied below.
      startX = width * 30 + spec.base;
      startY = spec.sizeY0 || 1;
    } else if (spec.role === 'impact') {
      startX = width * 0.00093333336;
    } else if (spec.role === 'parr') {
      count = Math.ceil(width / 2) + (width > 30 ? 5 : 0);
      shapeSx = width * (2 / 3) + 2;
    } else if (spec.role === 'p2') {
      count = (width * 0.13333334 + 2) | 0;
      shapeSx = width * 0.73333335;
      angle = loopAngle(width);
    }
    const nsx = spec.scale[0] || 1, nsy = spec.scale[1] || 1;
    let drawX = startX * nsx, drawY = startY * nsy;
    if (spec.mesh === 2) { drawX *= PLANE_MESH; drawY *= PLANE_MESH; }
    else if (spec.mesh === 1) { drawX *= QUAD_MESH; drawY *= QUAD_MESH; }
    return {
      drawX, drawY, sliceSize: startX,
      count: Math.min(Math.max(1, count), 64),
      shapeSx, shapeSy: spec.shape.sy, shapeSz: spec.shape.sz, angle,
    };
  }
  private emitShape(spec: Spec, sized: ReturnType<HitFx['sized']>, rnd: number, rnd2: number) {
    const rad = spec.shape.radius || 0;
    let ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 1;
    const type = spec.shape.en ? spec.shape.type : -1;
    if (type === 10) {
      // Circle (XY disk, emit along +Z)
      const t = rnd * Math.PI * 2;
      ox = Math.cos(t) * rad * sized.shapeSx;
      oy = Math.sin(t) * rad * sized.shapeSy;
    } else if (type === 5) {
      // Box
      ox = (rnd - 0.5) * sized.shapeSx;
      oy = (rnd2 - 0.5) * sized.shapeSy;
      oz = (Math.random() - 0.5) * sized.shapeSz;
    } else if (type === 12) {
      // SingleSidedEdge
      ox = (rnd - 0.5) * 2 * rad * sized.shapeSx;
    } else if (type === 4 || type === 8 || (spec.shape.en && type !== 0)) {
      // Cone / ConeVolume — base in XY, axis +Z (Unity default)
      const t = rnd * Math.PI * 2;
      const a = rnd2 * (sized.angle * Math.PI / 180);
      const r = rad * (type === 8 ? rnd2 : 1);
      ox = Math.cos(t) * r * sized.shapeSx;
      oy = Math.sin(t) * r * sized.shapeSy;
      dx = Math.sin(a) * Math.cos(t);
      dy = Math.sin(a) * Math.sin(t);
      dz = Math.cos(a);
    } else if (type === 0 && spec.shape.en) {
      // Sphere shell point
      const t = rnd * Math.PI * 2, u = rnd2 * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - u * u)) * rad;
      ox = Math.cos(t) * r * sized.shapeSx;
      oy = u * rad * sized.shapeSy;
      oz = Math.sin(t) * r * sized.shapeSz;
      const len = Math.hypot(ox, oy, oz);
      if (len > 1e-8) { dx = ox / len; dy = oy / len; dz = oz / len; }
    }
    // ShapeModule TRS: R*(S*p) then +position (position is not rotated). Cone rotx=-90 → +Y.
    if (spec.shape.rotx || spec.shape.roty || spec.shape.rotz) {
      const [sqx, sqy, sqz, sqw] = eulerDeg(spec.shape.rotx, spec.shape.roty, spec.shape.rotz);
      [ox, oy, oz] = qrot(sqx, sqy, sqz, sqw, ox, oy, oz);
      [dx, dy, dz] = qrot(sqx, sqy, sqz, sqw, dx, dy, dz);
    }
    ox += spec.shape.px;
    oy += spec.shape.py;
    oz += spec.shape.pz;
    if (spec.shape.randDir > 0) {
      const u = Math.random() * Math.PI * 2, v = Math.random() * 2 - 1;
      const r = Math.sqrt(Math.max(0, 1 - v * v));
      const rdx = Math.cos(u) * r, rdy = v, rdz = Math.sin(u) * r;
      const k = Math.min(1, Math.max(0, spec.shape.randDir));
      dx = dx * (1 - k) + rdx * k;
      dy = dy * (1 - k) + rdy * k;
      dz = dz * (1 - k) + rdz * k;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len; dy /= len; dz /= len;
    }
    const [rx, ry, rz] = qrot(spec.qx, spec.qy, spec.qz, spec.qw, ox, oy, oz);
    const [rdx, rdy, rdz] = qrot(spec.qx, spec.qy, spec.qz, spec.qw, dx, dy, dz);
    return { ox: rx, oy: ry, oz: rz, dx: rdx, dy: rdy, dz: rdz };
  }
  private burst(live: Live, spec: Spec, burstCount?: FxMM, countOverride?: number) {
    const sized = this.sized(spec, live.width, Math.random(), burstCount);
    const count = countOverride ?? sized.count;
    const pitchLocal = spec.align === 2 && isPitchLocal(spec.qx, spec.qy, spec.qz, spec.qw);
    for (let i = 0; i < count && this.total() < MAX_SPARKS; i++) {
      const rnd = Math.random(), rnd2 = Math.random();
      const sh = this.emitShape(spec, sized, rnd, rnd2);
      const speed = sample(spec.speed, rnd);
      const grad = spec.gradTwo && spec.gradMin && Math.random() < 0.5 ? spec.gradMin : spec.grad;
      const spark: Spark = {
        x: (live.abs ? 0 : live.x) + spec.offset[0] + sh.ox,
        y: (live.abs ? 0 : Y) + spec.offset[1] + sh.oy,
        z: (live.abs ? 0 : BORDER) + spec.offset[2] + sh.oz,
        vx: sh.dx * speed, vy: sh.dy * speed, vz: sh.dz * speed,
        age: 0, life: Math.max(0.016, sample(spec.life, rnd)),
        sx: sized.drawX, sy: sized.drawY, sliceSize: sized.sliceSize,
        r: spec.col[0], g: spec.col[1], b: spec.col[2], a: spec.col[3], grav: spec.grav,
        align: spec.align, mesh: spec.mesh, slice: spec.slice, tex: spec.tex,
        pitchLocal, spin: sample(spec.rot, rnd), followHead: spec.followHead,
        grad, sizeOl: spec.sizeOl, sizeOlY: spec.sizeOlY, sizeSep: spec.sizeSep,
        limitEn: spec.limitEn, limitDamp: spec.limitDamp, limitSpeed: sample(spec.limitSpeed, rnd),
        fever: !!live.fever,
        omega: spec.rotOlEn ? sample(spec.rotOl, rnd) : 0,
        trailEn: spec.trailEn || ((this.mode === 'full' || this.mode === 'current') && spec.limitEn),
        // fever authoring trails always on when trail.en
        trailLife: spec.trailEn ? spec.trailLife : 0.18,
        trailMinDist: spec.trailEn ? spec.trailMinDist : 0.08,
        trailWidth: spec.trailEn ? spec.trailWidth : 0.35,
        trailSizeWidth: spec.trailSizeWidth,
        trailInherit: spec.trailInherit,
        trailGrad: spec.trailGrad,
        trail: [],
      };
      live.sparks.push(spark);
    }
  }
  private emitDue(live: Live, spec: Spec, prevAge: number, age: number) {
    const period = live.loop && spec.loop ? spec.dur : Number.POSITIVE_INFINITY;
    const localPrev = prevAge % period;
    const localAge = age % period;
    const wrapped = live.loop && spec.loop && localAge < localPrev;
    for (const b of spec.bursts) {
      for (let c = 0; c < b.cycles; c++) {
        const t = b.t + c * (b.interval || 0);
        const due = wrapped
          ? (t >= localPrev || t <= localAge)
          : (t > localPrev && t <= localAge) || (prevAge < 0 && t <= localAge);
        if (due) {
          const first = live.sparks.length;
          this.burst(live, spec, b.count);
          // 非循环 Fever 入场按出生时刻计算首帧年龄，不多积分整帧。
          if (live.fever && !live.loop) for (let i = first; i < live.sparks.length; i++) {
            live.sparks[i].firstStep = Math.max(0, age - t);
          }
        }
      }
    }
    const rate = sample(spec.rate, Math.random());
    if (rate > 0) {
      spec.rateAcc += rate * Math.max(0, age - prevAge);
      const n = Math.floor(spec.rateAcc);
      if (n > 0) { spec.rateAcc -= n; this.burst(live, spec, undefined, n); }
    }
  }
  /** `off` | `current` 直冲天上(+rotol/拖尾) | `limited` 限速 | `full` 限速+rotol+拖尾. */
  setMode(mode: 'off' | 'current' | 'limited' | 'full') {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'off') this.live = this.live.filter(fx => fx.fever);
  }
  /** Screen-side fever FX (feverLeft/Right). Independent of hitEffect off. */
  setFever(on: boolean) {
    if (on === this.feverOn) return;
    this.feverOn = on;
    if (!on) {
      this.live = this.live.filter(fx => !fx.fever);
      return;
    }
    // level56 #544/#543：入场爆发不循环，后续批次仍须推进。
    this.spawn('feverLeft', 0, 1, false, -200, true, true);
    this.spawn('feverRight', 0, 1, false, -201, true, true);
  }
  spawn(id: string, x: number, width: number, loop = false, uid = -1, abs = false, fever = false) {
    if (this.mode === 'off' && !fever) return null;
    const src = this.specs.get(id);
    if (!src?.length || this.live.length > 64) return null;
    // FeverEffectStartAnimation 在 1/60 秒激活两侧入场根节点。
    const delay = fever ? 1 / 60 : 0;
    const specs = src.map(s => ({
      ...s, bursts: s.bursts.map(b => ({ ...b, t: b.t + delay })),
      burstI: 0, rateAcc: 0, cycle: 0,
    }));
    const live: Live = {
      uid, age: 0, dur: specs.reduce((m, s) => Math.max(m, s.dur), 1),
      loop, x, width, specs, sparks: [], abs, fever,
    };
    // Fire bursts at t=0 immediately (most note FX bursts are at 0).
    for (const spec of specs) this.emitDue(live, spec, -1e-6, 0);
    this.live.push(live);
    return live;
  }
  clear() {
    this.live = [];
    this.sparks = 0;
    this.feverOn = false;
  }
  sync(chart: Chart, time: number, mirror: boolean) {
    if (!Number.isFinite(this.last)) { this.last = time; return; }
    const dt = time - this.last;
    if (dt < -1e-4 || dt > SEEK) { this.clear(); this.last = time; return; }
    if (this.mode === 'off' && !this.feverOn) {
      if (this.live.length) this.clear();
      this.last = time;
      return;
    }
    if (this.mode === 'off') {
      this.live = this.live.filter(fx => fx.fever);
    }
    if (dt > 0) this.step(dt);
    if (this.mode !== 'off') for (const root of chart.roots) {
      if (this.last < root.time && time >= root.time) {
        const [l, r] = edges(root, 0, mirror);
        const x = worldX((l + r) / 2), w = r - l + 1;
        const id = root.type === 1 ? 'holdStart' : root.type === 2 ? 'flick' : root.type === 3 ? 'trace' : 'tap';
        this.spawn(id, x, w, false);
        if (root.type === 1) this.spawn('holdLoop', x, w, true, root.uid);
      }
      if (root.type !== 1) continue;
      let tail = root;
      while (tail.next) tail = tail.next;
      if (this.last < tail.end && time >= tail.end) {
        const [l, r] = edges(tail, 1, mirror);
        this.spawn('holdEnd', worldX((l + r) / 2), r - l + 1, false);
        this.live = this.live.filter(fx => !(fx.loop && fx.uid === root.uid));
      }
    }
    this.last = time;
  }
  private step(dt: number) {
    this.sparks = 0;
    const next: Live[] = [];
    for (const live of this.live) {
      const prev = live.age;
      live.age += dt;
      for (const spec of live.specs) {
        if (live.loop && spec.loop) this.emitDue(live, spec, prev, live.age);
        else if (!live.loop) this.emitDue(live, spec, prev, live.age);
      }
      const sparks: Spark[] = [];
      const frameDt = dt;
      for (const s of live.sparks) {
        const dt = s.firstStep ?? frameDt;
        s.firstStep = undefined;
        s.age += dt;
        if (s.age > s.life) continue;
        s.vy -= 9.81 * s.grav * dt;
        if (s.omega) s.spin += s.omega * dt;
        // Middle+: ~40% free integrate for a bit of punch, then LimitVelocity, then rest.
        // Full integrate-first flew too high; limit-first + birth brake was too flat.
        // BannerFxMath: v=lim+(v0−lim)e^(−κt), κ=−ln(1−dampen)×50.
        const limitHit =
          (this.mode === 'limited' || this.mode === 'full' || s.fever) && s.limitEn;
        const free = limitHit ? dt * 0.4 : dt;
        s.x += s.vx * free; s.y += s.vy * free; s.z += s.vz * free;
        if (limitHit) {
          applyLimitVelocity(s, dt);
          const rest = dt - free;
          s.x += s.vx * rest; s.y += s.vy * rest; s.z += s.vz * rest;
        }
        if (s.trailEn) {
          const last = s.trail[s.trail.length - 1];
          const dist = last ? Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z) : 1e9;
          if (dist >= s.trailMinDist) s.trail.push({ x: s.x, y: s.y, z: s.z, t: s.age });
          const cut = s.age - s.trailLife;
          while (s.trail.length && s.trail[0].t < cut) s.trail.shift();
        }
        sparks.push(s);
        this.sparks++;
      }
      live.sparks = sparks;
      // Keep until particles die; seek clears. Do not cut short on emitter duration alone.
      if (live.loop || live.age < live.dur + 0.05 || sparks.length) next.push(live);
    }
    this.live = next;
  }
  setLoop(uid: number, x: number) {
    for (const live of this.live) {
      if (!live.loop || live.uid !== uid) continue;
      const dx = x - live.x;
      live.x = x;
      for (const spark of live.sparks) {
        if (spark.followHead) spark.x += dx;
      }
    }
  }
  draw() {
    for (const batch of this.batches.values()) batch.reset();
    for (const live of this.live) for (const s of live.sparks) {
      const batch = this.batches.get(s.tex);
      if (!batch) continue;
      const t = s.age / s.life;
      const g = gradAt(s.grad, t);
      const mulX = s.sizeOl ? lerpKeys(s.sizeOl.keys, t) * (s.sizeOl.mult || 1) : 1;
      const mulY = s.sizeSep && s.sizeOlY
        ? lerpKeys(s.sizeOlY.keys, t) * (s.sizeOlY.mult || 1)
        : mulX;
      const sx = Math.max(0.001, s.sx * mulX), sy = Math.max(0.001, s.sy * mulY);
      const color = [s.r * g[0], s.g * g[1], s.b * g[2], s.a * g[3]];
      const before = batch.n;
      if (s.mesh === 2) {
        // PlaneEffectModel01: local upright, bottom pivot (impact light column).
        batch.n = pushLocalQuad(batch.pos, batch.uv, batch.col, batch.n, batch.cap, s.x, s.y, -s.z, sx, sy, color, PLANE_UV, true);
      } else if (s.align === 2 && !s.pitchLocal) {
        // Local + identity ancestors → world-axis quad (Core / Coredirection).
        batch.n = pushLocalQuad(batch.pos, batch.uv, batch.col, batch.n, batch.cap, s.x, s.y, -s.z, sx, sy, color);
      } else {
        // View billboard, or Local with Corehorizon pitch ≈ camera 33.2°.
        batch.n = pushBillboard(batch.pos, batch.uv, batch.col, batch.n, batch.cap, s.x, s.y, s.z, sx, sy, color, 1, 1, s.spin);
      }
      // 9Slice shader wants pre-transform startSizeX (TexW units), not world size.
      const slice = s.slice ? s.sliceSize * mulX : 0;
      for (let i = before; i < batch.n; i++) batch.slice[i] = slice;
    }
    this.drawTrails();
    for (const batch of this.batches.values()) batch.flush();
  }
  /** Ribbon approx: authoring trail.en, or soft streak in current/full for limit-enabled sprays. */
  private drawTrails() {
    for (const live of this.live) for (const s of live.sparks) {
      if (!s.trailEn || s.trail.length < 2) continue;
      const batch = this.batches.get(s.tex);
      if (!batch) continue;
      const tw = s.trailSizeWidth ? s.trailWidth * s.sx : s.trailWidth;
      for (let i = 1; i < s.trail.length; i++) {
        const a = s.trail[i - 1], b = s.trail[i];
        const midX = (a.x + b.x) * 0.5, midY = (a.y + b.y) * 0.5, midZ = (a.z + b.z) * 0.5;
        const u = (s.age - b.t) / Math.max(1e-4, s.trailLife);
        const g = s.trailGrad ? gradAt(s.trailGrad, Math.min(1, Math.max(0, u))) : [1, 1, 1, 1 - u];
        const color = s.trailInherit
          ? [s.r * g[0], s.g * g[1], s.b * g[2], s.a * g[3]]
          : [g[0], g[1], g[2], g[3]];
        const seg = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const before = batch.n;
        batch.n = pushBillboard(
          batch.pos, batch.uv, batch.col, batch.n, batch.cap,
          midX, midY, midZ, Math.max(0.001, tw * 0.15), Math.max(0.001, seg), color, 1, 1, 0,
        );
        for (let j = before; j < batch.n; j++) batch.slice[j] = 0;
      }
    }
  }
  dispose() {
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
  }
}
