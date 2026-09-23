import { expect, it } from 'vitest';
import { feverLineParticle } from '../src/feverLines';

it('LineMove 按原始世界速度单向运动，每个寿命周期重新出生', () => {
  const a = feverLineParticle('move', 'left', 0.4);
  expect(a.position[0]).toBeCloseTo(-0.11599999740719795, 6);
  expect(a.position[1]).toBeCloseTo(9.020999908447266, 6);
  expect(a.position[2]).toBeCloseTo(0.5199999809265137, 6);
  const b = feverLineParticle('move', 'right', 0.4);
  expect(b.position[0]).toBeCloseTo(0.16399999782443048, 6);
  expect(feverLineParticle('move', 'left', 0.800000011920929).position).toEqual(feverLineParticle('move', 'left', 0).position);
});

it('LineBase 不消费未启用的残留速度，保留原始尺寸和双粒子数', () => {
  const a = feverLineParticle('base', 'left', 0.4);
  expect(a.position).toEqual([-5.03000020980835, 3.924999952316284, 0]);
  expect(a.size).toEqual([0.12999999523162842, 80]);
  expect(a.count).toBe(2);
  expect(feverLineParticle('base', 'left', 1).position).toEqual(a.position);
});

it('边线寿命颜色使用 float32 周期，起点透明且跳转可重复', () => {
  expect(feverLineParticle('move', 'left', 0).color[3]).toBe(0);
  expect(feverLineParticle('move', 'left', 0.4).color[3]).toBeGreaterThan(0.99);
  const a = feverLineParticle('move', 'left', 0.4);
  const b = feverLineParticle('move', 'left', 0.4 + 0.800000011920929 * 10);
  a.position.forEach((v, i) => expect(b.position[i]).toBeCloseTo(v, 6));
});
