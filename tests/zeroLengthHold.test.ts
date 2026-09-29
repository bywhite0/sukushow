import { describe, expect, it } from 'vitest';
import { chartAllNoteSize, parseChart } from '../src/chart';
import { createSlope, holdSegment } from '../src/geometry';

const flags = (t: number, l: number, r: number, l2 = 0, r2 = 0) =>
  t + r * 16 + r2 * 1024 + l * 65536 + l2 * 4194304;

// 405131 EXPERT #117/#118/#120 同型：斜段 → 零长瞬移段（holds[^1] == Just）→ 斜段。
const chain = () =>
  parseChart({
    Notes: [
      { Uid: 1, just: '0', Flags: flags(1, 0, 14, 15, 29), holds: ['1'] },
      { Uid: 2, just: '1', Flags: flags(1, 15, 29, 45, 59), holds: ['1'] }, // 零长
      // 同刻起始、lane 不接的另一条 hold：不能被串进来
      { Uid: 3, just: '1', Flags: flags(1, 0, 14, 0, 14), holds: ['1.5'] },
      { Uid: 4, just: '1', Flags: flags(1, 45, 59, 30, 44), holds: ['2'] },
    ],
    Bpms: [{ Time: 0, Bpm: 120 }],
  });

describe('零长 hold 段', () => {
  it('按 IsCombine（uid 递增 + L2/R2→L1/R1 + LooseEquals(holds[^1], Just)）串接，不串到同刻别的 hold', () => {
    const c = chain();
    const [a, z, other, b] = c.notes;
    expect(a.next).toBe(z);
    expect(z.prev).toBe(a);
    expect(z.next).toBe(b);
    expect(b.prev).toBe(z);
    expect(other.prev).toBeUndefined();
    expect(other.next).toBeUndefined();
    expect(c.roots.map((n) => n.uid)).toEqual([1, 3]);
    // AllNoteSize：链头 1 + GetHolds(0, 2) 半拍 8 点；另一条单段 1 + 1。
    expect(chartAllNoteSize(c)).toBe(1 + 8 + 2);
  });

  it('零长段照样发射（零纵深），第 1 段尾排缝到它的头排 = 第 1 段自己的尾端 lane', () => {
    const c = chain();
    const [a, z, , b] = c.notes;
    const s = createSlope(5);
    const now = 0.5;
    const va = holdSegment(a, now, s, false);
    const vz = holdSegment(z, now, s, false);
    const vb = holdSegment(b, now, s, false);
    expect(va).toHaveLength(18);
    expect(vz).toHaveLength(18);
    expect(vz.every(Number.isFinite)).toBe(true);
    // 头排 z == 尾排 z（HoldLength 0）
    expect(vz[2]).toBeCloseTo(vz[5]);
    // 头排（pHead = Clamp01(−x/0) = 0）取零长段 L1/R1 = 第 1 段 L2/R2；第 1 段已完全出生时其尾排 pTail = 1。
    const tailOfA = [va[3], va[9], va[15]];
    const headOfZ = [vz[0], vz[6], vz[12]];
    headOfZ.forEach((x, i) => expect(x).toBeCloseTo(tailOfA[i]!));
    // 瞬移之后那段的头排在 45-59 一侧，与第 1 段尾端不同：若跳过零长段，缝合会把第 1 段拉过去。
    expect(Math.abs(vb[0] - tailOfA[0]!)).toBeGreaterThan(1);
  });

  it('恰在零长段时刻（0/0）不产生 NaN', () => {
    const c = chain();
    const v = holdSegment(c.notes[1], 1, createSlope(5), false);
    expect(v.every(Number.isFinite)).toBe(true);
  });
});