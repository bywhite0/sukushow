import { describe, expect, it } from 'vitest';
import {
  feverLineRgba,
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

describe('fever LineBase color', () => {
  it('returns rgba in range', () => {
    const c = feverLineRgba(16.4, 16);
    expect(c).toHaveLength(4);
    for (const v of c) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.001);
    }
  });
});
