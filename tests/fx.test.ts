import { describe, expect, it } from 'vitest';
import { pushBillboard } from '../src/slice';

describe('fx billboard spin', () => {
  it('rotates corners in the billboard plane', () => {
    const pos = new Float32Array(18);
    const uv = new Float32Array(12);
    const col = new Float32Array(24);
    const n = pushBillboard(pos, uv, col, 0, 6, 0, 0, 0, 2, 2, [1, 1, 1, 1], 1, 1, Math.PI / 2);
    expect(n).toBe(6);
    // 90° spin: former right edge maps toward billboard "up" (no pure +X extent).
    const xs = [pos[0], pos[3], pos[6], pos[9]];
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(1.01);
  });
});
