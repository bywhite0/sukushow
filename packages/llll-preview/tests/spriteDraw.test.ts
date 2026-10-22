import { describe, expect, it } from 'vitest';
import { parseChart } from '@sukushow/chart/chart';
import { JudgeEngine, SINGLE_MAX_DIFF, type NoteViewState } from '../src/judge';
import { spriteDraw } from '../src/renderer';

/**
 * `spriteDraw`：手动判定下 Single / Flick / Trace 的绘制分支。
 * 需求：判定窗口跨过判定线时，未判定音符继续越线下落，漏判后沿同一轨迹画完，中间不断档；
 * 已判定或跳转视为已结算的音符不画；AutoPlay（没有判定状态）维持按时间画到判定线。
 */

const state = (patch: Partial<NoteViewState>): NoteViewState => ({
  phase: 'pending', holding: false, broken: false, judged: 0, finished: false, missed: false, ...patch,
});

const flags = (t: number, l: number, r: number) => t + r * 16 + l * 65536;
const singleAt = (just: string) =>
  parseChart({ Notes: [{ Uid: 1, just, Flags: flags(0, 20, 30), holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] } as never);
const FRAME = 1 / 60;

describe('spriteDraw：状态 → 绘制分支', () => {
  it('没有判定状态（AutoPlay）：按时间画到判定线', () => {
    expect(spriteDraw(undefined)).toBe('normal');
  });

  it('未判定（含迟按窗口、Flick 起手待划动）：越线继续画', () => {
    expect(spriteDraw(state({}))).toBe('past-line');
  });

  it('漏判离场：越线继续画到 MISSED_CUTOFF', () => {
    expect(spriteDraw(state({ phase: 'missed', finished: true, missed: true, judged: 1 }))).toBe('past-line');
  });

  it('已判定离场：不画', () => {
    expect(spriteDraw(state({ phase: 'judged', finished: true, judged: 1 }))).toBe('skip');
  });

  it('跳转视为已结算（不是判定 Miss）：不画', () => {
    expect(spriteDraw(state({ phase: 'missed', finished: true }))).toBe('skip');
    expect(spriteDraw(state({ phase: 'pending', finished: true }))).toBe('skip');
  });
});

describe('spriteDraw × JudgeEngine：过线到离场不断档', () => {
  it('不输入的 Single：过线后每一帧都越线绘制，直到漏判离场后仍继续', () => {
    const engine = new JudgeEngine(singleAt('1.0'));
    const draws: string[] = [];
    for (let t = 0.9; t <= 1 + SINGLE_MAX_DIFF + 0.1; t += FRAME) {
      engine.process(t);
      if (t >= 1) draws.push(spriteDraw(engine.noteState(1)));
    }
    expect(draws.length).toBeGreaterThan(10);
    expect(draws.every((d) => d === 'past-line')).toBe(true);
    expect(engine.noteState(1)).toMatchObject({ phase: 'missed', finished: true, missed: true });
  });

  it('迟按命中：命中前越线绘制，命中当帧起不再绘制', () => {
    const engine = new JudgeEngine(singleAt('1.0'));
    engine.process(1.05);
    expect(spriteDraw(engine.noteState(1))).toBe('past-line');
    engine.process(1.08, [{ id: 1, phase: 'began', lane: 25, time: 1.08 }]);
    expect(engine.noteState(1)).toMatchObject({ phase: 'judged', finished: true });
    expect(spriteDraw(engine.noteState(1))).toBe('skip');
  });

  it('跳转越过的音符：重开后不画', () => {
    const engine = new JudgeEngine(singleAt('1.0'));
    engine.seek(2);
    expect(spriteDraw(engine.noteState(1))).toBe('skip');
    engine.process(2 + FRAME);
    expect(spriteDraw(engine.noteState(1))).toBe('skip');
  });
});
