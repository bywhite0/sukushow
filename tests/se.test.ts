import { describe, expect, it } from 'vitest';
import {
  SE_CUE,
  SeResolver,
  buildLineHashTables,
  cueIndexForJudgement,
  dispatchAutoPlaySe,
  type SeOutput,
} from '../src/se';
import { parseChart } from '../src/chart';

class FakeOut implements SeOutput {
  plays: { index: number; vol: number }[] = [];
  holdStarts = 0;
  holdStops = 0;
  play(index: number, volume: number) {
    this.plays.push({ index, vol: volume });
  }
  startHold(_volume: number) {
    this.holdStarts++;
  }
  stopHold() {
    this.holdStops++;
  }
  pauseHold() {}
  resumeHold() {}
  setTapVolume() {}
  setSeVolume() {}
  dispose() {}
}

describe('cueIndexForJudgement', () => {
  it('maps Bad/Good/Great/Perfect/PP', () => {
    expect(cueIndexForJudgement(1)).toBe(SE_CUE.bad);
    expect(cueIndexForJudgement(2)).toBe(SE_CUE.good);
    expect(cueIndexForJudgement(3)).toBe(SE_CUE.great);
    expect(cueIndexForJudgement(4)).toBe(SE_CUE.perfect);
    expect(cueIndexForJudgement(5)).toBe(SE_CUE.perfect);
    expect(cueIndexForJudgement(0)).toBe(SE_CUE.perfect);
  });
});

describe('SeResolver volume window', () => {
  it('boosts ×1.5 when same lineHash in previous 1–2 frames', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    se.addSingle(4, 42);
    expect(out.plays[0]!.vol).toBe(1);
    se.process();
    se.addSingle(4, 42);
    expect(out.plays[1]!.vol).toBe(1.5);
    se.process();
    se.addSingle(4, 42);
    expect(out.plays[2]!.vol).toBe(1.5);
    // Three idle Process frames clear the hash from both previous slots.
    se.process();
    se.process();
    se.process();
    se.addSingle(4, 42);
    expect(out.plays[3]!.vol).toBe(1);
  });

  it('same-frame duplicate lineHash stays default volume', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    se.addSingle(4, 7);
    se.addSingle(4, 7);
    expect(out.plays.map((p) => p.vol)).toEqual([1, 1]);
  });
});

describe('SeResolver hold', () => {
  it('starts hold loop when count≥1 and stops at 0', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    se.addHold();
    se.applyHold();
    expect(out.holdStarts).toBe(1);
    se.process();
    se.applyHold();
    expect(out.holdStops).toBe(1);
  });
});

describe('dispatchAutoPlaySe', () => {
  it('Flick→AddFlick; others→AddSingle; AutoTrace uses AddSingle', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    dispatchAutoPlaySe(
      se,
      [
        { noteType: 0, lineHash: 0, isHoldTail: false },
        { noteType: 2, lineHash: 0, isHoldTail: false },
        { noteType: 3, lineHash: 0, isHoldTail: false },
      ],
      5,
      0,
    );
    expect(out.plays.map((p) => p.index)).toEqual([SE_CUE.perfect, SE_CUE.flick, SE_CUE.perfect]);
  });
});

describe('buildLineHashTables', () => {
  it('assigns shared hash for simultaneous presses', () => {
    const chart = parseChart({
      Notes: [
        { Uid: 1, just: 1.0, Flags: 0, holds: [] },
        { Uid: 2, just: 1.002, Flags: 0x10, holds: [] },
        { Uid: 3, just: 2.0, Flags: 0, holds: [] },
      ],
      Bpms: [{ Time: 0, Bpm: 120 }],
    });
    const tables = buildLineHashTables(chart);
    const h1 = tables.first.get(1);
    const h2 = tables.first.get(2);
    expect(h1).toBeTruthy();
    expect(h1).toBe(h2);
    expect(tables.first.get(3) ?? 0).toBe(0);
  });
});
