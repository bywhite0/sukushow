import { describe, expect, it } from 'vitest';
import { noteJudgementTimes, parseChart } from '@sukushow/chart/chart';
import { JudgeEngine, type JudgeTouch } from '../src/judge';
import { holdLoopWanted } from '../src/renderer';

/**
 * Hold 循环特效的去留，依据 4.12.0 `ManualHoldNotePolicy`：起判时取得 `_loopEffectView`
 * （头判命中 `FireHold`、漏头 `GetHold`），`ProcessView` 每帧 `SetActive(_touched)`，
 * 尾判成功 / 尾 Miss 时 `ReleaseHold`。`_touched = index != -1 && touchPhase != Canceled`。
 */

const flags = (t: number, l: number, r: number, l2: number, r2: number) =>
  t + r * 16 + r2 * 1024 + l * 65536 + l2 * 4194304;
/** 两段串链（2 → 3 → 4 s），中间有半拍重采样的航点。 */
const chain = () => parseChart({
  Notes: [
    { Uid: 1, just: '2', Flags: flags(1, 0, 5, 10, 15), holds: ['3'] },
    { Uid: 2, just: '3', Flags: flags(1, 10, 15, 20, 25), holds: ['4'] },
  ],
  Bpms: [{ Time: 0, Bpm: 120 }],
} as never);
const FRAME = 1 / 60;

/** 逐帧推进，每帧记录 `holdLoopWanted`。 */
function loopTrace(engine: JudgeEngine, from: number, to: number, touches: (t: number) => JudgeTouch[] = () => []) {
  const out: { time: number; loop: boolean | null; misses: number; finished: boolean }[] = [];
  let misses = 0;
  for (let t = from; t <= to + 1e-9; t += FRAME) {
    misses += engine.process(t, touches(t)).filter((e) => e.kind === 'judge' && e.type === 0).length;
    out.push({ time: t, loop: holdLoopWanted(engine.noteState(1)), misses, finished: engine.noteState(1).finished });
  }
  return out;
}

describe('holdLoopWanted：循环特效跟原版 _touched 走', () => {
  it('没有判定状态（AutoPlay）：交给 fx.sync', () => {
    expect(holdLoopWanted(undefined)).toBeNull();
  });

  it('起判前没有；头判命中后一直在场，松手后中间采样 Miss 也不熄灭，尾 Miss 离场才收', () => {
    const chart = chain();
    expect(noteJudgementTimes(chart.roots[0]!, chart.bpms).length).toBeGreaterThan(3);
    const engine = new JudgeEngine(chart);
    const trace = loopTrace(engine, 1.9, 4.2, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [{ id: 1, phase: 'began', lane: 2, time: t }];
      if (t < 2.2) return [{ id: 1, phase: 'stationary', lane: 2, time: t }];
      if (t < 2.2 + FRAME) return [{ id: 1, phase: 'ended', lane: 2, time: t }];
      return [];
    });
    expect(trace.filter((f) => f.time < 2).every((f) => f.loop === false)).toBe(true);
    const alive = trace.filter((f) => f.time >= 2 + FRAME && !f.finished);
    expect(alive.length).toBeGreaterThan(60);
    expect(alive.every((f) => f.loop === true)).toBe(true);
    // 中间采样已经判过 Miss，循环特效仍在场。
    expect(alive.some((f) => f.misses > 0 && f.loop === true)).toBe(true);
    expect(engine.noteState(1)).toMatchObject({ finished: true, missed: true });
    expect(trace.at(-1)!.loop).toBe(false);
  });

  it('漏头（灰色僵尸）：GetHold 同样取得循环特效，起判后在场', () => {
    const engine = new JudgeEngine(chain());
    const trace = loopTrace(engine, 1.9, 2.5);
    const afterHeadMiss = trace.filter((f) => f.misses > 0);
    expect(afterHeadMiss.length).toBeGreaterThan(0);
    expect(afterHeadMiss.every((f) => f.loop === true)).toBe(true);
  });

  it('Canceled：_touched 为 false，循环特效熄灭；范围内再按下又点亮', () => {
    const engine = new JudgeEngine(chain());
    const trace = loopTrace(engine, 1.9, 2.6, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [{ id: 1, phase: 'began', lane: 2, time: t }];
      if (t < 2.2) return [{ id: 1, phase: 'stationary', lane: 2, time: t }];
      if (t < 2.2 + FRAME) return [{ id: 1, phase: 'canceled', lane: 2, time: t }];
      if (t < 2.4) return [];
      return [{ id: 2, phase: t < 2.4 + FRAME ? 'began' : 'stationary', lane: 8, time: t }];
    });
    expect(trace.find((f) => f.time > 2.25 && f.time < 2.4)!.loop).toBe(false);
    expect(trace.find((f) => f.time > 2.45)!.loop).toBe(true);
  });

  it('尾判成功离场：收掉', () => {
    const engine = new JudgeEngine(chain());
    const trace = loopTrace(engine, 1.9, 4.2, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [{ id: 1, phase: 'began', lane: 2, time: t }];
      return t < 4.1 ? [{ id: 1, phase: 'stationary', lane: 2 + (t - 2) * 10, time: t }] : [];
    });
    expect(engine.noteState(1)).toMatchObject({ finished: true, missed: false });
    expect(trace.at(-1)!.loop).toBe(false);
  });
});
