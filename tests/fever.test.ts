import { describe, expect, it } from 'vitest';
import { feverLineRgba, feverMoveLocalY, feverMovePhase, feverMoveRgba, isFeverAt } from '../src/fever';

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
