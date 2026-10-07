/** 解析单测。 */

import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { parseChart, decodeChart, bpmAt, beatAt, SIMULTANEOUS_WINDOW } from '../src/chart';

const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const chart = (notes: unknown[], bpms: unknown[] = [{ Time: 0, Bpm: 120 }]) =>
  parseChart({ Notes: notes, Bpms: bpms });

describe('解析', () => {
  it('解出四类音符与轨道', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 20, 25, 22, 27) },
      { Uid: 3, just: '4.0', holds: [], Flags: flags(2, 30, 30) },
      { Uid: 4, just: '5.0', holds: [], Flags: flags(3, 40, 50) },
    ]);
    expect(c.notes.map(n => n.type)).toEqual([0, 1, 2, 3]);
    expect(c.notes[1].end).toBe(3.0);
    expect(c.notes[1]).toMatchObject({ l: 20, r: 25, l2: 22, r2: 27 });
  });

  it('Hold 串链按 (l2,r2)→(l,r) 且 Uid 递增判连', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 10, 20, 12, 22) },
      { Uid: 3, just: '3.0', holds: ['4.0'], Flags: flags(1, 12, 22, 12, 22) },
    ]);
    const [a, b, d] = c.notes;
    expect(a.next).toBe(b);
    expect(b.next).toBe(d);
    expect(d.next).toBeUndefined();
    expect(c.roots.map(n => n.uid)).toEqual([1]);
    expect(d.end).toBe(4.0);
  });

  it('链首起点与链尾终点进同时押组', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 2, just: '2.0', holds: ['3.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 3, just: '1.0', holds: [], Flags: flags(0, 30, 32) },
      { Uid: 4, just: '3.0', holds: [], Flags: flags(0, 40, 42) },
    ]);
    const at = (t: number) => c.lines.find(l => Math.abs(l.time - t) < 1e-6);
    expect(at(1.0)?.points.length).toBe(2);
    expect(at(3.0)?.points.length).toBe(2);
    expect(at(3.0)?.points.some(p => p.tail)).toBe(true);
  });

  it('同时押容差是 4ms', () => {
    expect(SIMULTANEOUS_WINDOW).toBe(0.004);
    const c = chart([
      { Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) },
      { Uid: 2, just: '1.003', holds: [], Flags: flags(0, 20, 22) },
      { Uid: 3, just: '1.010', holds: [], Flags: flags(0, 30, 32) },
    ]);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].points).toHaveLength(2);
  });

  it('拒绝越界与倒序数据', () => {
    expect(() => chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 12, 10) }])).toThrow(/轨道/);
    expect(() => chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(4, 10, 12) }])).toThrow(/类型/);
    expect(() => chart([{ Uid: 1, just: '2.0', holds: ['1.0'], Flags: flags(1, 10, 12) }])).toThrow(/倒序/);
    expect(() => chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }, { Uid: 1, just: '2.0', holds: [], Flags: flags(0, 10, 12) }])).toThrow(/重复/);
  });

  it('BPM 与拍号取「不晚于该时刻」的最后一段', () => {
    const bpms = [{ time: 0, bpm: 120 }, { time: 5, bpm: 180 }];
    expect(bpmAt(bpms, 0)).toBe(120);
    expect(bpmAt(bpms, 4.9)).toBe(120);
    expect(bpmAt(bpms, 5)).toBe(180);
    expect(bpmAt([], 3)).toBe(120);
    const beats = [{ numerator: 4, denominator: 4, time: 0 }, { numerator: 3, denominator: 4, time: 2 }];
    expect(beatAt(beats, 1).numerator).toBe(4);
    expect(beatAt(beats, 2).numerator).toBe(3);
  });

  it('deflate 输入与明文输入等价', () => {
    const json = JSON.stringify({ Notes: [{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }], Bpms: [{ Time: 0, Bpm: 120 }] });
    const a = decodeChart(new Uint8Array(deflateRawSync(Buffer.from(json))));
    const b = decodeChart(new TextEncoder().encode(json));
    expect(a.notes.length).toBe(b.notes.length);
    expect(a.notes[0]).toMatchObject({ uid: 1, time: 1.0, type: 0 });
  });
});
