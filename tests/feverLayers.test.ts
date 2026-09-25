import * as THREE from 'three';
import { expect, it } from 'vitest';
import { FeverLayers } from '../src/feverLayers';
import { FEVER_EDGE_ROTATION, FEVER_MASK_ANCHOR, mirrorRotationToThree } from '../src/feverMask';
import { PITCH } from '../src/slice';

/** 复刻渲染器相机与 UI 画布映射，用于把边线几何投影到屏幕像素。 */
function screenSpace(width = 1232, height = 670) {
  const camera = new THREE.PerspectiveCamera(60, width / height, .3, 1000);
  camera.position.set(0, 9, 8.65);
  camera.rotation.x = -PITCH;
  camera.updateMatrixWorld(true);
  const scale = Math.min(width / 1920, height / 1080);
  const uiToScreen = (x: number, y: number) => [width / 2 + x * scale, height / 2 - y * scale] as [number, number];
  const project = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    return [width / 2 + p.x * width / 2, height / 2 - p.y * height / 2] as [number, number];
  };
  const outline = (side: 'left' | 'right') => {
    const rot = side === 'left' ? 2 * Math.atan2(-0.341118, 0.940021) : 2 * Math.atan2(0.341118, 0.940021);
    const cx = side === 'left' ? -512.6168 : 512.6168;
    const cy = side === 'left' ? -3.30142 : -3.30227;
    const half = 1416 / 2;
    return {
      a: uiToScreen(cx - Math.sin(rot) * half, cy + Math.cos(rot) * half),
      b: uiToScreen(cx + Math.sin(rot) * half, cy - Math.cos(rot) * half),
    };
  };
  /** 点到 OutLine 直线的垂距与沿线参数 t（0=远端、1=近端/判定线）。 */
  const relative = (p: [number, number], side: 'left' | 'right') => {
    const { a, b } = outline(side);
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy);
    return { t, d: Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy)) };
  };
  return { project, relative };
}

it('LineBase 条带沿 OutLine 铺设，长轴角度与边线一致', () => {
  const texture = new THREE.Texture();
  const layers = new FeverLayers(texture, texture, texture);
  try {
    layers.update(true, 0.7);
    layers.group.updateMatrixWorld(true);
    const { project, relative } = screenSpace();
    for (const name of ['base-left', 'base-right']) {
      const mesh = layers.group.getObjectByName(name) as THREE.Mesh;
      expect(mesh).toBeTruthy();
      const side = name.endsWith('right') ? 'right' : 'left';
      const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      const half = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).multiplyScalar(mesh.scale.y / 2);
      const head = project(center.clone().sub(half)), tail = project(center.clone().add(half));
      // 长轴与画布边线同为 39.890°（OutLine 的 RectTransform rotZ）。
      const angle = Math.atan2(Math.abs(tail[0] - head[0]), Math.abs(tail[1] - head[1])) * 180 / Math.PI;
      expect(angle).toBeCloseTo(39.89, 1);
      // 两端到边线的垂距都在个位像素内：条带压在边线上，而不是飘在轨道内或屏幕外。
      // 3D 边与画布 OutLine 是两条近似重合的直线（轨道平面实测偏差 ≤3.4px），故留 5px 余量。
      expect(relative(head, side).d).toBeLessThan(5);
      expect(relative(tail, side).d).toBeLessThan(5);
      // 判定线在 t≈1；条带中心应落在边线区间内（覆盖判定线附近）。
      const c = relative(project(center), side);
      expect(c.t).toBeGreaterThan(-0.2);
      expect(c.t).toBeLessThan(1.1);
    }
  } finally { layers.dispose(); texture.dispose(); }
});

it('LineMove 条带朝向与 LineBase 同帧（都取自 LineMask），但位置不在边线上', () => {
  const texture = new THREE.Texture();
  const layers = new FeverLayers(texture, texture, texture);
  try {
    layers.update(true, 0.2);
    layers.group.updateMatrixWorld(true);
    const base = layers.group.getObjectByName('base-left') as THREE.Mesh;
    const move = layers.group.getObjectByName('move-left') as THREE.Mesh;
    // 同帧 ⇒ 四元数逐位相同（朝向一致，揭示边缘不会与条带错轴）。
    expect(move.quaternion.toArray()).toEqual(base.quaternion.toArray());
    // 但位置不同：LineMove 在轨道顶部中央、可见区之上（越过边线远端），不在边线可见段上。
    const { project, relative } = screenSpace();
    const moveCenter = project(new THREE.Vector3().setFromMatrixPosition(move.matrixWorld));
    expect(moveCenter[1]).toBeLessThan(0);              // 在画面上方
    expect(relative(moveCenter, 'left').t).toBeLessThan(0);  // 越过边线远端
  } finally { layers.dispose(); texture.dispose(); }
});

it('遮罩揭示轴与边线共线，起点贴在彗星起点', () => {
  const { project, relative } = screenSpace();
  for (const side of ['left', 'right'] as const) {
    const q = new THREE.Quaternion().fromArray(mirrorRotationToThree(FEVER_EDGE_ROTATION[side]));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const anchor = FEVER_MASK_ANCHOR[side];
    const pivot = new THREE.Vector3(anchor[0], anchor[1], -anchor[2]);
    const start = relative(project(pivot), side);
    // 原始 anchoredPosition (∓18,−9) 即彗星起点，落在边线近端之外（t>1 表示越过判定线）。
    expect(start.d).toBeLessThan(5);
    expect(start.t).toBeGreaterThan(0.9);
    // 揭示方向（帧 +Y）指向远端：t 单调下降，且全程贴线。
    const far = relative(project(pivot.clone().addScaledVector(up, 26.86)), side);
    expect(far.t).toBeLessThan(start.t);
    // 3D 边与画布 OutLine 本身存在 ≤3.4px 系统偏差，故与条带测试同留 5px 余量。
    expect(far.d).toBeLessThan(5);
  }
});

it('世界空间边线受动画遮罩控制，关闭后所有层隐藏', () => {
  const texture = new THREE.Texture();
  const layers = new FeverLayers(texture, texture, texture);
  try {
    layers.update(true, 0);
    expect(layers.group.visible).toBe(true);
    const masks = layers.group.children.filter(c => c.name.startsWith('mask')) as THREE.Mesh[];
    expect(masks).toHaveLength(2);
    expect(masks.every(m => m.scale.y === 0)).toBe(true);
    const base = layers.group.getObjectByName('base-left') as THREE.Mesh;
    expect(base.getWorldPosition(new THREE.Vector3()).toArray()).toEqual([-5.03000020980835, 3.924999952316284, 0]);
    layers.update(true, 0.4);
    const move = layers.group.getObjectByName('move-left') as THREE.Mesh;
    // LineMove 原包位置运动：发射点在轨道顶部中央，带 ∓X 漂移与 +Z 射出；长度随寿命生长。
    const age = 0.4;
    expect(move.position.x).toBeCloseTo(0.024000000208616257 - 0.3499999940395355 * age, 6);
    expect(move.position.z).toBeCloseTo(-(1.2999999523162842 * age), 6);
    expect(move.scale.y).toBe(120);
    const material = move.material as THREE.Material;
    expect(material.stencilWrite).toBe(true);
    expect(material.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    expect(material.stencilWriteMask).toBe(0);
    layers.update(false, 0.4);
    expect(layers.group.visible).toBe(false);
    layers.update(true, 0);
    expect(masks.every(m => m.scale.y === 0)).toBe(true);
  } finally { layers.dispose(); texture.dispose(); }
});
