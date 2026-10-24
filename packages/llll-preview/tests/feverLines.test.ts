import { expect, it } from 'vitest';
import { FEVER_EDGE_LENGTH, feverLineParticle } from '../src/feverLines';

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
  // 同一寿命相位也驱动颜色：周期起点透明、中段接近不透明（跳转回到同一相位即复现）。
  expect(feverLineParticle('move', 'left', 0).color[3]).toBe(0);
  expect(feverLineParticle('move', 'left', 0.4).color[3]).toBeGreaterThan(0.99);
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
