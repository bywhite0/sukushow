import { feverTrailWidthFactor } from '../src/fever';
import { describe, expect, it } from 'vitest';
import { feverLineRgba, feverMoveLocalY, feverMovePhase, feverMoveRgba, isFeverAt } from '../src/fever';

it.each([
  [0, 0.6408690810203552], [1, 0.07189155369997025],
  [0xffffffff, 0.249790221452713], [0x80000000, 0.6413573622703552],
  [0x12345678, 0.12887372076511383],
])('原生拖尾 seed %s 的宽度因子', (seed, expected) => {
  expect(feverTrailWidthFactor(seed)).toBe(expected);
  expect(feverTrailWidthFactor(seed)).toBe(expected);
});

describe('显式 Fever 时段', () => {
  it('没有时段时始终关闭，不估算', () => {
    for (const time of [0, 16, 45, 70, 100]) expect(isFeverAt(time, null)).toBe(false);
  });
  it('包含起点，不包含终点', () => {
    const win = { start: 16, end: 24 };
    expect(isFeverAt(15.999, win)).toBe(false);
    expect(isFeverAt(16, win)).toBe(true);
    expect(isFeverAt(23.999, win)).toBe(true);
    expect(isFeverAt(24, win)).toBe(false);
  });
});

describe('原始 level56 Fever 渐变', () => {
  const colors = [
    [0, 1, 0.019788190722465515, 0],
    [0.2, 1, 0, 0.8173365592956543],
    [0.4, 0, 0.8462276458740234, 1],
    [0.6, 0.053014516830444336, 1, 0],
    [0.8, 1, 0.950401782989502, 0],
  ];
  for (const [name, sample, cycle] of [
    ['LineBase', feverLineRgba, 1.6],
    ['LineMove', feverMoveRgba, 0.8],
  ] as const) {
    it.each(colors)(`${name} 在相位 %s 使用原始 RGB 色键`, (phase, ...rgb) => {
      sample(16 + phase * cycle, 16).slice(0, 3).forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 6));
    });
    it(`${name} 在 RGB 空间插值，不插值屏幕 hue`, () => {
      const rgba = sample(16 + cycle * 0.1, 16);
      expect(rgba[0]).toBeCloseTo(1, 6);
      expect(rgba[1]).toBeCloseTo(0.009894095361232758, 6);
      expect(rgba[2]).toBeCloseTo(0.40866827964782715, 6);
    });
    it(`${name} 循环边界透明，跳转保持相位`, () => {
      expect(sample(16, 16)[3]).toBe(0);
      expect(sample(16 + cycle - 1e-7, 16)[3]).toBeLessThan(1e-5);
      sample(16 + cycle * 10.25, 16).forEach((v, i) => expect(v).toBeCloseTo(sample(16 + cycle * 0.25, 16)[i], 6));
    });
  }
  it.each([[0, 0], [6554, 0.7058823704719543], [33731, 1], [58982, 0.7058823704719543]])('LineBase alpha 键 %s', (key, alpha) => {
    expect(feverLineRgba(16 + 1.6 * key / 65535, 16)[3]).toBeCloseTo(alpha, 6);
  });
  it.each([[0, 0], [13107, 0.47058823704719543], [32768, 1], [52428, 0.47058823704719543]])('LineMove alpha 键 %s', (key, alpha) => {
    expect(feverMoveRgba(16 + 0.8 * key / 65535, 16)[3]).toBeCloseTo(alpha, 6);
  });
});

describe('fever LineBase / LineMove color', () => {
  it('returns rgba in range', () => {
    const c = feverLineRgba(16.4, 16);
    expect(c).toHaveLength(4);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });
  it('LineMove ping-pongs and peaks alpha mid-cycle', () => {
    expect(feverMovePhase(16.0, 16)).toBeCloseTo(0);
    expect(feverMovePhase(16.4, 16)).toBeCloseTo(0.5);
    expect(feverMovePhase(16.8, 16)).toBeCloseTo(1);
    expect(feverMovePhase(17.6, 16)).toBeCloseTo(0);
    expect(feverMovePhase(17.2, 16)).toBeCloseTo(0.5);
    expect(feverMoveLocalY(0)).toBeCloseTo(-703);
    expect(feverMoveLocalY(1)).toBeCloseTo(694);
    expect(feverMoveRgba(16.4, 16)[3]).toBeGreaterThan(0.9);
  });
});
