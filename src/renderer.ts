import * as THREE from 'three';
import type { Chart, Note } from './chart';
import { BORDER, SPAWN, Y, createSlope, edges, holdSegment, worldX, lanePitch } from './geometry';
import { gridLaneCount } from './rgOptions';
import { HitFx } from './fx';
import { loadRgLibrary, whiteTexture, type RgLibrary } from './rgAssets';
import { planeMaterial, spriteMaterial } from './shaders';
import {
  HOLD_CENTER, HOLD_SIDE, PHASE_START, PITCH, flickSignY, holdAlpha, pushBillboard,
  pushScreen, pushSlicedNote,   worldDepth, worldWidthOf,
} from './slice';

const COLORS = [[1, .37, .67], [.18, .78, 1], [1, .37, .67], [.33, .84, .94]];
const oldVert = `attribute vec4 tint; varying vec4 vTint; void main(){vTint=tint;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const oldFrag = `varying vec4 vTint; void main(){gl_FragColor=vTint;}`;

class OldBatch {
  geometry = new THREE.BufferGeometry();
  material = new THREE.ShaderMaterial({ vertexShader: oldVert, fragmentShader: oldFrag, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  mesh = new THREE.Mesh(this.geometry, this.material);
  private positions: Float32Array;
  private colors: Float32Array;
  private count = 0;
  constructor(capacity: number, order: number) {
    this.positions = new Float32Array(capacity * 3); this.colors = new Float32Array(capacity * 4);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('tint', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  reset() { this.count = 0; }
  triangle(points: number[], color: number[], alpha: number) {
    if (this.count + 3 > this.positions.length / 3) return;
    this.positions.set(points, this.count * 3);
    for (let i = 0; i < 3; i++) this.colors.set([...color, alpha], (this.count + i) * 4);
    this.count += 3;
  }
  ribbon(vertices: number[], active: boolean) {
    const order = [0, 1, 2, 3, 2, 1, 2, 3, 4, 5, 4, 3];
    if (this.count + 12 > this.positions.length / 3) return;
    for (const index of order) {
      this.positions.set([vertices[index * 3], vertices[index * 3 + 1], -vertices[index * 3 + 2]], this.count * 3);
      const center = index === 2 || index === 3;
      this.colors.set(center ? [46 / 255, 198 / 255, 1, active ? .75 : .2] : [45 / 255, 248 / 255, 1, active ? .82 : .6], this.count * 4);
      this.count++;
    }
  }
  quad(x: number, y: number, z: number, w: number, h: number, color: number[], alpha = 1, billboard = true) {
    const dy = billboard ? Math.cos(PITCH) * h / 2 : 0, dz = billboard ? -Math.sin(PITCH) * h / 2 : h / 2;
    const a = [x - w / 2, y - dy, -z - dz], b = [x + w / 2, y - dy, -z - dz], c = [x + w / 2, y + dy, -z + dz], d = [x - w / 2, y + dy, -z + dz];
    this.triangle([...a, ...b, ...c], color, alpha); this.triangle([...a, ...c, ...d], color, alpha);
  }
  flush() { this.geometry.setDrawRange(0, this.count); this.geometry.attributes.position.needsUpdate = true; this.geometry.attributes.tint.needsUpdate = true; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

class TexBatch {
  pos: Float32Array; uv: Float32Array; col: Float32Array; n = 0;
  geo = new THREE.BufferGeometry();
  mesh: THREE.Mesh;
  constructor(readonly cap: number, material: THREE.Material, order: number) {
    this.pos = new Float32Array(cap * 3); this.uv = new Float32Array(cap * 2); this.col = new Float32Array(cap * 4);
    const attr = (a: Float32Array, s: number) => new THREE.BufferAttribute(a, s).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', attr(this.pos, 3));
    this.geo.setAttribute('uv', attr(this.uv, 2));
    this.geo.setAttribute('tint', attr(this.col, 4));
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = order;
  }
  reset() { this.n = 0; }
  flush() {
    this.geo.setDrawRange(0, this.n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.uv as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.tint as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

const SPRITE = ['ui_sc2_ingame_notes_tap', 'ui_sc2_ingame_notes_hold', 'ui_sc2_ingame_notes_flick', 'ui_sc2_ingame_notes_trace'];
const LINE = [1, 0.2274509817, 0.6, 1];

export class PreviewRenderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private field = new THREE.Scene();
  private ui = new THREE.Scene();
  private notes = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, .3, 1000);
  private uiCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private uiRoot = new THREE.Group();
  /** Under uiRoot; X = LaneWidth/100 like RhythmGameWorldScaler (BorderLine + OutLine). */
  private laneUi = new THREE.Group();
  private track = new OldBatch(1000, 0);
  private holds = new OldBatch(600000, 1);
  private lines = new OldBatch(300000, 2);
  private oldNotes = new OldBatch(900000, 3);
  private ribbon!: TexBatch;
  private sheets = new Map<string, TexBatch>();
  private white = whiteTexture();
  private lib: RgLibrary | null = null;
  private planeMesh: THREE.Mesh | null = null;
  private planeMat: THREE.ShaderMaterial | null = null;
  private laneLines = new THREE.Group();
  private noteStartZ = 0;
  private laneWidthOpt = 100;
  private gridCountOpt = 0;
  private laneDarknessOpt = 80;
  private fx: HitFx | null = null;
  private hitEffectMode: 'off' | 'current' = 'current';
  private phase = new Map<number, number>();
  private observer: ResizeObserver;
  private disposed = false;
  constructor(private canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.setClearColor(0x000000, 0);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 9, 8.65); this.camera.rotation.x = -PITCH;
    for (const batch of [this.track, this.holds, this.lines, this.oldNotes]) this.scene.add(batch.mesh);
    this.ui.add(this.uiRoot);
    this.uiRoot.add(this.laneUi);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
    void loadRgLibrary().then(lib => { if (!this.disposed && lib) this.useLibrary(lib); }).catch(() => undefined);
  }
  private useLibrary(lib: RgLibrary) {
    this.lib = lib;
    const sprite = spriteMaterial(this.white);
    this.ribbon = new TexBatch(600000, sprite, 1);
    this.notes.add(this.ribbon.mesh);
    this.notes.add(this.lines.mesh);
    const plane = this.plane();
    this.field.add(plane);
    // LaneLine shares Plane transform (level56); WorldScaler X = LaneWidth/100
    plane.add(this.laneLines);
    this.rebuildLaneLines();
    this.buildUi(lib);
    this.applyLaneWidthScale();
    if (lib.fx) {
      this.fx = new HitFx(lib.fx, lib.fxTex);
      this.fx.setMode(this.hitEffectMode);
      this.notes.add(this.fx.group);
    }
    for (const batch of [this.track, this.holds, this.lines, this.oldNotes]) batch.mesh.visible = false;
  }
  private plane() {
    const y = 3.96, near = 7.6, far = -82.4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-5, y, near, 5, y, near, 5, y, far, -5, y, far], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const mat = planeMaterial() as THREE.ShaderMaterial;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // PLAN §52: Plane under notes (sortingOrder −1); α = 0.8 × LaneDarkness/100
    mesh.renderOrder = -1;
    this.planeMesh = mesh;
    this.planeMat = mat;
    this.applyPlaneDarkness();
    return mesh;
  }

  /** RhythmGameWorldScaler.SetScaleX(LaneWidth/100) — Plane + LaneLines + Canvas BorderLine/OutLine on X. */
  private applyLaneWidthScale(): void {
    const s = this.laneWidthOpt / 100;
    if (this.planeMesh) this.planeMesh.scale.set(s, 1, 1);
    this.laneUi.scale.set(s, 1, 1);
  }

  /** ChangePlaneAlpha: _Color = (0,0,0, 0.8 × LaneDarkness/100). */
  private applyPlaneDarkness(): void {
    if (!this.planeMat) return;
    const v = Math.max(0, Math.min(1.3, this.laneDarknessOpt / 100));
    this.planeMat.uniforms.color.value.set(0, 0, 0, 0.8 * v);
  }

  /**
   * DividedLaneView + LaneLine prefab: white lines α0.3 on the plane.
   * GridCount Two..Six → 2..6 sections; lines coplanar with Plane (range=5).
   */
  private rebuildLaneLines(): void {
    const oldMat = (this.laneLines.children[0] as THREE.Mesh | undefined)?.material;
    while (this.laneLines.children.length) {
      const c = this.laneLines.children.pop() as THREE.Mesh;
      c.geometry.dispose();
    }
    if (oldMat && !Array.isArray(oldMat)) oldMat.dispose();
    const sections = gridLaneCount(this.gridCountOpt as 0 | 1 | 2 | 3 | 4 | 5);
    if (sections <= 1) return;
    // DividedLaneView.range = 5 — same half-width as Plane local X (±5)
    const range = 5;
    const y = 3.96, near = 7.6, far = -82.4;
    // DividedLaneView.Width = 0.003; LaneLineFade α 0.3
    const halfW = 0.003 / 2;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // sections parts → sections-1 dividers, coplanar with Plane (constant local X, Z along edges)
    for (let i = 1; i < sections; i++) {
      const x = -range + (2 * range * i) / sections;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          [x - halfW, y, near, x + halfW, y, near, x + halfW, y, far, x - halfW, y, far],
          3,
        ),
      );
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -1;
      this.laneLines.add(mesh);
    }
  }


  private buildUi(lib: RgLibrary) {
    // level56 Canvas/WidthApply: OutLine under Mask, BorderLine sibling — BorderLine must draw above OutLine.
    // Geometry at LaneWidth=100; laneUi.scale.x = LaneWidth/100 (WorldScaler).
    const pink = spriteMaterial(this.white);
    const opos = new Float32Array(12 * 3), ouv = new Float32Array(12 * 2), ocol = new Float32Array(12 * 4);
    const leftRot = 2 * Math.atan2(-0.341118, 0.940021);
    const rightRot = 2 * Math.atan2(0.341118, 0.940021);
    let on = pushScreen(opos, ouv, ocol, 0, 12, -512.6168, -3.30142, 2, 1416, leftRot, LINE);
    on = pushScreen(opos, ouv, ocol, on, 12, 512.6168, -3.30227, 2, 1416, rightRot, LINE);
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(opos, 3));
    og.setAttribute('uv', new THREE.BufferAttribute(ouv, 2));
    og.setAttribute('tint', new THREE.BufferAttribute(ocol, 4));
    og.setDrawRange(0, on);
    const outline = new THREE.Mesh(og, pink);
    outline.frustumCulled = false;
    outline.renderOrder = 0;
    this.laneUi.add(outline);

    const line = lib.sprites.sc2_ingame_tap_line;
    const meta = lib.meta.sc2_ingame_tap_line;
    const mat = spriteMaterial(line);
    const cap = 24;
    const pos = new Float32Array(cap * 3), uv = new Float32Array(cap * 2), col = new Float32Array(cap * 4);
    const bw = meta?.rect[2] || 168;
    const left = meta?.border[0] ?? 81, right = meta?.border[2] ?? 81;
    const uL = left / bw, uR = right / bw;
    const w = 1612, h = 54, x0 = -w / 2;
    let n = 0;
    const piece = (x: number, width: number, u0: number, u1: number) => {
      if (width <= 0) return;
      n = pushScreen(pos, uv, col, n, cap, x + width / 2, -253, width, h, 0, [1, 1, 1, 1], u0, u1);
    };
    piece(x0, left, 0, uL);
    piece(x0 + left, w - left - right, uL, 1 - uR);
    piece(x0 + w - right, right, 1 - uR, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('tint', new THREE.BufferAttribute(col, 4));
    geo.setDrawRange(0, n);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.laneUi.add(mesh);
  }

  /** Lane / darkness / grid / startZ from RhythmGameOptionValue (excl. judgement). */
  setVisualOptions(o: {
    noteStartZ?: number;
    laneWidth?: number;
    gridCount?: number;
    laneDarkness?: number;
  }): void {
    let linesDirty = false;
    if (o.noteStartZ !== undefined) this.noteStartZ = o.noteStartZ;
    if (o.laneWidth !== undefined) {
      this.laneWidthOpt = o.laneWidth;
      this.applyLaneWidthScale();
      linesDirty = true;
    }
    if (o.gridCount !== undefined) {
      this.gridCountOpt = o.gridCount;
      linesDirty = true;
    }
    if (o.laneDarkness !== undefined) {
      this.laneDarknessOpt = o.laneDarkness;
      this.applyPlaneDarkness();
    }
    if (linesDirty) this.rebuildLaneLines();
  }


  private drawTrack(slopeSpawn: number): void {
    const pitch = lanePitch(this.laneWidthOpt);
    const half = pitch * 30;
    const spanZ = slopeSpawn - BORDER;
    const midZ = (slopeSpawn + BORDER) / 2;
    // LaneDarkness drives Plane Fade (applyPlaneDarkness), not this OldBatch fill.
    this.track.quad(0, Y, midZ, half * 2, spanZ, [.06, .11, .20], .86, false);
    const grids = gridLaneCount(this.gridCountOpt as 0 | 1 | 2 | 3 | 4 | 5);
    // Always draw outer rails; optional inner dividers from GridCount.
    this.track.quad(-half, Y, midZ, .025, spanZ, [.93, .37, .67], 0.8, false);
    this.track.quad(half, Y, midZ, .025, spanZ, [.93, .37, .67], 0.8, false);
    if (grids > 0) {
      for (let i = 1; i < grids; i++) {
        const x = -half + (2 * half * i) / grids;
        this.track.quad(x, Y, midZ, .009, spanZ, [.93, .37, .67], 0.2, false);
      }
    } else {
      for (let i = 1; i < 10; i++) {
        this.track.quad(-half + i * (2 * half) / 10, Y, midZ, .009, spanZ, [.93, .37, .67], 0.12, false);
      }
    }
    this.track.quad(0, Y, BORDER, half * 2 + pitch, .075, [1, .52, .76], 1, false);
  }

  render(chart: Chart, time: number, speed: number, mirror: boolean, simultaneous: boolean) {
    if (!this.lib) { this.renderOld(chart, time, speed, mirror, simultaneous); return; }
    this.renderField(chart, time, speed, mirror, simultaneous);
  }
  private renderOld(chart: Chart, time: number, speed: number, mirror: boolean, simultaneous: boolean) {
    const slope = createSlope(speed, this.noteStartZ);
    for (const batch of [this.track, this.holds, this.lines, this.oldNotes]) batch.reset();
    this.drawTrack(slope.spawn);
    let visible = 0;
    for (const root of chart.roots) {
      if (root.type !== 1) { visible += this.drawOld(root, time, slope, mirror); continue; }
      let tail = root; while (tail.next) tail = tail.next;
      if (time < root.time - slope.duration || time >= tail.end) continue;
      const segments: number[][] = [];
      let segment: Note | undefined = root;
      while (segment) { const v = holdSegment(segment, time, slope, mirror, this.laneWidthOpt); if (v.length) segments.push(v); segment = segment.next; }
      if (segments.length > 1) for (const i of [0, 6, 12]) segments[0].splice(i + 3, 3, ...segments[1].slice(i, i + 3));
      for (const v of segments) this.holds.ribbon(v, time >= root.time);
      let head = root; while (head.next && time >= head.end) head = head.next;
      const progress = Math.max(0, Math.min(1, (time - head.time) / (head.end - head.time))), [l, r] = edges(head, progress, mirror);
      this.symbolOld((l + r) / 2, Math.max(slope.zAt(head.time - time), BORDER), r - l + 1, 1); visible++;
      if (tail.end - time <= slope.duration) { const [tl, tr] = edges(tail, 1, mirror); this.symbolOld((tl + tr) / 2, slope.zAt(tail.end - time), tr - tl + 1, 1); }
    }
    if (simultaneous) for (const line of chart.lines) {
      const z = slope.zAt(line.time - time); if (line.time < time || line.time - time > slope.duration) continue;
      const xs = line.points.map(p => { const [l, r] = edges(p.note, p.tail ? 1 : 0, mirror); return worldX((l + r) / 2, this.laneWidthOpt); });
      const min = Math.min(...xs), max = Math.max(...xs); this.lines.quad((min + max) / 2, Y, z, max - min, .035, [.85, .94, 1], .6);
    }
    for (const batch of [this.track, this.holds, this.lines, this.oldNotes]) batch.flush();
    this.gl.autoClear = true;
    this.gl.render(this.scene, this.camera);
    this.canvas.dataset.visibleNotes = String(visible); this.canvas.dataset.drawCalls = String(this.gl.info.render.calls); this.canvas.dataset.time = time.toFixed(4);
  }
  private drawOld(n: Note, time: number, slope: ReturnType<typeof createSlope>, mirror: boolean) {
    const remaining = n.time - time;
    if (remaining < -.18 || remaining > slope.duration) return 0;
    const [l, r] = edges(n, 0, mirror);
    if (remaining >= 0) this.symbolOld((l + r) / 2, slope.zAt(remaining), r - l + 1, n.type);
    else this.oldNotes.quad(worldX((l + r) / 2, this.laneWidthOpt), Y, BORDER, ((r - l + 1) * lanePitch(this.laneWidthOpt)) * (1 - remaining * 4), .12 - remaining, COLORS[n.type], 1 + remaining / .18);
    return 1;
  }
  private symbolOld(lane: number, z: number, width: number, type: number) {
    const x = worldX(lane, this.laneWidthOpt), w = ((width - 6) * .2 + 1.15) * .75, h = type === 3 ? .22 : .34, color = COLORS[type];
    this.oldNotes.quad(x, Y, z, w, h, color, .98);
    this.oldNotes.quad(x, Y + .035, z, w * .94, h * .18, [1, 1, 1], .9);
    if (type === 2) { this.oldNotes.quad(x - .12, Y + .40, z, .06, .24, [1, .8, .92]); this.oldNotes.quad(x + .12, Y + .40, z, .06, .24, [1, .8, .92]); }
    if (type === 3) this.oldNotes.quad(x, Y, z, Math.min(w, .12), h * 1.6, [1, 1, 1], 1);
  }
  private renderField(chart: Chart, time: number, speed: number, mirror: boolean, simultaneous: boolean) {
    const lib = this.lib!;
    const slope = createSlope(speed, this.noteStartZ);
    this.ribbon.reset();
    for (const batch of this.sheets.values()) batch.reset();
    this.drawTrack(slope.spawn);
    this.lines.reset();
    this.fx?.sync(chart, time, mirror);
    let visible = 0;
    for (const root of chart.roots) {
      if (root.type !== 1) { visible += this.drawSprite(root, time, slope, mirror, lib); continue; }
      let tail = root; while (tail.next) tail = tail.next;
      if (time < root.time - slope.duration || time >= tail.end) continue;
      const active = time >= root.time;
      let phase = this.phase.get(root.uid) ?? PHASE_START;
      const alpha = holdAlpha(active, phase);
      this.phase.set(root.uid, alpha.phase);
      const segments: number[][] = [];
      let segment: Note | undefined = root;
      while (segment) { const v = holdSegment(segment, time, slope, mirror, this.laneWidthOpt); if (v.length) segments.push(v); segment = segment.next; }
      if (segments.length > 1) for (const i of [0, 6, 12]) segments[0].splice(i + 3, 3, ...segments[1].slice(i, i + 3));
      for (const v of segments) this.ribbon.n = this.pushRibbon(v, alpha.center, alpha.side);
      let head = root; while (head.next && time >= head.end) head = head.next;
      const progress = Math.max(0, Math.min(1, (time - head.time) / (head.end - head.time)));
      const [l, r] = edges(head, progress, mirror);
      const hx = worldX((l + r) / 2, this.laneWidthOpt);
      this.noteSprite(hx, Math.max(slope.zAt(head.time - time), BORDER), r - l + 1, 1, lib, time);
      this.fx?.setLoop(root.uid, hx);
      visible++;
      if (tail.end - time <= slope.duration && tail.end - time >= 0) {
        const [tl, tr] = edges(tail, 1, mirror);
        this.noteSprite(worldX((tl + tr) / 2, this.laneWidthOpt), slope.zAt(tail.end - time), tr - tl + 1, 1, lib, time);
      }
    }
    if (simultaneous) for (const line of chart.lines) {
      const z = slope.zAt(line.time - time); if (line.time < time || line.time - time > slope.duration) continue;
      const xs = line.points.map(p => { const [l, r] = edges(p.note, p.tail ? 1 : 0, mirror); return worldX((l + r) / 2, this.laneWidthOpt); });
      const min = Math.min(...xs), max = Math.max(...xs);
      this.lines.quad((min + max) / 2, Y, z, max - min, .035, [.85, .94, 1], .6);
    }
    this.fx?.draw();
    this.ribbon.flush();
    for (const batch of this.sheets.values()) batch.flush();
    this.lines.flush();
    this.gl.autoClear = false;
    this.gl.clear(true, true, false);
    this.gl.render(this.field, this.camera);
    this.gl.clearDepth();
    this.gl.render(this.ui, this.uiCam);
    this.gl.clearDepth();
    this.gl.render(this.notes, this.camera);
    this.canvas.dataset.visibleNotes = String(visible); this.canvas.dataset.drawCalls = String(this.gl.info.render.calls); this.canvas.dataset.time = time.toFixed(4);
  }
  private pushRibbon(vertices: number[], centerA: number, sideA: number) {
    const order = [0, 1, 2, 3, 2, 1, 2, 3, 4, 5, 4, 3];
    let n = this.ribbon.n;
    if (n + 12 > this.ribbon.cap) return n;
    for (const index of order) {
      const center = index === 2 || index === 3;
      const rgb = center ? HOLD_CENTER : HOLD_SIDE;
      this.ribbon.pos[n * 3] = vertices[index * 3];
      this.ribbon.pos[n * 3 + 1] = vertices[index * 3 + 1];
      this.ribbon.pos[n * 3 + 2] = -vertices[index * 3 + 2];
      this.ribbon.uv[n * 2] = 0; this.ribbon.uv[n * 2 + 1] = 0;
      this.ribbon.col[n * 4] = rgb[0]; this.ribbon.col[n * 4 + 1] = rgb[1]; this.ribbon.col[n * 4 + 2] = rgb[2];
      this.ribbon.col[n * 4 + 3] = center ? centerA : sideA;
      n++;
    }
    return n;
  }
  private drawSprite(n: Note, time: number, slope: ReturnType<typeof createSlope>, mirror: boolean, lib: RgLibrary) {
    const remaining = n.time - time;
    if (remaining < -.18 || remaining > slope.duration) return 0;
    if (remaining >= 0) {
      const [l, r] = edges(n, 0, mirror);
      this.noteSprite(worldX((l + r) / 2, this.laneWidthOpt), slope.zAt(remaining), r - l + 1, n.type, lib, time);
    }
    return 1;
  }
  private sheet(name: string, order: number) {
    let batch = this.sheets.get(name);
    if (batch || !this.lib?.sprites[name]) return batch;
    batch = new TexBatch(160000, spriteMaterial(this.lib.sprites[name]), order);
    this.sheets.set(name, batch);
    this.notes.add(batch.mesh);
    return batch;
  }
  private noteSprite(x: number, z: number, width: number, type: number, lib: RgLibrary, time: number) {
    const name = SPRITE[type] || SPRITE[0];
    const batch = this.sheet(name, 20);
    if (!batch) return;
    const w = worldWidthOf(width), h = worldDepth(type);
    batch.n = pushSlicedNote(batch.pos, batch.uv, batch.col, batch.n, batch.cap, x, Y, z, w, h, lib.meta[name]);
    if (type === 2) this.flick(x, z, w, lib, time);
  }
  private flick(x: number, z: number, worldW: number, lib: RgLibrary, time: number) {
    const arrowName = 'ui_sc2_ingame_notes_texture_arrow';
    const arrow = this.sheet(arrowName, 21);
    const meta = lib.meta[arrowName];
    if (arrow && meta) {
      const sizeX = 0.45 * (worldW / 0.75), sizeY = 0.5, scaleY = 0.45 * 1.45;
      const nativeW = (meta.rect[2] || 52) / (meta.ppu || 100);
      const nativeH = (meta.rect[3] || 50) / (meta.ppu || 100);
      const cx = 0.225 * worldW;
      const color = [1, 1, 1, 1];
      arrow.n = pushBillboard(arrow.pos, arrow.uv, arrow.col, arrow.n, arrow.cap, x - cx, Y, z, sizeX * 0.75, sizeY * scaleY, color, sizeX / nativeW, sizeY / nativeH);
      arrow.n = pushBillboard(arrow.pos, arrow.uv, arrow.col, arrow.n, arrow.cap, x + cx, Y, z, sizeX * 0.75, sizeY * scaleY, color, -(sizeX / nativeW), sizeY / nativeH);
    }
    const symbolName = 'ui_sc2_ingame_notes_icon_flick';
    const symbol = this.sheet(symbolName, 25);
    const sm = lib.meta[symbolName];
    if (symbol && sm) symbol.n = pushBillboard(symbol.pos, symbol.uv, symbol.col, symbol.n, symbol.cap, x, Y, z, sm.rect[2] / sm.ppu * 0.6, sm.rect[3] / sm.ppu * 0.6, [1, 1, 1, 1]);
    const signName = 'ui_sc2_ingame_flick_sign';
    const sign = this.sheet(signName, 25);
    const gm = lib.meta[signName];
    if (sign && gm) {
      const bob = flickSignY(time);
      sign.n = pushBillboard(sign.pos, sign.uv, sign.col, sign.n, sign.cap, x, Y + Math.cos(PITCH) * bob, z + Math.sin(PITCH) * bob, gm.rect[2] / gm.ppu * 0.8, gm.rect[3] / gm.ppu * 0.8, [1, 1, 1, 1]);
    }
  }
  private resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    this.gl.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 16 / 9 ? 2 * Math.atan(Math.tan(Math.PI / 6) * (16 / 9) / this.camera.aspect) * 180 / Math.PI : 60;
    this.camera.updateProjectionMatrix();
    this.uiCam.left = -w / 2; this.uiCam.right = w / 2; this.uiCam.top = h / 2; this.uiCam.bottom = -h / 2;
    this.uiCam.updateProjectionMatrix();
    const s = Math.min(w / 1920, h / 1080);
    this.uiRoot.scale.set(s, s, 1);
  }

  setHitEffectMode(mode: 'off' | 'current') {
    this.hitEffectMode = mode;
    this.fx?.setMode(mode);
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    for (const b of [this.track, this.holds, this.lines, this.oldNotes]) b.dispose();
    this.ribbon?.dispose();
    for (const batch of this.sheets.values()) batch.dispose();
    this.fx?.dispose();
    this.white.dispose();
    this.gl.dispose();
  }
}
