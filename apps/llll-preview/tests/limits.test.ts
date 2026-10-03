import { describe, expect, it } from 'vitest';
import { decodeChart, parseChart } from '../src/chart';
import { demoChart } from '../src/demo';
import { createSlope, holdSegment } from '../src/geometry';

describe('加载边界与演示覆盖', () => {
  it('拒绝超限输入及无效压缩数据', () => {
    expect(() => decodeChart(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow();
    expect(() => decodeChart(new Uint8Array([255, 255, 255]))).toThrow();
  });
  it('拒绝缺字段和无效 BPM', () => {
    expect(() => parseChart({})).toThrow();
    expect(() => parseChart({ Notes: [], Bpms: [{ Time: 0, Bpm: 0 }] })).toThrow();
  });
  it('演示具备四种音符、串链与同时押', () => {
    const chart = demoChart();
    expect(new Set(chart.notes.map(n => n.type))).toEqual(new Set([0, 1, 2, 3]));
    expect(chart.notes.some(n => n.next)).toBe(true);
    expect(chart.lines.length).toBeGreaterThan(0);
  });
  it('未出生与已结束的 Hold 不生成顶点', () => {
    const note = demoChart().notes.find(n => n.type === 1)!;
    const slope = createSlope(6);
    expect(holdSegment(note, -10, slope, false)).toEqual([]);
    expect(holdSegment(note, 100, slope, false)).toEqual([]);
  });
});
