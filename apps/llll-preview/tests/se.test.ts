import { describe, expect, it } from 'vitest';
import {
  SE_CUE,
  SeResolver,
  buildLineHashTables,
  collectAutoPlaySeHits,
  countActiveHolds,
  cueIndexForJudgement,
  dispatchAutoPlaySe,
  type SeOutput,
} from '../src/se';
import { parseChart } from '../src/chart';

class FakeOut implements SeOutput {
  plays: { index: number; vol: number; offset?: number }[] = [];
  stops: string[] = [];
  holdPauses = 0;
  holdStarts = 0;
  holdStops = 0;
  play(index: number, volume: number, offset?: number) {
    this.plays.push(offset === undefined ? { index, vol: volume } : { index, vol: volume, offset });
  }
  stopOneShots(scope: 'tap' | 'all') {
    this.stops.push(scope);
  }
  startHold(_volume: number) {
    this.holdStarts++;
  }
  stopHold() {
    this.holdStops++;
  }
  pauseHold() {
    this.holdPauses++;
  }
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

describe('Hold 自动播放音效', () => {
  const chartFor = (chained: boolean) => parseChart({
    Notes: chained
      ? [{ Uid: 1, just: 1, Flags: 1, holds: [1.5] },
         { Uid: 2, just: 1.5, Flags: 1, holds: [2] }]
      : [{ Uid: 1, just: 1, Flags: 1, holds: [1.25, 1.5, 1.75, 2] }],
    Bpms: [{ Time: 0, Bpm: 120 }],
  });

  it.each([false, true])('持续判定不触发按键音，首尾保留（串链=%s）', (chained) => {
    const chart = chartFor(chained);
    const hashes = buildLineHashTables(chart);
    const out = new FakeOut();
    const se = new SeResolver(out);
    const frame = (from: number, to: number) => {
      se.process();
      dispatchAutoPlaySe(se, collectAutoPlaySeHits(chart, from, to, hashes), 5, countActiveHolds(chart, to));
      se.applyHold();
    };
    frame(0.9, 1);
    expect(out.plays.map((p) => p.index)).toEqual([SE_CUE.perfect]);
    expect(out.holdStarts).toBe(1);
    out.plays = [];
    frame(1, 1.75);
    expect(out.plays).toEqual([]);
    expect(out.holdStarts).toBe(1);
    expect(out.holdStops).toBe(0);
    frame(1.75, 2);
    expect(out.plays.map((p) => p.index)).toEqual([SE_CUE.perfect]);
    expect(out.holdStops).toBe(1);
    frame(2, 2.1);
    expect(out.plays).toHaveLength(1);
  });

  it('持续期间独立的 Single、Flick、Trace 仍正常发声', () => {
    const chart = chartFor(false);
    const extra = parseChart({
      Notes: [0, 2, 3].map((type, i) => ({ Uid: i + 10, just: 1.5, Flags: type, holds: [] })),
      Bpms: [{ Time: 0, Bpm: 120 }],
    });
    chart.notes.push(...extra.notes);
    chart.roots.push(...extra.roots);
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    dispatchAutoPlaySe(se, collectAutoPlaySeHits(chart, 1.49, 1.5, buildLineHashTables(chart)), 5, countActiveHolds(chart, 1.5));
    se.applyHold();
    expect(out.plays.map((p) => p.index)).toEqual([SE_CUE.perfect, SE_CUE.flick, SE_CUE.perfect]);
    expect(out.holdStarts).toBe(1);
  });

  it('空时间窗没有一次性音效', () => {
    const chart = chartFor(false);
    expect(collectAutoPlaySeHits(chart, 1.5, 1.5, buildLineHashTables(chart))).toEqual([]);
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

describe('暂停 / 跳转时的 SE', () => {
  it('pause 静音 hold 并停掉全部单发音；clear 只停击中音', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.process();
    se.addHold();
    se.applyHold();
    se.pause();
    expect(out.holdPauses).toBe(1);
    expect(out.stops).toEqual(['all']);
    se.clear();
    expect(out.holdStops).toBe(1);
    expect(out.stops).toEqual(['all', 'tap']);
  });
  it('playStart 可从过场中途接着放', () => {
    const out = new FakeOut();
    const se = new SeResolver(out);
    se.playStart(1.25);
    se.playStart();
    expect(out.plays).toEqual([
      { index: SE_CUE.start, vol: 1, offset: 1.25 },
      { index: SE_CUE.start, vol: 1 },
    ]);
  });
});
