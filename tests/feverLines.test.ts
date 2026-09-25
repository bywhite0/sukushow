import { expect, it } from 'vitest';
import * as THREE from 'three';
import { FEVER_EDGE_LENGTH, feverLineParticle } from '../src/feverLines';
import { FeverLayers } from '../src/feverLayers';
import { PITCH } from '../src/slice';

/** 复刻渲染器相机与 UI 画布映射（与 feverLayers.test.ts 同口径）。 */
function screenSpace(width = 1232, height = 670) {
  const camera = new THREE.PerspectiveCamera(60, width / height, .3, 1000);
  camera.position.set(0, 9, 8.65);
  camera.rotation.x = -PITCH;
  camera.updateMatrixWorld(true);
  const project = (v: THREE.Vector3) => {
    const p = v.clone().project(camera);
    return [width / 2 + p.x * width / 2, height / 2 - p.y * height / 2] as [number, number];
  };
  return { project };
}

const MOVE_PERIOD = 0.800000011920929;
const BASE_PERIOD = 1.600000023841858;

it('LineMove 用原包位置运动：发射点在轨道顶部中央，沿 +Z 射出并带 ∓X 漂移', () => {
  const a = feverLineParticle('move', 'left', 0);
  // 发射点 = level56 #604 ShapeModule.m_Position。
  expect(a.position[0]).toBeCloseTo(0.024000000208616257, 6);
  expect(a.position[1]).toBeCloseTo(9.020999908447266, 6);
  expect(a.position[2]).toBeCloseTo(0, 6);
  expect(a.count).toBe(1);
  // 合速度 = 锥轴 +Z × startSpeed 1.3 + 世界空间 VelocityModule.x。
  const t = 0.4;
  const b = feverLineParticle('move', 'left', t);
  expect(b.position[0]).toBeCloseTo(0.024000000208616257 - 0.3499999940395355 * t, 6);
  expect(b.position[1]).toBeCloseTo(9.020999908447266, 6);
  expect(b.position[2]).toBeCloseTo(1.2999999523162842 * t, 6);
  // 右侧镜像：X 漂移取反，Y/Z 相同。
  const r = feverLineParticle('move', 'right', t);
  expect(r.position[0]).toBeCloseTo(0.024000000208616257 + 0.3499999940395355 * t, 6);
  expect(r.position[1]).toBeCloseTo(b.position[1], 6);
  expect(r.position[2]).toBeCloseTo(b.position[2], 6);
});

it('LineMove 每个寿命周期从发射点重生，尺寸恒定不随寿命变化', () => {
  const a = feverLineParticle('move', 'left', 0.1);
  const b = feverLineParticle('move', 'left', 0.1 + MOVE_PERIOD);
  a.position.forEach((v, i) => expect(b.position[i]).toBeCloseTo(v, 5));
  // SizeModule.curve = [(0,1),(1,1)]（separateAxes=false 下唯一生效的字段）⇒ 尺寸恒定。
  // y=[(0,0),(1,1)] 是未被求值的样板，不能当统一尺寸乘数用。
  for (const age of [0, 0.2, 0.4, 0.6, 0.79]) {
    expect(feverLineParticle('move', 'left', age).size[1]).toBe(120);
  }
  // 条带远超可见范围（原始 size.y=120），故两端会扫出画面外。
  expect(feverLineParticle('move', 'left', 0.79).size[1]).toBeGreaterThan(FEVER_EDGE_LENGTH);
});

it('LineMove 不再沿边线推进：位置与边线参数轴无关', () => {
  // 回归锁：曾经把它当作「沿边线跑的行进高光」，方向改过两轮都不对。
  // 原包发射点在轨道顶部中央，X 只有 ∓0.28 的漂移，不落在边线上。
  for (const age of [0, 0.2, 0.4, 0.6, 0.79]) {
    const p = feverLineParticle('move', 'left', age);
    expect(Math.abs(p.position[0])).toBeLessThan(0.5);   // 始终靠近轨道中央
    expect(p.position[1]).toBeCloseTo(9.020999908447266, 6);
  }
});

it('LineBase 固定在边线上不动，只有颜色随时间轮转，尺寸恒定', () => {
  const a = feverLineParticle('base', 'left', 0.4);
  expect(a.position).toEqual([-5.03000020980835, 3.924999952316284, 0]);
  expect(a.count).toBe(2);
  expect(a.size).toEqual([0.12999999523162842, 80]);
  // 位置不随时间变化（startSpeed=0、VelocityModule disabled）。
  expect(feverLineParticle('base', 'left', 1.1).position).toEqual(a.position);
  // 尺寸也不变（SizeModule.curve 恒定 1）。
  expect(feverLineParticle('base', 'left', 0).size[1]).toBe(80);
  expect(feverLineParticle('base', 'left', BASE_PERIOD - 1e-9).size[1]).toBe(80);
  // 变的是颜色：周期内色相轮转（1.6s 走完 6 色）。
  const c0 = feverLineParticle('base', 'left', 0).color;
  const c1 = feverLineParticle('base', 'left', BASE_PERIOD * 0.4).color;
  expect(c0.slice(0, 3)).not.toEqual(c1.slice(0, 3));
});

it('LineMove 投影后位于可见区之上（轨道顶部中央），两端向画面外扩散', () => {
  const { project } = screenSpace();
  const texture = new THREE.Texture();
  const layers = new FeverLayers(texture, texture, texture);
  try {
    layers.update(true, 0.05);
    layers.group.updateMatrixWorld(true);
    const mesh = layers.group.getObjectByName('move-left') as THREE.Mesh;
    const center = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const sp = project(center);
    // 发射点投影在画面之上（y 为负），水平居中。
    expect(sp[1]).toBeLessThan(0);
    expect(Math.abs(sp[0] - 616)).toBeLessThan(40);
  } finally { layers.dispose(); texture.dispose(); }
});

it('长轴朝向不来自 startRotation，交由遮罩帧统一决定', () => {
  // 两层均为 m_RenderAlignment=1（View）的相机朝向 billboard；条带朝向必须与
  // LineMask 同帧，否则揭示边缘会与亮条错轴。这里锁住「粒子状态不再自带 rotation」。
  for (const kind of ['base', 'move'] as const) {
    for (const side of ['left', 'right'] as const) {
      expect(feverLineParticle(kind, side, 0.4)).not.toHaveProperty('rotation');
    }
  }
});

it('边线寿命颜色使用 float32 周期，起点透明且跳转可重复', () => {
  expect(feverLineParticle('move', 'left', 0).color[3]).toBe(0);
  expect(feverLineParticle('move', 'left', 0.4).color[3]).toBeGreaterThan(0.99);
});
