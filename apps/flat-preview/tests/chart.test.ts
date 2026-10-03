import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { bpmAt, beatAt, decodeChart, parseChart, SIMULTANEOUS_WINDOW } from '../src/chart';

/** Flags 组装：l/r 为头端点轨道，l2/r2 为尾端点轨道（真实谱面恒有 l ≤ r、l2 ≤ r2）。 */
const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const chart = (notes: unknown[], bpms: unknown[] = [{ Time: 0, Bpm: 120 }], extra: Record<string, unknown> = {}) =>
  parseChart({ Notes: notes, Bpms: bpms, ...extra });

describe('Flags 位域', () => {
  it('解出四类音符与两端轨道', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '2.0', holds: ['2.5'], Flags: flags(1, 20, 24, 30, 34) },
      { Uid: 3, just: '3.0', holds: [], Flags: flags(2, 5, 8) },
      { Uid: 4, just: '4.0', holds: [], Flags: flags(3, 55, 58) },
    ]);
    expect(c.notes.map(n => n.type)).toEqual([0, 1, 2, 3]);
    expect(c.notes[1]).toMatchObject({ l: 20, r: 24, l2: 30, r2: 34, end: 2.5 });
    expect(c.notes[3]).toMatchObject({ l: 55, r: 58 });
  });

  it('l > r 被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 10, 9) }])).toThrow('轨道范围无效');
  });

  it('轨道号超过 59 被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 60, 62) }])).toThrow('轨道范围无效');
  });

  it('Hold 尾端点倒序被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '1', holds: ['2'], Flags: flags(1, 20, 30, 30, 20) }])).toThrow('轨道范围无效');
  });

  it('非整数 Uid 被拒绝', () => {
    expect(() => chart([{ Uid: 1.5, just: '1', holds: [], Flags: flags(0, 1, 2) }])).toThrow('越界');
  });

  it('重复 Uid 被拒绝', () => {
    expect(() => chart([
      { Uid: 7, just: '1', holds: [], Flags: flags(0, 1, 2) },
      { Uid: 7, just: '2', holds: [], Flags: flags(0, 3, 4) },
    ])).toThrow('重复 Uid');
  });

  it('非有限数被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: 'abc', holds: [], Flags: flags(0, 1, 2) }])).toThrow('必须是有限数');
  });
});

describe('Hold 端点校验', () => {
  it('holds 倒序被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '2.0', holds: ['1.0'], Flags: flags(1, 1, 2) }])).toThrow('不得倒序');
  });

  it('Hold 无 holds 被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(1, 1, 2) }])).toThrow('不得倒序');
  });

  it('end 取最后一个 holds', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['1.5', '2.0', '2.5'], Flags: flags(1, 1, 2) }]);
    expect(c.notes[0].end).toBe(2.5);
  });

  it('零时长 Hold 被允许', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['1.0'], Flags: flags(1, 1, 2) }]);
    expect(c.notes[0].end).toBe(1.0);
  });
});

describe('串链', () => {
  it('按 (l,r)→(l2,r2) 且 Uid 递增串链', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20, 12, 22) },
      { Uid: 2, just: '1.5', holds: ['2.0'], Flags: flags(1, 12, 22, 14, 24) },
    ]);
    expect(c.notes[0].next?.uid).toBe(2);
    expect(c.notes[1].prev?.uid).toBe(1);
    expect(c.roots).toHaveLength(1);
  });

  it('Uid 更小者不成为后继', () => {
    const c = chart([
      { Uid: 5, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20) },
      { Uid: 2, just: '1.5', holds: ['2.0'], Flags: flags(1, 10, 20) },
    ]);
    expect(c.notes[0].next).toBeUndefined();
    expect(c.roots).toHaveLength(2);
  });

  it('浮点容差按 float32 域判连', () => {
    // 101.8751 与 101.875 在 double 域 |Δ|=1.0000000033e-4 判不中，float32 域 |Δ|≈9.9182e-5 判中。
    const c = chart([
      { Uid: 1, just: '100.0', holds: ['101.8751'], Flags: flags(1, 10, 20) },
      { Uid: 2, just: '101.875', holds: ['102.5'], Flags: flags(1, 10, 20) },
    ]);
    expect(c.notes[0].next?.uid).toBe(2);
  });

  it('容差之外的时刻不串链', () => {
    const c = chart([
      { Uid: 1, just: '100.0', holds: ['101.0'], Flags: flags(1, 10, 20) },
      { Uid: 2, just: '101.5', holds: ['102.0'], Flags: flags(1, 10, 20) },
    ]);
    expect(c.notes[0].next).toBeUndefined();
  });

  it('链顺序 = 源数组顺序（折返几何依赖）', () => {
    // 同 tick 折返：两个节点终点同刻，渲染侧不得按 lane 二次排序。
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 20, 30, 40, 50) },
      { Uid: 2, just: '1.5', holds: ['2.0'], Flags: flags(1, 40, 50, 10, 15) },
    ]);
    const chain: number[] = [];
    let node = c.roots[0];
    while (node) { chain.push(node.uid); node = node.next!; }
    expect(chain).toEqual([1, 2]);
  });

  it('允许共享后继（汇合）', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20) },
      { Uid: 2, just: '1.0', holds: ['1.5'], Flags: flags(1, 12, 22) },
      { Uid: 3, just: '1.5', holds: ['2.0'], Flags: flags(1, 10, 20) },
    ]);
    expect(c.notes[2].prev).toBeDefined();
    expect(c.roots.map(n => n.uid)).toEqual([1, 2]);
  });
});

