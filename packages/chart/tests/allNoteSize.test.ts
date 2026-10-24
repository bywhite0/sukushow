import { readFileSync, existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { chartAllNoteSize, decodeChart, getHolds, parseChart } from '../src/chart';

const flags = (t: number, l: number, r: number, l2 = 0, r2 = 0) =>
  t + r * 16 + r2 * 1024 + l * 65536 + l2 * 4194304;

describe('getHolds / AllNoteSize', () => {
  it('samples half-beats and ends on end', () => {
    const bpms = [{ time: 0, bpm: 120 }];
    // 120 BPM → half-beat = 0.25s; start 0 → 0.25,0.50,0.75,1
    expect(getHolds(0, 1, bpms)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('multi-segment chain head uses GetHolds span (non-mutating)', () => {
    const c = parseChart({
      Notes: [
        { Uid: 1, just: '0', Flags: flags(1, 0, 5, 10, 15), holds: ['1'] },
        { Uid: 2, just: '1', Flags: flags(1, 10, 15, 20, 25), holds: ['2'] },
      ],
      Bpms: [{ Time: 0, Bpm: 120 }],
    });
    // Original segment holds preserved for view
    expect(c.notes[0].holds).toEqual([1]);
    expect(c.notes[0].end).toBe(1);
    // Judgement ticks: head + resampled to chain tail end 2
    const n = chartAllNoteSize(c);
    // non-hold 0 + one chain: 1 + getHolds(0,2).length
    expect(n).toBe(1 + getHolds(0, 2, c.bpms).length);
  });

  it('103119_04 AllNoteSize is 1404 when chart bytes exist', () => {
    // Optional local fixture: set RG_CHART_103119_04 to the .bytes path.
    const path = process.env.RG_CHART_103119_04?.trim();
    if (!path || !existsSync(path)) return;
    const chart = decodeChart(new Uint8Array(readFileSync(path)));
    expect(chartAllNoteSize(chart)).toBe(1404);
  });
});
