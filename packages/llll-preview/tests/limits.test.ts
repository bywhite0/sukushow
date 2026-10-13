import { describe, expect, it } from 'vitest';
import { decodeChart, parseChart } from '@sukushow/chart/chart';
import { createSlope, holdSegment } from '../src/geometry';

const chartFixture = () => parseChart({
  Notes: [
    { Uid: 1, just: '2', Flags: 192, holds: [] },
    { Uid: 2, just: '2', Flags: 3081072, holds: [] },
    { Uid: 3, just: '3', Flags: 10401, holds: ['4'] },
    { Uid: 4, just: '4', Flags: 10401, holds: ['5'] },
    { Uid: 5, just: '6', Flags: 162, holds: [] },
    { Uid: 6, just: '7', Flags: 163, holds: [] },
  ],
  Bpms: [{ Time: 0, Bpm: 120 }],
});

describe('加载边界与音符输入', () => {
  it('拒绝超限输入及无效压缩数据', () => {
    expect(() => decodeChart(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow();
    expect(() => decodeChart(new Uint8Array([255, 255, 255]))).toThrow();
  });
  it('拒绝缺字段和无效 BPM', () => {
    expect(() => parseChart({})).toThrow();
    expect(() => parseChart({ Notes: [], Bpms: [{ Time: 0, Bpm: 0 }] })).toThrow();
  });
  it('解析四种音符、Hold 串链与同时押', () => {
    const chart = chartFixture();
    expect(new Set(chart.notes.map(n => n.type))).toEqual(new Set([0, 1, 2, 3]));
    expect(chart.notes.some(n => n.next)).toBe(true);
    expect(chart.lines.length).toBeGreaterThan(0);
  });
  it('未出生与已结束的 Hold 不生成顶点', () => {
    const note = chartFixture().notes.find(n => n.type === 1)!;
    const slope = createSlope(6);
    expect(holdSegment(note, -10, slope, false)).toEqual([]);
    expect(holdSegment(note, 100, slope, false)).toEqual([]);
  });
});
