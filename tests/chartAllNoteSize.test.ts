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

  it('trims the last sample when (long)(|end − last| × 10000f) <= 1, i.e. |Δ| < 2e-4', () => {
    // 103108 MASTER uid 556 chain: just 49.70587 → tail 50.29421 @ 102 BPM (masterdata MaxCombo 947).
    // Half-beat samples 50.0000, 50.29410 …; |50.29421 − 50.29410| ≈ 1.05e-4 → truncates to 1 → removed.
    // The old double `× 10000 <= 1` kept it (+1 combo).
    const h = getHolds(49.70587, 50.29421, [{ time: 0, bpm: 102 }]);
    expect(h).toHaveLength(2);
    expect(h[1]).toBe(Math.fround(50.29421));
  });

  it('accumulates half-beats in float32 across BPM changes (float drift)', () => {
    // 405138 MASTER uid 1006 chain: 84 → 85.89473 through a 38→190→380→760→1140 BPM ramp
    // (Time values are float32 as JsonUtility reads them). Double accumulation gave 24 samples;
    // float32 (GetHolds @0x485D11C) gives 26, matching masterdata MaxCombo 1142.
    const bpms = [
      { time: 0, bpm: 190 }, { time: 84, bpm: 38 }, { time: 84.63158416748047, bpm: 190 },
      { time: 84.94737243652344, bpm: 380 }, { time: 85.2631607055664, bpm: 760 },
      { time: 85.57894897460938, bpm: 1140 }, { time: 85.89473724365234, bpm: 190 },
    ];
    const h = getHolds(84, 85.89473, bpms);
    expect(h).toHaveLength(26);
    expect(h.every((x) => Math.fround(x) === x)).toBe(true);
    expect(h[h.length - 1]).toBe(Math.fround(85.89473));
  });

  it('zero-length / reversed span yields only [end] (loop guarded by start < end)', () => {
    expect(getHolds(3, 3, [{ time: 0, bpm: 120 }])).toEqual([3]);
  });

  it('Get(bpms, t) before the first segment falls back to the LAST segment', () => {
    // RhythmGameConsts.Get @0x485D410: no (prev.StartTime <= t < cur.StartTime) pair ⇒ last.
    const bpms = [{ time: 1, bpm: 60 }, { time: 10, bpm: 240 }];
    // t=0 → last (240 BPM, half-beat 0.125) → 0.125, 0.25, …; then from t=1 on 60 BPM (0.5)
    expect(getHolds(0, 0.5, bpms)).toEqual([0.125, 0.25, 0.375, 0.5]);
  });
  it('103119_04 AllNoteSize is 1404 when chart bytes exist', () => {
    // Optional local fixture: set RG_CHART_103119_04 to the .bytes path.
    const path = process.env.RG_CHART_103119_04?.trim();
    if (!path || !existsSync(path)) return;
    const chart = decodeChart(new Uint8Array(readFileSync(path)));
    expect(chartAllNoteSize(chart)).toBe(1404);
  });
});
