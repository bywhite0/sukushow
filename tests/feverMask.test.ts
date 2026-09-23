import { expect, it } from 'vitest';
import { feverMaskGeometry } from '../src/feverMask';

it('遮罩起点高度为零，结束后保持原始网格尺寸', () => {
  const start = feverMaskGeometry('left', 0);
  expect(start.scale).toEqual([1, 0, 1]);
  const end = feverMaskGeometry('left', 1);
  expect(end.scale).toEqual([40, 68, 1]);
  expect(end.positions).toHaveLength(24);
  expect(end.indices).toHaveLength(18);
  expect(feverMaskGeometry('left', 10)).toEqual(end);
});

it('遮罩使用 Sprite 居中网格，而不是 RectTransform 的底部 pivot', () => {
  const mask = feverMaskGeometry('left', 1);
  const xs = mask.positions.filter((_, i) => i % 3 === 0);
  const ys = mask.positions.filter((_, i) => i % 3 === 1);
  expect(Math.min(...xs)).toBeCloseTo(-0.53);
  expect(Math.max(...xs)).toBeCloseTo(0.53);
  expect(Math.min(...ys)).toBeCloseTo(-0.395);
  expect(Math.max(...ys)).toBeCloseTo(0.395);
  expect(mask.position).toEqual([0, 0, 0]);
});

it('左右遮罩保留独立旋转和入场宽度', () => {
  const left = feverMaskGeometry('left', 0);
  const right = feverMaskGeometry('right', 0);
  expect(left.scale[0]).toBe(1);
  expect(right.scale[0]).toBe(4);
  expect(left.rotation[2]).toBeLessThan(0);
  expect(right.rotation[2]).toBeGreaterThan(0);
});
