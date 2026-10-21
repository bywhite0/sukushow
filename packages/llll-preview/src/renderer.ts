import * as THREE from 'three';
import type { Chart, Note } from '@sukushow/chart/chart';
import { BORDER, PLANE_FAR, PLANE_NEAR, PLANE_Y, Y, createSlope, edges, holdSegment, worldX, lanePitch } from './geometry';
import {
  FLAT_JUDGE_DEFAULT, FLAT_PITCH, FLAT_TRACK_DEFAULT, JUDGE_LINE_OFFSET, LANE_HALF_WIDTH,
  PLANE_HALF_WIDTH, RAIL_HALF_WIDTH, TAP_LINE_WIDTH,
  createFlatSlope, designScale, flatFrame, type FlatFrame,
} from './flatView';
import { gridLaneCount } from './rgOptions';
import { flushDynamicGeometry } from './dynamicBuffer';
import { HitFx } from './fx';
import { FeverLayers } from './feverLayers';
import { FEVER_MOVE_EMIT_X } from './fever';
import { feverEntrance } from './feverAnimation';
import { feverLineParticle } from './feverLines';
import { loadRgLibrary, whiteTexture, type RgLibrary, type RgLoadProgress } from './rgAssets';
import { planeMaterial, spriteMaterial } from './shaders';
import {
  HOLD_CENTER, HOLD_SIDE, PHASE_START, PITCH, billboard, billboardUpUnityZ, flickSignY, holdAlpha,
  pushBillboard, pushScreen, pushSlicedNote, setBillboardPitch, worldDepth, worldWidthOf,
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
  quad(x: number, y: number, z: number, w: number, h: number, color: number[], alpha = 1, faceCamera = true) {
    const dy = faceCamera ? billboard.upY * h / 2 : 0, dz = faceCamera ? billboard.upZ * h / 2 : h / 2;
    const a = [x - w / 2, y - dy, -z - dz], b = [x + w / 2, y - dy, -z - dz], c = [x + w / 2, y + dy, -z + dz], d = [x - w / 2, y + dy, -z + dz];
    this.triangle([...a, ...b, ...c], color, alpha); this.triangle([...a, ...c, ...d], color, alpha);
  }

  flush() { flushDynamicGeometry(this.geometry, this.count); }
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
  flush() { flushDynamicGeometry(this.geo, this.n); }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

const SPRITE = ['ui_sc2_ingame_notes_tap', 'ui_sc2_ingame_notes_hold', 'ui_sc2_ingame_notes_flick', 'ui_sc2_ingame_notes_trace'];
const LINE = [1, 0.2274509817, 0.6, 1];
/** 2D 轨道边线宽度（世界单位，≈2 px）；`LineBase` 彩虹光带用原包宽度 0.13（≈10 px）。 */
const RAIL_WIDTH = 0.025;

export type CameraMode = '3d' | '2d';
/** 3D 游戏机位。 */
const CAMERA_3D_Y = 9, CAMERA_3D_Z = 8.65;

export class PreviewRenderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private field = new THREE.Scene();
  private ui = new THREE.Scene();
  private notes = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 16 / 9, .3, 1000);
  private cameraMode: CameraMode = '3d';
  /** 2D 俯视取景（相机位置、可见长度、判定线缩放）；3D 下为 null。 */
  private frame2d: FlatFrame | null = null;
  /** 画布 CSS 尺寸（resize 时记录，供 2D 取景换算）。 */
  private viewW = 0;
  private viewH = 0;
  /** 判定线贴图（laneUi 子节点）；2D 下按轨道宽度等比缩放。 */
  private tapLine: THREE.Mesh | null = null;
  /** 2D 轨道宽度（舞台宽的百分比，预览设置可调；越大相机越近、读谱窗口越短）。 */
  private flatTrackOpt = FLAT_TRACK_DEFAULT;
  /** 2D 判定线位置（舞台高度的百分比，预览设置可调；判定线贴图与边线近端跟随）。 */
  private flatJudgeOpt = FLAT_JUDGE_DEFAULT;
  private uiCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private uiRoot = new THREE.Group();
  /** Under uiRoot; X = LaneWidth/100 like RhythmGameWorldScaler (BorderLine + OutLine). */
  private laneUi = new THREE.Group();
  private track = new OldBatch(1000, 0);
  /** 2D-only projection of the two existing 3D lane edges; no fill or dividers. */
  // 2D 边线批：2 条边线（揭示期会被切成彩虹段 + 常色段 = 4 个四边形）+ 2 条 LineMove 长条。
  private worldLaneEdges = new OldBatch(48, 0);
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
  private laneOutline: THREE.Mesh | null = null;
  private noteStartZ = 0;
  private laneWidthOpt = 100;
  private gridCountOpt = 0;
  private laneDarknessOpt = 80;
  private fx: HitFx | null = null;
  private feverLayers: FeverLayers | null = null;
  private hitEffectMode: 'off' | 'current' | 'limited' | 'full' = 'current';
  private feverOn = false;
  private feverStart = 0;
  private phase = new Map<number, number>();
  /** 走带是否在播放：暂停时粒子与 hold 呼吸光冻结。 */
  private playing = true;
  private lastFieldTime = NaN;
  private observer: ResizeObserver;
  private disposed = false;
  /** 导出时的固定画布尺寸（CSS px × dpr）；非 null 时忽略 ResizeObserver。 */
  private fixedSize: { w: number; h: number; dpr: number } | null = null;
  /** 本帧 hold 呼吸光推进的步数（实时 = 每帧 1 步；导出按 dt × 60 折算，见 setPhaseSteps）。 */
  private phaseSteps = 1;
  constructor(private canvas: HTMLCanvasElement, onResourceProgress?: (progress: RgLoadProgress) => void) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
    this.gl.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.gl.setClearColor(0x000000, 0);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, CAMERA_3D_Y, CAMERA_3D_Z); this.setCameraMode('3d');
    for (const batch of [this.track, this.worldLaneEdges, this.holds, this.lines, this.oldNotes]) this.scene.add(batch.mesh);
    this.ui.add(this.uiRoot);
    this.uiRoot.add(this.laneUi);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas); this.resize();
    this.libReady = loadRgLibrary(onResourceProgress).then(lib => { if (!this.disposed && lib) this.useLibrary(lib); }).catch(() => undefined);
  }
  private readonly libReady: Promise<void>;
  /** 原包资源库加载结束（成功或失败）；导出前等待，避免前几帧退回简易绘制。 */
  whenReady(): Promise<void> {
    return this.libReady;
  }
  private useLibrary(lib: RgLibrary) {
    this.lib = lib;
    const sprite = spriteMaterial(this.white);
    this.ribbon = new TexBatch(600000, sprite, 1);
    this.notes.add(this.ribbon.mesh);
    this.notes.add(this.lines.mesh);
    const plane = this.plane();
    this.field.add(plane);
    this.field.add(this.worldLaneEdges.mesh);
    this.worldLaneEdges.mesh.visible = this.cameraMode === '2d';
    // LaneLine shares Plane transform (level56); WorldScaler X = LaneWidth/100
    plane.add(this.laneLines);
    this.rebuildLaneLines();
    this.buildUi(lib);
    this.applyLaneWidthScale();
    // 资源加载完才有 Plane / 判定线贴图，2D 取景要再套一次（相机本身 resize 时已摆好）。
    this.applyCameraFrame();
    if (lib.fx) {
      this.fx = new HitFx(lib.fx, lib.fxTex);
      this.fx.setLaneWidth(this.laneWidthOpt);
      this.fx.setMode(this.hitEffectMode);
      // 粒子随机数按启动参数播种：拖动 / 重放 / 导出在同一时刻得到同一组粒子。
      this.fx.setDeterministic(true);
      this.notes.add(this.fx.group);
      const base = lib.fxTex.sc2_NotesEffectCircle_007;
      const move = lib.fxTex.sc2_feverLine01;
      const mask = lib.fxTex.fever_mask;
      if (base && move && mask) {
        this.feverLayers = new FeverLayers(base, move, mask, this.laneWidthOpt);
        this.notes.add(this.feverLayers.group);
      }
    }
    // 同时押线已移入正式音符场景，不能随旧绘制对象一起隐藏。
    for (const batch of [this.track, this.holds, this.oldNotes]) batch.mesh.visible = false;
  }
  private plane() {
    const y = PLANE_Y, near = PLANE_NEAR, far = PLANE_FAR;
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

  /**
   * RhythmGameWorldScaler.SetScaleX(LaneWidth/100) — Plane + LaneLines + Canvas BorderLine/OutLine on X.
   *
   * 2D 再乘 `planeScaleX`：轨道平面在 y = `PLANE_Y`（比音符面低 0.54），投影比例比音符面小
   * `planeFitX` 倍；平面横向缩到「投影宽度 = 轨道宽度（60 个 lane 的跨度）」，它的投影边缘就正好
   * 压在两侧边线（= 音符外沿）上。`LaneLines` 是 Plane 的子节点，跟着 Plane 的 scale 走，
   * 不能再单独乘一次（否则分割线会伸出轨道）。
   */
  private applyLaneWidthScale(): void {
    const s = this.laneWidthOpt / 100;
    const fit = this.cameraMode === '2d' ? this.frame2d?.planeScaleX ?? 1 : 1;
    if (this.planeMesh) this.planeMesh.scale.set(s * fit, 1, 1);
    this.laneUi.scale.set(s, 1, 1);
    this.feverLayers?.setLaneWidth(this.laneWidthOpt);
    this.fx?.setLaneWidth(this.laneWidthOpt);
  }

  /**
   * 两侧轨道边线的世界半宽：2D = 可玩轨道跨度 `LANE_HALF_WIDTH`（音符横向正好撑满，
   * 与 3D 判定线处的观感一致）；3D 的 Fever 彩虹边线仍在原包 `RAIL_HALF_WIDTH`（±5.03）。
   */
  private railHalfWidth(): number {
    const half = this.cameraMode === '2d' ? this.frame2d?.railX ?? LANE_HALF_WIDTH : RAIL_HALF_WIDTH;
    return half * (this.laneWidthOpt / 100);
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
    const y = PLANE_Y, near = PLANE_NEAR, far = PLANE_FAR;
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
    this.laneOutline = outline;
    outline.visible = this.cameraMode === '3d';

    const line = lib.sprites.sc2_ingame_tap_line;
    const meta = lib.meta.sc2_ingame_tap_line;
    const mat = spriteMaterial(line);
    const cap = 24;
    const pos = new Float32Array(cap * 3), uv = new Float32Array(cap * 2), col = new Float32Array(cap * 4);
    const bw = meta?.rect[2] || 168;
    const left = meta?.border[0] ?? 81, right = meta?.border[2] ?? 81;
    const uL = left / bw, uR = right / bw;
    const w = TAP_LINE_WIDTH, h = 54, x0 = -w / 2;
    let n = 0;
    // 几何以自身中心为原点、位置偏移放在 mesh.position.y：2D 下等比缩放贴图时判定点才不会跑。
    const piece = (x: number, width: number, u0: number, u1: number) => {
      if (width <= 0) return;
      n = pushScreen(pos, uv, col, n, cap, x + width / 2, 0, width, h, 0, [1, 1, 1, 1], u0, u1);
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
    mesh.position.y = -253;
    this.laneUi.add(mesh);
    // 2D 下这张贴图要缩到轨道宽度（见 applyCameraFrame），3D 保持设计宽度。
    this.tapLine = mesh;
    const frame = this.currentFrame();
    if (frame) {
      mesh.scale.set(frame.lineScale, frame.lineScale, 1);
      mesh.position.y = frame.lineUiY;
    }
  }

  /** Lane / darkness / grid / startZ from RhythmGameOptionValue (excl. judgement). */
  setVisualOptions(o: {
    noteStartZ?: number;
    laneWidth?: number;
    gridCount?: number;
    laneDarkness?: number;
    /** 2D 轨道宽度（舞台宽的百分比）；等价于调 2D 相机距离，只影响 2D 取景。 */
    flatTrackWidth?: number;
    /** 2D 判定线位置（舞台高度的百分比）；判定线贴图 / 边线近端 / 下落窗口一起移动。 */
    flatJudgeLine?: number;
  }): void {
    let linesDirty = false;
    if (o.noteStartZ !== undefined) this.noteStartZ = o.noteStartZ;
    if (o.flatTrackWidth !== undefined && o.flatTrackWidth !== this.flatTrackOpt) {
      this.flatTrackOpt = o.flatTrackWidth;
      this.applyCameraFrame();
    }
    if (o.flatJudgeLine !== undefined && o.flatJudgeLine !== this.flatJudgeOpt) {
      this.flatJudgeOpt = o.flatJudgeLine;
      this.applyCameraFrame();
    }
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


  private drawTrack(slopeSpawn: number, near = BORDER): void {
    const pitch = lanePitch(this.laneWidthOpt);
    const half = pitch * 30;
    const spanZ = slopeSpawn - near;
    const midZ = (slopeSpawn + near) / 2;
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

  /** Switch the single 3D scene between the gameplay angle and a top-down 2D angle. */
  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    // 贴图朝向跟着相机俯角走：2D 垂直向下 ⇒ 音符 / 粒子 / 拖尾平铺在轨道面上。
    setBillboardPitch(mode === '2d' ? FLAT_PITCH : PITCH);
    this.fx?.setFlat(mode === '2d');
    this.applyCameraFrame();
    if (this.laneOutline) this.laneOutline.visible = mode === '3d';
    if (this.worldLaneEdges.mesh.parent) this.worldLaneEdges.mesh.visible = mode === '2d';
    this.canvas.dataset.cameraMode = mode;
    this.canvas.dataset.cameraAngle = this.camera.rotation.x.toFixed(4);
  }

  /**
   * 按当前模式摆相机。
   *
   * 3D：固定游戏机位；2D：垂直俯视，机位由 `flatFrame` 反解（轨道宽度、判定点高度、
   * 判定线贴图缩放都在那里算），同时把轨道平面补到画布底边。
   */
  private applyCameraFrame(): void {
    if (this.cameraMode === '3d') {
      this.frame2d = null;
      this.camera.position.set(0, CAMERA_3D_Y, CAMERA_3D_Z);
      this.camera.rotation.set(-PITCH, 0, 0);
      this.camera.updateMatrixWorld(true);
      if (this.planeMesh) this.planeMesh.position.z = 0;
      if (this.tapLine) {
        this.tapLine.scale.set(1, 1, 1);
        this.tapLine.position.y = -JUDGE_LINE_OFFSET;
      }
      this.applyLaneWidthScale();
      return;
    }
    if (!this.viewW || !this.viewH) return;
    const frame = flatFrame(this.viewW, this.viewH, this.camera.fov, this.flatTrackOpt, this.flatJudgeOpt);
    this.frame2d = frame;
    this.camera.position.set(0, frame.camY, frame.camZ);
    this.camera.rotation.set(-FLAT_PITCH, 0, 0);
    this.camera.updateMatrixWorld(true);
    // Plane 近端（Three z = PLANE_NEAR）够不到画布底边，整体往相机侧推一点；底边按平面自身高度换算，
    // 否则平面比音符面低 0.54、投影略小，底边会露在画面里（能看到轨道区域的下界）。
    if (this.planeMesh) this.planeMesh.position.z = Math.max(0, frame.planeNearZ - PLANE_NEAR);
    // 平面 / 分割线的横向拉伸（贴到两侧边线上）。
    this.applyLaneWidthScale();
    // 判定线贴图等比缩到轨道平面的投影宽度（3D 里它是固定 1612 设计 px），中心跟着判定线走。
    if (this.tapLine) {
      this.tapLine.scale.set(frame.lineScale, frame.lineScale, 1);
      this.tapLine.position.y = frame.lineUiY;
    }
  }

  /** 当前模式的 2D 取景；3D 返回 null（2D 下若还没算过就补算一次）。 */
  private currentFrame(): FlatFrame | null {
    if (this.cameraMode !== '2d') return null;
    if (!this.frame2d && this.viewW && this.viewH) this.applyCameraFrame();
    return this.frame2d;
  }

  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  /** 测试 / 调试：当前相机状态与 2D 取景（只读）。 */
  getCameraState() {
    return {
      mode: this.cameraMode,
      position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      pitch: this.camera.rotation.x,
      frame: this.frame2d,
    };
  }

  /**
   * 测试 / 调试：2D 下判定线贴图与轨道的实际屏幕尺寸（CSS px），以及判定点投影高度。
   * `linePx` 应当比 `planePx` / `trackPx` 宽 `LINE_OVERHANG` 倍（两端出轨道）；
   * `judgePointY` 应当等于 `judgeY`（判定点落在贴图中心）。
   */
  debugFlatLayout() {
    const frame = this.frame2d;
    if (!frame) return null;
    const laneWidthScale = this.laneWidthOpt / 100;
    const planeScale = (frame.scale * (frame.camY - Y)) / (frame.camY - PLANE_Y);
    // 平面横向缩到 planeScaleX，投影宽度 = 轨道宽度（60 个 lane 的跨度）⇒ 平面边缘 = 边线 = 音符外沿。
    const planePx = 2 * PLANE_HALF_WIDTH * planeScale * (this.planeMesh?.scale.x ?? laneWidthScale);
    const railX = this.railHalfWidth();
    const linePx = TAP_LINE_WIDTH * (this.tapLine?.scale.x ?? 1) * laneWidthScale * designScale(this.viewW, this.viewH);
    const judge = new THREE.Vector3(0, Y, -BORDER).project(this.camera);
    // uiCam 是正交相机：屏幕 y = h/2 − 世界 y（自上而下）。
    const lineCenterY = this.tapLine
      ? this.viewH / 2 - this.tapLine.getWorldPosition(new THREE.Vector3()).y
      : Number.NaN;
    // 平面近端的屏幕 y（CSS px，自上而下）：≥ 舞台高才算铺满画布底边。
    const planeNearZ = PLANE_NEAR + (this.planeMesh?.position.z ?? 0);
    const planeBottomY = this.viewH / 2 + (planeNearZ - frame.camZ) * planeScale;
    return {
      planePx,
      linePx,
      /** 轨道实际宽度（平面 / 边线的较大者）× LaneWidth 缩放。 */
      trackPx: frame.trackPx * laneWidthScale,
      /** 当前生效的「2D 轨道宽度」设置（舞台宽的百分比）。 */
      trackWidthOpt: this.flatTrackOpt,
      /** 当前生效的「2D 判定线位置」设置（舞台高的百分比）。 */
      judgeLineOpt: this.flatJudgeOpt,
      judgeY: frame.judgeY,
      judgePointY: ((1 - judge.y) / 2) * this.viewH,
      lineCenterY,
      field: frame.field,
      scale: frame.scale,
      // 轨道平面近端（Three z）与画布底边对应的 z：前者 ≥ 后者才算铺满。
      planeNearZ,
      bottomZ: frame.bottomZ,
      /** 平面近端投影到屏幕上的 y（CSS px）；≥ 舞台高 = 看不到轨道下界。 */
      planeBottomY,
      /** 轨道平面 / 音符面的投影比例（> 1 = 平面投影更小）；平面按它横向缩放（`planeScaleX`）。 */
      planeFitX: frame.planeFitX,
      /** 平面在 X 上的缩放：投影宽度 = 轨道宽度（3D 里是 1）。 */
      planeScaleX: this.planeMesh?.scale.x ?? 1,
      /** 两侧边线的 x（世界单位，已含 LaneWidth 缩放）：2D = 音符外沿 = 轨道半宽。 */
      railX,
      /** 两侧边线的跨度（CSS px）：与 `planePx` 相等，边线正好压在平面边缘。 */
      railPx: 2 * railX * frame.scale,
    };
  }

  /**
   * 2D 的两条轨道边线（俯视时贴在轨道面上的平条）：x = ∓`railHalfWidth()`，2D 下就是可玩轨道
   * 半宽（= 音符外沿，音符横向正好撑满轨道），3D 的 `LineBase` 在 ∓`RAIL_HALF_WIDTH` ≈ ±5.03。
   * 都随 LaneWidth 缩放。
   *
   * Fever 期间同一条边线改画 `LineBase` 的彩虹色（六色轮转，周期 1.6 s），再把
   * `LineMove` 的条带平铺到轨道面上。
   *
   * **`LineMove` 不是「沿边线跑的行进高光」** —— 那是入场彗星 `LineCoreMove`（`n_L/R`，
   * 只在 Fever 起点射一次、拖着彩虹由近及远揭示）。`LineMove`（#604/#570）是每 0.8 s 从
   * **轨道顶部中央** `(0.024, 9.021, 0)` 射出、向**轨道外扩散**的长条，尺寸恒为
   * `(0.11, 120)`（远超可见范围，两端扫出画面外），合速度 `(∓0.35, 0, 1.3)` 且 `looping`。
   * 它的长轴来自边线帧的 +Y，也就是**轨道边的走向**：2D 平铺时按轨道面 z 方向画（与两侧边线
   * 平行）；横向则贴在两条边线上、按原包 ∓0.35 u/s 向轨道外扩散——所以看到的是两条沿边线
   * 滑出的长光带，而不是轨道中央的一道竖光。
   */
  private drawWorldLaneEdges(slopeSpawn: number, near = BORDER, time = 0): void {
    this.worldLaneEdges.reset();
    const half = this.railHalfWidth();
    const spanZ = slopeSpawn - near;
    const midZ = (slopeSpawn + near) / 2;
    const fever = this.cameraMode === '2d' && this.feverOn;
    const elapsed = Math.max(0, time - this.feverStart);
    // `LineMask` 揭示：彩虹不是一进 Fever 就整条亮起，而是遮罩从判定线端向远端生长
    // （`LineMask_L/R` 的 scale.y 0→68，0.4333 s 走完）。3D 用 stencil 遮罩裁剪
    // `LineBase`/`LineMove`；2D 没有 stencil 通道，改成把同一段「已揭示窗口」当裁剪区间，
    // 让 0.13 宽（≈10 px）的彩虹光带从判定线端长出来 —— 只改颜色的话根本看不出来。
    const reveal = fever ? Math.min(1, Math.max(0, feverEntrance(elapsed).leftMask[1] / 68)) : 1;
    // 2D 的 fever 边线层（LineCoreMove 彗星 / LineParticle 火花）要贴在这两条边线上，
    // 火花同样只落在已揭示的那一段里。
    this.fx?.setFlatRail(fever ? { railX: half, zNear: near, zFar: slopeSpawn, reveal } : null);
    // 轨道边线本身整条常驻、恒为常色（这是轨道的边界，不是 `LineBase`）：Fever 时彩虹只出现在
    // 遮罩已揭示的那一段里，所以「彩虹从判定线端长出来」才看得出来。
    this.worldLaneEdges.quad(-half, Y, midZ, RAIL_WIDTH, spanZ, LINE.slice(0, 3), LINE[3], false);
    this.worldLaneEdges.quad(half, Y, midZ, RAIL_WIDTH, spanZ, LINE.slice(0, 3), LINE[3], false);
    if (!fever) return;
    const revealedZ = near + reveal * spanZ;
    if (revealedZ - near < 1e-3) return;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? -1 : 1;
      // `LineBase` 光带：原包宽 0.13（≈10 px），只画已揭示的那一段 ⇒ 从判定线端生长。
      const base = feverLineParticle('base', side, elapsed);
      this.worldLaneEdges.quad(
        sign * half, Y, (near + revealedZ) / 2, base.size[0], revealedZ - near,
        base.color.slice(0, 3), base.color[3], false,
      );
      // `LineMove` 长条（宽 0.11、长 120，远超可见范围）同样被遮罩裁剪：只留窗口内的部分。
      // 长轴对齐**轨道边**（轨道面上的 z）：原包条带是朝向相机的 billboard，其 +Y 就是边线
      // 走向（屏幕 39.89°），平铺时不能再拿世界向量的 (x,z) 投影，否则会画成横跨轨道的斜带。
      // 横向位置也贴在**边线**上（原包发射点 x=0.024 是「轨道顶部中央」的粒子原点，靠遮罩
      // 才显示在边线上），再叠加原包的 ∓0.35 u/s 外漂。
      const move = feverLineParticle('move', side, elapsed);
      const [width, length] = move.size;
      const drift = Math.abs(move.position[0] - FEVER_MOVE_EMIT_X);
      const z0 = Math.max(move.position[2] - length / 2, near);
      const z1 = Math.min(move.position[2] + length / 2, revealedZ);
      if (z1 - z0 > 1e-3) {
        this.worldLaneEdges.quad(
          sign * (half + drift), Y, (z0 + z1) / 2, width, z1 - z0,
          move.color.slice(0, 3), move.color[3], false,
        );
      }
    }
  }
  private renderOld(chart: Chart, time: number, speed: number, mirror: boolean, simultaneous: boolean) {
    const frame = this.currentFrame();
    const slope = frame ? createFlatSlope(speed, this.noteStartZ, frame.field) : createSlope(speed, this.noteStartZ);
    for (const batch of [this.track, this.holds, this.lines, this.oldNotes]) batch.reset();
    this.drawTrack(slope.spawn, frame ? BORDER - frame.below : BORDER);
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
    const scaleX = this.laneWidthOpt / 100;
    const x = worldX(lane, this.laneWidthOpt), w = worldWidthOf(width, this.laneWidthOpt), h = type === 3 ? .22 : .34, color = COLORS[type];
    this.oldNotes.quad(x, Y, z, w, h, color, .98);
    this.oldNotes.quad(x, Y + .035, z, w * .94, h * .18, [1, 1, 1], .9);
    if (type === 2) { this.oldNotes.quad(x - .12 * scaleX, Y + .40, z, .06 * scaleX, .24, [1, .8, .92]); this.oldNotes.quad(x + .12 * scaleX, Y + .40, z, .06 * scaleX, .24, [1, .8, .92]); }
    if (type === 3) this.oldNotes.quad(x, Y, z, Math.min(w, .12 * scaleX), h * 1.6, [1, 1, 1], 1);
  }
  private renderField(chart: Chart, time: number, speed: number, mirror: boolean, simultaneous: boolean) {
    const lib = this.lib!;
    const frame = this.currentFrame();
    // 2D 用线性下落曲线（等速），提前量时长与 3D 曲线一致；3D 保持原曲线。
    const slope = frame ? createFlatSlope(speed, this.noteStartZ, frame.field) : createSlope(speed, this.noteStartZ);
    const nearZ = frame ? BORDER - frame.below : BORDER;
    this.ribbon.reset();
    for (const batch of this.sheets.values()) batch.reset();
    this.drawTrack(slope.spawn, nearZ);
    this.drawWorldLaneEdges(slope.spawn, nearZ, time);
    this.lines.reset();
    this.paintFeverOutline(time);
    this.fx?.sync(chart, time, mirror, this.playing);
    const advance = this.playing && time !== this.lastFieldTime;
    this.lastFieldTime = time;
    this.fx?.setFever(this.feverOn, time - this.feverStart);
    let visible = 0;
    for (const root of chart.roots) {
      if (root.type !== 1) { visible += this.drawSprite(root, time, slope, mirror, lib); continue; }
      let tail = root; while (tail.next) tail = tail.next;
      if (time < root.time - slope.duration || time >= tail.end) continue;
      const active = time >= root.time;
      let phase = this.phase.get(root.uid) ?? PHASE_START;
      const alpha = holdAlpha(active, phase);
      // HoldNote 呼吸光按帧推进；暂停 / 时间不动时冻结。
      if (advance) this.phase.set(root.uid, alpha.phase + (this.phaseSteps - 1) * (alpha.phase - phase));
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
      this.fx?.setLoop(root.uid, worldX((l + r) / 2));
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
    this.worldLaneEdges.flush();
    this.ribbon.flush();
    for (const batch of this.sheets.values()) batch.flush();
    this.lines.flush();
    this.gl.autoClear = false;
    this.gl.clear(true, true, true);
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
    const w = worldWidthOf(width, this.laneWidthOpt), h = worldDepth(type);
    batch.n = pushSlicedNote(batch.pos, batch.uv, batch.col, batch.n, batch.cap, x, Y, z, w, h, lib.meta[name], undefined, .75 * (this.laneWidthOpt / 100));
    if (type === 2) this.flick(x, z, w, lib, time);
  }
  private flick(x: number, z: number, worldW: number, lib: RgLibrary, time: number) {
    const scaleX = this.laneWidthOpt / 100;
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
    if (symbol && sm) symbol.n = pushBillboard(symbol.pos, symbol.uv, symbol.col, symbol.n, symbol.cap, x, Y, z, sm.rect[2] / sm.ppu * 0.6 * scaleX, sm.rect[3] / sm.ppu * 0.6, [1, 1, 1, 1]);
    const signName = 'ui_sc2_ingame_flick_sign';
    const sign = this.sheet(signName, 25);
    const gm = lib.meta[signName];
    if (sign && gm) {
      // Sign 沿 billboard 的「上」浮动：3D 是相机上方，2D 是轨道面的远端。
      const bob = flickSignY(time);
      sign.n = pushBillboard(sign.pos, sign.uv, sign.col, sign.n, sign.cap, x, Y + billboard.upY * bob, z + billboardUpUnityZ() * bob, gm.rect[2] / gm.ppu * 0.8 * scaleX, gm.rect[3] / gm.ppu * 0.8, [1, 1, 1, 1]);
    }
  }
  /**
   * 导出用：把画布固定为 w×h（CSS px）× dpr，绕过 ResizeObserver；传 null 恢复跟随元素尺寸。
   */
  setFixedSize(size: { w: number; h: number; dpr: number } | null) {
    this.fixedSize = size;
    this.gl.setPixelRatio(size ? size.dpr : Math.min(devicePixelRatio, 2));
    this.resize();
  }
  /** 本帧 hold 呼吸光推进几步（原包按帧推进；导出按 dt × 60 折算，默认每帧 1 步）。 */
  setPhaseSteps(steps: number) {
    this.phaseSteps = Math.max(0, steps);
  }
  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }
  private resize() {
    if (this.disposed) return;
    const w = this.fixedSize?.w ?? this.canvas.clientWidth, h = this.fixedSize?.h ?? this.canvas.clientHeight; if (!w || !h) return;
    this.gl.setSize(w, h, false); this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 16 / 9 ? 2 * Math.atan(Math.tan(Math.PI / 6) * (16 / 9) / this.camera.aspect) * 180 / Math.PI : 60;
    this.camera.updateProjectionMatrix();
    this.uiCam.left = -w / 2; this.uiCam.right = w / 2; this.uiCam.top = h / 2; this.uiCam.bottom = -h / 2;
    this.uiCam.updateProjectionMatrix();
    const s = designScale(w, h);
    this.uiRoot.scale.set(s, s, 1);
    this.viewW = w; this.viewH = h;
    // 2D 机位由画布尺寸反解，resize 后必须重算。
    this.applyCameraFrame();
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
  }
  setFeverState(on: boolean, feverStart: number) {
    this.feverOn = on;
    this.feverStart = feverStart;
    if (!on) this.fx?.setFever(false);
  }

  private paintFeverOutline(time: number) {
    // 2D：3D 边线条带是朝向 33.2° 相机的 billboard，俯视下不可用；改由
    // drawWorldLaneEdges 在轨道面里画平的彩虹边线 + LineMove 条带，这里只关掉 3D 那套。
    if (this.cameraMode === '2d') {
      this.feverLayers?.update(false, 0);
      return;
    }
    // 3D：LineBase 彩虹 + LineMove 条带 + 入场遮罩全部由 FeverLayers 按原包贴图/遮罩绘制。
    // 素材缺失（feverLayers 为 null）时宁可不画，也不再退化成「沿边线跑的亮条」——
    // 那是入场彗星 LineCoreMove 的语义，不是 LineMove。
    this.feverLayers?.update(this.feverOn, time - this.feverStart);
  }

  setHitEffectMode(mode: 'off' | 'current' | 'limited' | 'full') {
    this.hitEffectMode = mode;
    this.fx?.setMode(mode);
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    for (const b of [this.track, this.worldLaneEdges, this.holds, this.lines, this.oldNotes]) b.dispose();
    this.ribbon?.dispose();
    for (const batch of this.sheets.values()) batch.dispose();
    this.fx?.dispose();
    this.feverLayers?.dispose();
    this.white.dispose();
    this.gl.dispose();
  }
}