describe('同时押分组', () => {
  it('判定时刻差小于窗口者同组', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: String(1.0 + SIMULTANEOUS_WINDOW / 2), holds: [], Flags: flags(0, 20, 22) },
    ]);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].points).toHaveLength(2);
  });

  it('差超过窗口者不同组', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: String(1.0 + SIMULTANEOUS_WINDOW * 2), holds: [], Flags: flags(0, 20, 22) },
    ]);
    expect(c.lines).toHaveLength(0);
  });

  it('单点组不进 lines', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    expect(c.lines).toHaveLength(0);
  });

  it('Uid 0 的占位音符不进 lines', () => {
    const c = chart([
      { Uid: 0, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '1.0', holds: [], Flags: flags(0, 20, 22) },
    ]);
    expect(c.lines).toHaveLength(0);
  });
});

describe('BPM 与拍号', () => {
  it('bpmAt 取 ≤ t 的最后一段', () => {
    const c = chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }], [
      { Time: 0, Bpm: 120 }, { Time: 10, Bpm: 180 }, { Time: 20, Bpm: 90 },
    ]);
    expect(bpmAt(c.bpms, -1)).toBe(120);
    expect(bpmAt(c.bpms, 5)).toBe(120);
    expect(bpmAt(c.bpms, 10)).toBe(180);
    expect(bpmAt(c.bpms, 25)).toBe(90);
  });

  it('无 BPM 段时返回 120', () => {
    expect(bpmAt([], 3)).toBe(120);
  });

  it('beatAt 缺省为 4/4', () => {
    expect(beatAt([], 0)).toEqual({ numerator: 4, denominator: 4, time: 0 });
  });

  it('拍号段按时间取', () => {
    const c = chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }],
      [{ Time: 0, Bpm: 120 }],
      { Beats: [{ Numerator: 3, Denominator: 4, Time: 0 }, { Numerator: 6, Denominator: 8, Time: 10 }] });
    expect(beatAt(c.beats, 5).numerator).toBe(3);
    expect(beatAt(c.beats, 15).numerator).toBe(6);
  });

  it('BPM 非法被拒绝', () => {
    expect(() => chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }], [{ Time: 0, Bpm: 0 }])).toThrow('BPM 无效');
  });

  it('BPM 段按时间排序', () => {
    const c = chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }], [
      { Time: 10, Bpm: 180 }, { Time: 0, Bpm: 120 },
    ]);
    expect(c.bpms.map(b => b.time)).toEqual([0, 10]);
  });
});

describe('Offset 与时长', () => {
  it('Offset 缺省为 0，存在时读出', () => {
    expect(chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }]).offset).toBe(0);
    expect(chart([{ Uid: 1, just: '1', holds: [], Flags: flags(0, 1, 2) }], undefined, { Offset: -0.01 }).offset).toBeCloseTo(-0.01);
  });

  it('duration 覆盖最后一个音符终点并留余量', () => {
    const c = chart([{ Uid: 1, just: '1', holds: ['9'], Flags: flags(1, 1, 2) }]);
    expect(c.duration).toBeCloseTo(11);
  });

  it('空谱 duration 至少为 1', () => {
    expect(chart([]).duration).toBe(1);
  });
});

describe('结构校验', () => {
  it('缺 Notes / Bpms 被拒绝', () => {
    expect(() => parseChart({ Notes: [] })).toThrow('需要 Notes 和 Bpms 数组');
    expect(() => parseChart(null)).toThrow('必须是对象');
  });

  it('超过 50000 音符被拒绝', () => {
    const notes = Array.from({ length: 50001 }, (_, i) => ({ Uid: i, just: '1', holds: [], Flags: flags(0, 1, 2) }));
    expect(() => parseChart({ Notes: notes, Bpms: [] })).toThrow('超过 50000');
  });
});

describe('解压', () => {
  it('解 raw-deflate 谱面', async () => {
    const json = JSON.stringify({ Notes: [{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }], Bpms: [{ Time: 0, Bpm: 150 }] });
    const bytes = new Uint8Array(deflateRawSync(Buffer.from(json)));
    const c = await decodeChart(bytes);
    expect(c.notes).toHaveLength(1);
    expect(c.bpms[0].bpm).toBe(150);
  });

  it('接受明文 JSON', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ Notes: [], Bpms: [] }));
    expect((await decodeChart(bytes)).notes).toHaveLength(0);
  });

  it('剥掉 BOM', async () => {
    const bytes = new TextEncoder().encode('\ufeff' + JSON.stringify({ Notes: [], Bpms: [] }));
    await expect(decodeChart(bytes)).resolves.toBeDefined();
  });

  it('超过 16 MiB 被拒绝', async () => {
    await expect(decodeChart(new Uint8Array(16 * 1024 * 1024 + 1))).rejects.toThrow('16 MiB');
  });

  it('解压后超过 16 MiB 被拒绝', async () => {
    const big = 'x'.repeat(17 * 1024 * 1024);
    const bytes = new Uint8Array(deflateRawSync(Buffer.from(JSON.stringify({ Notes: [], Bpms: [], pad: big }))));
    await expect(decodeChart(bytes)).rejects.toThrow('16 MiB');
  });
});
