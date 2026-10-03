import { expect, it } from 'vitest';
import { FEVER_MASK_ANCHOR, FEVER_EDGE_ROTATION, feverMaskGeometry, rotateByQuaternion } from '../src/feverMask';

it('遮罩起点高度为零，结束后保持原始网格尺寸', () => {
  const start = feverMaskGeometry('left', 0);
  expect(start.scale).toEqual([1, 0, 1]);
  const end = feverMaskGeometry('left', 1);
  expect(end.scale).toEqual([40, 68, 1]);
  expect(end.positions).toHaveLength(24);
  expect(end.indices).toHaveLength(18);
  expect(feverMaskGeometry('left', 10)).toEqual(end);
});

it('遮罩使用 Sprite 居中网格，网格中心由底部 pivot 抬升半个高度', () => {
  const mask = feverMaskGeometry('left', 1);
  const xs = mask.positions.filter((_, i) => i % 3 === 0);
  const ys = mask.positions.filter((_, i) => i % 3 === 1);
  expect(Math.min(...xs)).toBeCloseTo(-0.53);
  expect(Math.max(...xs)).toBeCloseTo(0.53);
  expect(Math.min(...ys)).toBeCloseTo(-0.395);
  expect(Math.max(...ys)).toBeCloseTo(0.395);
  // RectTransform pivot (0.5,0) + anchoredPosition (∓18,−9)：中心沿帧 +Y 抬 0.395×68。
  const up = rotateByQuaternion(FEVER_EDGE_ROTATION.left, [0, 1, 0]);
  const grow = 0.395 * 68;
  for (const i of [0, 1, 2]) {
    expect(mask.position[i]).toBeCloseTo(FEVER_MASK_ANCHOR.left[i] + up[i] * grow, 6);
  }
});

it('左右遮罩保留独立旋转和入场宽度', () => {
  const left = feverMaskGeometry('left', 0);
  const right = feverMaskGeometry('right', 0);
  expect(left.scale[0]).toBe(1);
  expect(right.scale[0]).toBe(4);
  expect(left.rotation[2]).toBeLessThan(0);
  expect(right.rotation[2]).toBeGreaterThan(0);
});

it('帧 +Y 即边线揭示方向：两端投影的横向偏移一致且指向远端', () => {
  // 帧的 +Y 与 OutLine 共线，故沿 +Y 抬升只会改变沿线位置，不改变垂距。
  const up = rotateByQuaternion(FEVER_EDGE_ROTATION.left, [0, 1, 0]);
  expect(Math.hypot(up[0], up[1], up[2])).toBeCloseTo(1, 6);
  // 左帧 +Y 朝 +X/+Z（世界远端），右帧镜像。
  expect(up[0]).toBeGreaterThan(0);
  expect(up[2]).toBeGreaterThan(0);
  const upR = rotateByQuaternion(FEVER_EDGE_ROTATION.right, [0, 1, 0]);
  expect(upR[0]).toBeCloseTo(-up[0], 6);
  expect(upR[1]).toBeCloseTo(up[1], 6);
  expect(upR[2]).toBeCloseTo(up[2], 6);
});
