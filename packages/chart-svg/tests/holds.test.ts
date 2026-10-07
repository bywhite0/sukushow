/** 判定航点重采样、串链与零长 hold 段——按原包 float32 口径的单测。 */

import { describe, expect, it } from 'vitest';
import { chartMaxCombo, getHolds, parseChart } from '../src/chart';
import { chainQuads, defaultLayout, noteSpan } from '../src/layout';

const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const lay = () => ({ ...defaultLayout(), duration: 10 });

describe('getHolds（RhythmGameConsts.GetHolds @0x485D11C，float32）', () => {
  it('尾裁剪按 (long)(|end − last| × 10000f) <= 1 截断，即 |Δ| < 2e-4', () => {
    // 103108 MASTER uid 556 链：49.70587 → 50.29421 @ 102 BPM（主数据 MaxCombo 947）。
    const h = getHolds(49.70587, 50.29421, [{ time: 0, bpm: 102 }]);
    expect(h).toHaveLength(2);
    expect(h[1]).toBe(Math.fround(50.29421));
  });

  it('跨 BPM 急变段按 float32 累加半拍（double 累加会分岔）', () => {
    // 405138 MASTER uid 1006 链：84 → 85.89473，途经 38→190→380→760→1140 BPM（主数据 MaxCombo 1142）。
    const bpms = [
      { time: 0, bpm: 190 }, { time: 84, bpm: 38 }, { time: 84.63158416748047, bpm: 190 },
      { time: 84.94737243652344, bpm: 380 }, { time: 85.2631607055664, bpm: 760 },
      { time: 85.57894897460938, bpm: 1140 }, { time: 85.89473724365234, bpm: 190 },
    ];
    const h = getHolds(84, 85.89473, bpms);
    expect(h).toHaveLength(26);
    expect(h.every(x => Math.fround(x) === x)).toBe(true);
  });

  it('末样点离终点 1.5e-4 被收尾截断裁掉，2.5e-4 保留', () => {
    // 60 BPM 半拍 0.5：采样 0.5 与终点 0.50015 相差 1.5e-4 —— 循环内不命中 LooseEquals（< 9.9999997e-5f），
    // 先 Add 再由收尾的截断裁剪（(long)1.5 = 1 <= 1）删掉，只剩 [end]。
    expect(getHolds(0, 0.50015, [{ time: 0, bpm: 60 }])).toEqual([Math.fround(0.50015)]);
    // 差 2.5e-4 时两道闸都不命中，采样点保留。
    expect(getHolds(0, 0.50025, [{ time: 0, bpm: 60 }])).toHaveLength(2);
  });

  it('零长 / 倒序区间只返回 [end]', () => {
    expect(getHolds(3, 3, [{ time: 0, bpm: 120 }])).toEqual([3]);
  });

  it('Get(bpms, t) 早于首段时回落到最后一段', () => {
    const bpms = [{ time: 1, bpm: 60 }, { time: 10, bpm: 240 }];
    expect(getHolds(0, 0.5, bpms)).toEqual([0.125, 0.25, 0.375, 0.5]);
  });
});

describe('串链（IsCombine @0x485CFFC，单精度 LooseEquals）', () => {
  it('float32 域 |Δ| < 9.9999997e-5f 才连：101.8751 → 101.875 连上，1.0001 → 1.0 不连', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '101', holds: ['101.8751'], Flags: flags(1, 0, 9) },
        { Uid: 2, just: '101.875', holds: ['102'], Flags: flags(1, 0, 9) },
        { Uid: 3, just: '0', holds: ['1.0001'], Flags: flags(1, 20, 29) },
        { Uid: 4, just: '1', holds: ['2'], Flags: flags(1, 20, 29) },
      ],
      Bpms: [{ Time: 0, Bpm: 120 }],
    });
    const [a, b, x, y] = c.notes;
    expect(a.next).toBe(b);
    expect(x.next).toBeUndefined();
    expect(y.prev).toBeUndefined();
  });
});

// 405131 EXPERT #117/#118/#120 同型：斜段 → 零长瞬移段 → 斜段；另有一条同刻起始、lane 不接的 hold。
const zeroChain = () => parseChart({
  Notes: [
    { Uid: 1, just: '0', holds: ['1'], Flags: flags(1, 0, 14, 15, 29) },
    { Uid: 2, just: '1', holds: ['1'], Flags: flags(1, 15, 29, 45, 59) }, // 零长
    { Uid: 3, just: '1', holds: ['1.5'], Flags: flags(1, 0, 14, 0, 14) },
    { Uid: 4, just: '1', holds: ['2'], Flags: flags(1, 45, 59, 30, 44) },
  ],
  Bpms: [{ Time: 0, Bpm: 120 }],
});

describe('零长 hold 段', () => {
  it('照原版不看段长，串在链里；最大连击 = 链头 1 + GetHolds(0, 2) 8 点 + 另一条 2', () => {
    const c = zeroChain();
    const [a, z, other, b] = c.notes;
    expect(a.next).toBe(z);
    expect(z.next).toBe(b);
    expect(other.prev).toBeUndefined();
    expect(c.roots.map(n => n.uid)).toEqual([1, 3]);
    expect(c.maxCombo).toBe(1 + 8 + 2);
    expect(chartMaxCombo(c)).toBe(c.maxCombo);
  });

  it('出图：前一段停在它自己的尾端 lane，下一段从瞬移后的 lane 起画，零长段不出面', () => {
    const c = zeroChain();
    const [a, , , b] = c.notes;
    const l = lay();
    const q = chainQuads(c.roots[0], l);
    expect(q).toHaveLength(2);
    const [tl, tr] = noteSpan(a, l, true);
    expect(q[0].p[3][0]).toBeCloseTo(tl, 6);
    expect(q[0].p[2][0]).toBeCloseTo(tr, 6);
    const [hl, hr] = noteSpan(b, l, false);
    expect(q[1].p[0][0]).toBeCloseTo(hl, 6);
    expect(q[1].p[1][0]).toBeCloseTo(hr, 6);
    // 瞬移前后两排同一时刻、横向不同：前一段没有被拉向 45-59。
    expect(q[0].p[3][1]).toBeCloseTo(q[1].p[0][1], 6);
    expect(Math.abs(q[1].p[0][0] - q[0].p[3][0])).toBeGreaterThan(l.lanePx);
  });
});