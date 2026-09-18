import { describe, expect, it } from 'vitest';
import {
  feverLineRgba,
  feverMoveLocalY,
  feverMovePhase,
  feverMoveRgba,
  feverWindowFallback,
  feverWindowFromSections,
  isFeverAt,
  resolveFeverWindow,
} from '../src/fever';
import { demoChart } from '../src/demo';

describe('fever window', () => {
  it('uses FeverSectionNo against section times', () => {
    const sections = [8, 16, 24, 32];
    // N=3 → start=sections[1]=16, end=sections[2]=24
    expect(feverWindowFromSections(sections, 3)).toEqual({ start: 16, end: 24 });
    expect(feverWindowFromSections(sections, 1)).toEqual({ start: 0, end: 8 });
    expect(feverWindowFromSections([], 3)).toBeNull();
  });

  it('N>=5 uses tableEnd (+0x34 / FinishTime) instead of sections[N-1]', () => {
    const sections = [10, 20, 30, 40, 50];
    // N=5 → start=sections[3]=40, N-1>=4 → end = tableEnd
    expect(feverWindowFromSections(sections, 5, 108.235)).toEqual({ start: 40, end: 108.235 });
    // without tableEnd falls back to sections[4]
    expect(feverWindowFromSections(sections, 5)).toEqual({ start: 40, end: 50 });
    // N=4 still uses sections[3]
    expect(feverWindowFromSections(sections, 4, 999)).toEqual({ start: 30, end: 40 });
  });

  it('resolveFeverWindow passes duration as +0x34 stand-in for N>=5', () => {
    const sections = [10, 20, 30, 40, 50];
    const w = resolveFeverWindow(sections, 5, 120);
    expect(w).toEqual({ start: 40, end: 120 });
  });

  it('falls back mid-song when no sections', () => {
    const w = feverWindowFallback(100);
    expect(w.start).toBeCloseTo(45);
    expect(w.end).toBeCloseTo(70);
  });

  it('demo chart sections resolve for default N=3', () => {
    const c = demoChart();
    expect(c.sections).toEqual([8, 16, 24, 32]);
    const w = resolveFeverWindow(c.sections, 3, c.duration);
    expect(isFeverAt(20, w)).toBe(true);
    expect(isFeverAt(10, w)).toBe(false);
    expect(isFeverAt(24, w)).toBe(false);
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
    expect(feverMovePhase(16.8, 16)).toBeCloseTo(1); // far end of first leg
    expect(feverMovePhase(17.6, 16)).toBeCloseTo(0); // back after full 往复
    expect(feverMovePhase(17.2, 16)).toBeCloseTo(0.5);
    expect(feverMoveLocalY(0)).toBeCloseTo(-703);
    expect(feverMoveLocalY(1)).toBeCloseTo(694);
    const mid = feverMoveRgba(16.4, 16);
    expect(mid[3]).toBeGreaterThan(0.9);
  });
});
