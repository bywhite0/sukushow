import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORE_RANK_VALUES,
  ScoreEngine,
  calcAdd,
  getScoreRank,
  halfwayScore,
  scoreGaugeFill,
  scoreRankDisplay,
  scoreRankLetter,
  technicalPercent,
  technicalPushValue,
  technicalRaw,
  apAddDelta,
  apDisplay,
  voltageCalcLevel,
  voltageCalcGauge,
  voltageLevelDisplayed,
} from '../src/score';

describe('score math', () => {
  it('halfwayScore divides appeal by note count', () => {
    expect(halfwayScore(100_000, 0, 1404)).toBeCloseTo(100000 / 1404, 10);
  });

  it('calcAdd ceils Perfect/PP factors', () => {
    const h = halfwayScore(100_000, 0, 1404);
    expect(calcAdd(h, 4)).toBe(Math.ceil(h * 30));
    expect(calcAdd(h, 5)).toBe(Math.ceil(h * 35));
    expect(calcAdd(h, 0)).toBe(0);
  });

  it('getScoreRank walks [S,A,B,C] descending', () => {
    const v = DEFAULT_SCORE_RANK_VALUES;
    expect(getScoreRank(0, v)).toBe(0);
    expect(scoreRankLetter(0)).toBe('D');
    expect(scoreRankDisplay(0, 0)).toBe('none');
    expect(scoreRankDisplay(0, 1)).toBe('D');
    expect(scoreRankLetter(getScoreRank(500_000, v))).toBe('C');
    expect(scoreRankLetter(getScoreRank(1_500_000, v))).toBe('B');
    expect(scoreRankLetter(getScoreRank(5_000_000, v))).toBe('A');
    expect(scoreRankLetter(getScoreRank(10_000_000, v))).toBe('S');
  });

  it('gauge fill hits C/B/A/S knots', () => {
    const v = DEFAULT_SCORE_RANK_VALUES;
    expect(scoreGaugeFill(0, v)).toBe(0);
    expect(scoreGaugeFill(500_000, v)).toBeCloseTo(0.409, 5);
    expect(scoreGaugeFill(1_500_000, v)).toBeCloseTo(0.587, 5);
    expect(scoreGaugeFill(5_000_000, v)).toBeCloseTo(0.773, 5);
    expect(scoreGaugeFill(10_000_000, v)).toBeCloseTo(0.912, 5);
    expect(scoreGaugeFill(15_000_000, v)).toBeCloseTo(1, 5);
  });

  it('technical raw/push matches weights', () => {
    const counts = [0, 0, 0, 0, 10, 5]; // 10P + 5PP
    expect(technicalRaw(counts)).toBe(10 * 100 + 5 * 101);
    const push = technicalPushValue(counts, 15, 1);
    expect(push).toBe(Math.trunc(((10 * 100 + 5 * 101) / 15) * 10000));
    expect(technicalPercent(push)).toBeCloseTo(push / 10000, 10);
    const est = technicalPushValue([0, 0, 0, 0, 0, 0], 10, 2);
    // remain 10 as PP: raw=1010; push=trunc(1010/10*10000)=1010000
    expect(est).toBe(1_010_000);
  });
});

describe('ScoreEngine', () => {
  it('accumulates AutoPlay Perfect hits and promotes rank', () => {
    const eng = new ScoreEngine({
      totalAppeal: 350_000,
      musicMasteryLevel: 0,
      rankValues: DEFAULT_SCORE_RANK_VALUES,
      voltageLevel: 0,
    });
    const chart = {
      notes: Array.from({ length: 200 }, (_, i) => ({
        uid: i, time: i * 0.1, end: i * 0.1, holds: [] as number[],
        type: 0, l: 0, r: 0, l2: 0, r2: 0,
      })),
      roots: [], lines: [], bpms: [], duration: 30,
    };
    eng.reset(chart as never);
    eng.addMany(4, 200);
    expect(eng.combo).toBe(200);
    expect(eng.score).toBeGreaterThan(0);
    expect(eng.rank).toBeGreaterThanOrEqual(0);
  });
});


describe('ApResolver / Voltage', () => {
  it('apDisplay splits integer and fractional gauge', () => {
    expect(apDisplay(0)).toEqual({ value: 0, gauge: 0 });
    expect(apDisplay(15_000).value).toBe(1);
    expect(apDisplay(15_000).gauge).toBeCloseTo(0.5, 5);
  });

  it('apAddDelta skips Miss/Bad; Good uses halfPlus', () => {
    const base = 6000;
    const half = 3000;
    expect(apAddDelta(0, 0, base, half)).toBe(0);
    expect(apAddDelta(1, 5, base, half)).toBe(0);
    expect(apAddDelta(2, 0, base, half)).toBe(3000);
    expect(apAddDelta(4, 0, base, half)).toBe(6000);
    expect(apAddDelta(4, 5, base, half)).toBe(9000);
  });

  it('voltage level / gauge / fever doubling', () => {
    expect(voltageCalcLevel(0)).toBe(0);
    expect(voltageCalcLevel(2100)).toBe(20);
    expect(voltageLevelDisplayed(3, false)).toBe(3);
    expect(voltageLevelDisplayed(3, true)).toBe(6);
    expect(voltageCalcGauge(0, 0)).toBe(0);
  });

  it('ScoreEngine accumulates AP on hits; Voltage stays 0 without skills', () => {
    const eng = new ScoreEngine();
    eng.reset(null);
    eng.addMany(4, 10);
    expect(eng.apPoints).toBeGreaterThan(0);
    expect(eng.voltagePoints).toBe(0);
    expect(eng.voltageLevel).toBe(0);
    eng.setFever(true);
    expect(eng.voltageLevel).toBe(0);
    eng.addVoltagePoints(50);
    expect(eng.voltageLevel).toBe(eng.voltageBaseLevel << 1);
  });

  it('lastAdd tracks single hit and addMany sum; Miss stays 0', () => {
    const eng = new ScoreEngine();
    eng.reset(null);
    eng.add(4);
    expect(eng.lastAdd).toBeGreaterThan(0);
    const one = eng.lastAdd;
    eng.addMany(4, 3);
    expect(eng.lastAdd).toBe(one * 3);
    eng.add(0);
    expect(eng.lastAdd).toBe(0);
  });
});
