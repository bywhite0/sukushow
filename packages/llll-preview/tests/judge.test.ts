import { describe, expect, it } from 'vitest';
import { noteJudgementTimes, parseChart } from '@sukushow/chart/chart';
import {
  FLICK_DISTANCE, JudgeEngine, conditionForDiff, isHoldEnd, judgementForFlick, judgementForHold,
  judgementForSingle, judgementForTrace, round3, type JudgeTouch,
} from '../src/judge';

const flags = (t: number, l: number, r: number, l2 = 0, r2 = 0) =>
  t + r * 16 + r2 * 1024 + l * 65536 + l2 * 4194304;
const note = (Uid: number, just: string, Flags = flags(0, 0, 5), holds: string[] = []) =>
  ({ Uid, just, Flags, holds });
const chartOf = (Notes: unknown[], Bpms = [{ Time: 0, Bpm: 120 }]) =>
  parseChart({ Notes, Bpms } as never);

const FRAME = 1 / 60;
/** 事件发生在 target 之后的第一个整帧。 */
const at = (t: number, target: number) => t >= target && t < target + FRAME;

/** 逐帧推进到 `to`，`touches` 按帧时间返回该帧的触摸事件。 */
function run(
  engine: JudgeEngine, from: number, to: number,
  touches: (time: number) => JudgeTouch[] = () => [],
): { time: number; events: ReturnType<JudgeEngine['process']> }[] {
  const out: { time: number; events: ReturnType<JudgeEngine['process']> }[] = [];
  for (let t = from; t <= to + 1e-9; t += FRAME) {
    const events = engine.process(t, touches(t));
    if (events.length) out.push({ time: t, events });
  }
  return out;
}

const stationary = (id: number, lane: number, time: number): JudgeTouch =>
  ({ id, phase: 'stationary', lane, time });
const began = (id: number, lane: number, time: number, extra: Partial<JudgeTouch> = {}): JudgeTouch =>
  ({ id, phase: 'began', lane, time, ...extra });
const ended = (id: number, lane: number, time: number): JudgeTouch =>
  ({ id, phase: 'ended', lane, time });

describe('判定窗口（4.12.0 分表）', () => {
  it('Single：PP .025 / Perfect .04 / Great .07 / Good .1 / Bad .125', () => {
    expect(judgementForSingle(0)).toBe(5);
    expect(judgementForSingle(0.03)).toBe(4);
    expect(judgementForSingle(0.05)).toBe(3);
    expect(judgementForSingle(0.08)).toBe(2);
    expect(judgementForSingle(0.11)).toBe(1);
    expect(judgementForSingle(0.13)).toBe(0);
  });

  it('Hold：没有 Perfect 档，PP .04 / Great .07 / Good .1 / Bad .125', () => {
    expect(judgementForHold(0)).toBe(5);
    expect(judgementForHold(0.05)).toBe(3);
    expect(judgementForHold(0.08)).toBe(2);
    expect(judgementForHold(0.11)).toBe(1);
    expect(judgementForHold(0.13)).toBe(0);
  });

  it('Flick：PP .07 / Great .1 / 其余 Miss', () => {
    expect(judgementForFlick(0.05)).toBe(5);
    expect(judgementForFlick(0.08)).toBe(3);
    expect(judgementForFlick(0.11)).toBe(0);
  });

  it('Trace：只有 PP .07 / Miss', () => {
    expect(judgementForTrace(0.05)).toBe(5);
    expect(judgementForTrace(0.08)).toBe(0);
  });

  it('Hold 尾判窗口 Round(diff,3) ∈ [-0.1, 0]', () => {
    expect(isHoldEnd(0)).toBe(true);
    expect(isHoldEnd(-0.05)).toBe(true);
    expect(isHoldEnd(-0.1)).toBe(true);
    expect(isHoldEnd(-0.11)).toBe(false);
    expect(isHoldEnd(0.01)).toBe(false);
  });

  it('Round(diff,3) 用银行家舍入：0.1005 → 0.100（Good 而非 Bad）', () => {
    expect(round3(0.1005)).toBeCloseTo(0.1, 9);
    expect(judgementForSingle(0.1005)).toBe(2);
    expect(judgementForSingle(0.1006)).toBe(1);
  });

  it('ToCondition：早于目标 Fast，否则（含 0）Slow', () => {
    expect(conditionForDiff(-0.01)).toBe(1);
    expect(conditionForDiff(0)).toBe(2);
    expect(conditionForDiff(0.01)).toBe(2);
  });
});

describe('Single', () => {
  it('按下即判定并消费手指，不再产生第二条', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(0, 10, 12))]));
    const frames = run(engine, 1.9, 2.05, (t) => (at(t, 2) ? [began(1, 11, 2)] : []));
    const events = frames.flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ uid: 1, type: 5, condition: 2, head: true, noteType: 0 });
    expect(engine.noteState(1)).toMatchObject({ phase: 'judged', finished: true, judged: 1 });
  });

  it('错过 MaxDiff 判 Miss（不发声，由 HUD 决定）', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2')]));
    const events = run(engine, 1.9, 2.2).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 0, target: 2, head: true });
    expect(engine.noteState(1).phase).toBe('missed');
  });

  it('过早按下不消耗，之后仍可判定', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(0, 10, 12))]));
    const early = run(engine, 1.8, 1.85, () => [began(1, 11, 1.8)]).flatMap((f) => f.events);
    expect(early.filter((e) => e.kind === 'judge')).toHaveLength(0);
    const late = run(engine, 1.9, 2.05, (t) => (at(t, 2) ? [began(2, 11, 2)] : []))
      .flatMap((f) => f.events);
    expect(late).toHaveLength(1);
    expect(late[0]!.type).toBe(5);
  });

  it('可点范围 = 音符左右各 5.5 lane', () => {
    const inRange = new JudgeEngine(chartOf([note(1, '2', flags(0, 10, 12))]));
    const inside = run(inRange, 1.9, 2.05, (t) => (at(t, 2) ? [began(1, 16, 2)] : []))
      .flatMap((f) => f.events);
    expect(inside).toHaveLength(1);

    const outRange = new JudgeEngine(chartOf([note(1, '2', flags(0, 10, 12))]));
    const outside = run(outRange, 1.9, 2.2, (t) => (at(t, 2) ? [began(1, 17.6, 2)] : []))
      .flatMap((f) => f.events);
    expect(outside.map((e) => e.kind)).toEqual(['empty', 'judge']);
    expect(outside[1]!.type).toBe(0);
  });

  it('同刻双押按到区间中点的距离排序，最近的先判', () => {
    const engine = new JudgeEngine(chartOf([
      note(1, '2', flags(0, 10, 12)),
      note(2, '2', flags(0, 30, 32)),
    ]));
    const events = run(engine, 1.9, 2.05, (t) => (at(t, 2) ? [began(1, 31.4, 2)] : []))
      .flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.uid).toBe(2);
  });
});

describe('Trace', () => {
  it('按下即 PP，不需要新按下（Moved 也可）', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(3, 10, 12))]));
    const events = run(engine, 1.9, 2.05, (t) =>
      (at(t, 2) ? [{ id: 1, phase: 'moved', lane: 11, time: 2 } as JudgeTouch] : []),
    ).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 5, noteType: 3 });
  });

  it('窗口只有 MinDiff 0.07', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(3, 10, 12))]));
    const events = run(engine, 1.9, 2.1).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(0);
  });
});

describe('Flick', () => {
  it('键盘起手即完成，只产生一条结算判定', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const events = run(engine, 1.9, 2.05, (t) =>
      (at(t, 2) ? [began(1, 11, 2, { keyboard: true })] : []),
    ).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 5, flick: true, head: true });
  });

  it('指针划动 25px 内完成 → 起手判定生效', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const events = run(engine, 1.9, 2.05, (t) => {
      if (at(t, 2)) return [began(1, 11, 2, { x: 100, y: 100 })];
      if (at(t, 2.02)) {
        return [{ id: 1, phase: 'moved', lane: 11, time: 2.02, x: 100 + Math.sqrt(FLICK_DISTANCE), y: 100 }];
      }
      return [];
    }).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(5);
  });

  it('起手后超时未划动 → 兜底 Good + Flick', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const events = run(engine, 1.9, 2.2, (t) =>
      (at(t, 2) ? [began(1, 11, 2, { x: 100, y: 100 })] : []),
    ).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 2, condition: 3, flick: true });
  });

  it('起手后松手不提前结算，仍等 0.075 s 兜底 Good', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const frames = run(engine, 1.9, 2.2, (t) => {
      if (at(t, 2)) return [began(1, 11, 2, { x: 100, y: 100 })];
      if (at(t, 2.02)) return [ended(1, 11, 2.02)];
      return [];
    });
    expect(frames.flatMap((f) => f.events)).toHaveLength(1);
    const [first] = frames;
    expect(first!.events[0]).toMatchObject({ type: 2, condition: 3 });
    expect(first!.time).toBeGreaterThan(2.07);
  });

  it('起手后划出可点范围也能完成手势', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const events = run(engine, 1.9, 2.05, (t) => {
      if (at(t, 2)) return [began(1, 11, 2, { x: 100, y: 100 })];
      // lane 30 远在音符可点范围外；起手后 ShouldRange 为 false，同指事件直通。
      if (at(t, 2.02)) return [{ id: 1, phase: 'moved', lane: 30, time: 2.02, x: 100, y: 100 + Math.sqrt(FLICK_DISTANCE) }];
      return [];
    }).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 5, flick: true });
  });

  it('完全没按 → Miss', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    const events = run(engine, 1.9, 2.2).flatMap((f) => f.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(0);
  });
});

describe('Hold', () => {
  it('按住到链尾：头 + 尾都 PP，结束后不再画', () => {
    const chart = chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    const root = chart.roots[0]!;
    const events = run(engine, 1.9, 2.6, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [began(1, 2, 2)];
      return [stationary(1, 2, t)];
    }).flatMap((f) => f.events);
    expect(events.map((e) => [e.type, e.holdIndex, e.holdEnd])).toEqual([[5, 0, false], [5, 1, true]]);
    expect(engine.noteState(root.uid)).toMatchObject({ phase: 'judged', finished: true, missed: false });
  });

  it('松手过早：剩余采样按 Miss 走，断链', () => {
    const chart = chartOf([
      note(1, '2', flags(1, 0, 5, 10, 15), ['3']),
      note(2, '3', flags(1, 10, 15, 20, 25), ['4']),
    ]);
    const engine = new JudgeEngine(chart);
    const root = chart.roots[0]!;
    const waypoints = noteJudgementTimes(root, chart.bpms);
    const events = run(engine, 1.9, 4.1, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [began(1, 2, 2)];
      if (at(t, 2.3)) return [ended(1, 2, 2.3)];
      if (t > 2.3) return [];
      return [stationary(1, 2, t)];
    }).flatMap((f) => f.events);
    expect(events[0]).toMatchObject({ type: 5, head: true, holdIndex: 0 });
    expect(events.filter((e) => e.type === 0).length).toBe(waypoints.length - 2);
    expect(engine.noteState(root.uid).broken).toBe(true);
  });

  it('松手后保持「按住」外观：ribbon / 循环特效 / 持续音都持续到离场；松手本身不算断链', () => {
    const chart = chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    const root = chart.roots[0]!;
    const frames = run(engine, 1.9, 2.3, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [began(1, 2, 2)];
      if (at(t, 2.1)) return [ended(1, 2, 2.1)];
      return t > 2.1 ? [] : [stationary(1, 2, t)];
    });
    // 2.1 松手后尾采样还没到，音符还在活跃表里（尾部 Miss 要等链尾）。
    expect(frames.flatMap((f) => f.events).map((e) => e.type)).toEqual([5]);
    expect(engine.noteState(root.uid)).toMatchObject({
      phase: 'judged', holding: true, broken: false, finished: false, missed: false,
    });
    expect(engine.holdingCount()).toBe(1);
  });

  it('尾判 Miss 离场：finished + missed，头部图标继续下落', () => {
    const chart = chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    run(engine, 1.9, 2.7, (t) => (t < 2 ? [] : t < 2 + FRAME ? [began(1, 2, 2)] : []));
    expect(engine.noteState(chart.roots[0]!.uid)).toMatchObject({
      finished: true, missed: true, holding: false,
    });
  });

  it('漏头僵尸离场同样算 Miss', () => {
    const chart = chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    run(engine, 1.9, 2.7);
    expect(engine.noteState(chart.roots[0]!.uid)).toMatchObject({ finished: true, missed: true });
  });

  it('完全没按：头 Miss 后逐采样 Miss（灰色僵尸）', () => {
    const chart = chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    const events = run(engine, 1.9, 2.6).flatMap((f) => f.events);
    expect(events.map((e) => e.type)).toEqual([0, 0]);
    expect(events[0]!.target).toBe(2);
    expect(events[1]!.holdEnd).toBe(true);
  });

  it('头判用 Hold 分表（0.05 → Great，不是 Single 的 Perfect）', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(1, 0, 5, 0, 5), ['2.5'])]));
    const events = run(engine, 2.05, 2.05, () => [began(1, 2, 2.05)]).flatMap((f) => f.events);
    expect(events[0]!.type).toBe(3);
  });

  it('同时押线哈希：头用 first、尾用 second', () => {
    const chart = chartOf([
      note(1, '2', flags(1, 0, 5, 0, 5), ['3']),
      note(2, '2', flags(1, 10, 15, 10, 15), ['3']),
    ]);
    const engine = new JudgeEngine(chart);
    const events = run(engine, 1.9, 3.1, (t) => {
      if (t < 2) return [];
      if (at(t, 2)) return [began(1, 2, 2)];
      return [stationary(1, 2, t)];
    }).flatMap((f) => f.events);
    const first = events.find((e) => e.head)!;
    const tail = events.find((e) => e.holdEnd)!;
    expect(first.lineHash).toBe(20_000_000);
    expect(tail.lineHash).toBe(30_000_000);
  });
});

/**
 * Hold 尾判与触摸路由，依据 4.12.0 `ManualHoldNotePolicy`（ProcessFinger @0x4AF3BE0 / ProcessView @0x4AF2960 /
 * ProcessTouch @0x4AF3138）与 `NoteResolver.Process` @0x499AFB8：
 * - 尾判成功 = 尾窗口 `Round(diff,3) ∈ [-0.1, 0]` 内收到过 Canceled 以外的触摸（含 Ended）；尾采样点上的命中被丢弃。
 * - 尾 Miss = 尾采样窗口已过且尾窗口内从未收到触摸。
 * - 已起判 Hold 只直通可点范围内的触摸，不认手指；直通不进候选、不参与消费。
 * - `_touched = index != -1 && touchPhase != Canceled`。
 */
describe('Hold 尾判与路由（4.12.0 核对）', () => {
  const hold = (end = '2.5', l = 0, r = 5) => chartOf([note(1, '2', flags(1, l, r, l, r), [end])]);
  const kinds = (events: ReturnType<JudgeEngine['process']>) =>
    events.filter((e) => e.kind === 'judge').map((e) => [e.holdIndex, e.type]);

  /** 头判按下后按住到 `release`，在 `release` 发出 `phase` 的抬起事件。 */
  const pressUntil = (release: number, phase: 'ended' | 'canceled' = 'ended') => (t: number): JudgeTouch[] => {
    if (t < 2) return [];
    if (t < 2 + FRAME) return [began(1, 2, 2)];
    if (at(t, release)) return [{ id: 1, phase, lane: 2, time: t }];
    return t < release ? [stationary(1, 2, t)] : [];
  };

  it('尾窗口内（尾前 0.05 s）松手：尾判 Perfect+', () => {
    const engine = new JudgeEngine(hold());
    const events = run(engine, 1.9, 2.7, pressUntil(2.45)).flatMap((f) => f.events);
    expect(kinds(events)).toEqual([[0, 5], [1, 5]]);
    expect(events[1]).toMatchObject({ holdEnd: true, condition: 0 });
    expect(engine.noteState(1)).toMatchObject({ finished: true, missed: false, broken: false });
  });

  it('只在尾窗口第一帧收到 Ended（尾前 0.1 s）也算尾判成功', () => {
    const engine = new JudgeEngine(hold());
    const events = run(engine, 1.9, 2.7, (t) => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [began(1, 2, 2)];
      return at(t, 2.4) ? [ended(1, 2, 2.4)] : [];
    }).flatMap((f) => f.events);
    expect(kinds(events)).toEqual([[0, 5], [1, 5]]);
  });

  it('尾窗口外（尾前 0.2 s）松手：尾 Miss，而且等到尾采样窗口过了才判', () => {
    const engine = new JudgeEngine(hold());
    const frames = run(engine, 1.9, 2.7, pressUntil(2.3));
    const events = frames.flatMap((f) => f.events);
    expect(kinds(events)).toEqual([[0, 5], [1, 0]]);
    const tailFrame = frames.find((f) => f.events.some((e) => e.holdEnd))!;
    expect(tailFrame.time).toBeGreaterThan(2.5 + 0.0167);
    expect(engine.noteState(1)).toMatchObject({ finished: true, missed: true, broken: true });
  });

  it('尾窗口内只收到 Canceled：不算尾窗口命中，尾 Miss；同一时刻换成 Ended 则成功', () => {
    // Stationary 只发到 2.39（Round(diff,3) = -0.11，窗口外）；窗口内只有 2.42 这一条抬起事件。
    const lift = (phase: 'ended' | 'canceled') => (t: number): JudgeTouch[] => {
      if (t < 2) return [];
      if (t < 2 + FRAME) return [began(1, 2, 2)];
      if (t < 2.39) return [stationary(1, 2, t)];
      return at(t, 2.42) ? [{ id: 1, phase, lane: 2, time: t }] : [];
    };
    const canceled = new JudgeEngine(hold());
    expect(kinds(run(canceled, 1.9, 2.7, lift('canceled')).flatMap((f) => f.events))).toEqual([[0, 5], [1, 0]]);
    const ended = new JudgeEngine(hold());
    expect(kinds(run(ended, 1.9, 2.7, lift('ended')).flatMap((f) => f.events))).toEqual([[0, 5], [1, 5]]);
  });

  it('起判后原手指松手、另一指按在可点范围外：不直通，尾 Miss', () => {
    const engine = new JudgeEngine(hold());
    const events = run(engine, 1.9, 2.7, (t) => {
      const touches = pressUntil(2.1)(t);
      if (t >= 1.95) touches.push(t < 1.95 + FRAME ? began(2, 30, t) : stationary(2, 30, t));
      return touches;
    }).flatMap((f) => f.events);
    expect(kinds(events)).toEqual([[0, 5], [1, 0]]);
  });

  it('起判后原手指松手、另一指按在可点范围内：原版不认手指，照样续到尾判 Perfect+', () => {
    const engine = new JudgeEngine(hold());
    const events = run(engine, 1.9, 2.7, (t) => {
      const touches = pressUntil(2.1)(t);
      if (t >= 2.2) touches.push(t < 2.2 + FRAME ? began(2, 8, t) : stationary(2, 8, t));
      return touches;
    }).flatMap((f) => f.events);
    expect(kinds(events)).toEqual([[0, 5], [1, 5]]);
  });

  it('已起判 Hold 直通不进候选：同一个触摸被更早的 Single 消费时，Hold 仍收到它', () => {
    // Single（Just 1.99，可点 6.5..22.5）排在 Hold（Just 2.0，可点 -5.5..10.5）前面；lane 8 两者都在范围内。
    const chart = chartOf([
      note(1, '1.99', flags(0, 12, 17)),
      note(2, '2', flags(1, 0, 5, 0, 5), ['2.1']),
    ]);
    const engine = new JudgeEngine(chart);
    const events = run(engine, 1.9, 2.3, (t) => {
      if (at(t, 2)) return [began(1, 0, 2)];
      if (at(t, 2 + FRAME)) return [ended(1, 0, t)];
      // 尾窗口 [2.0, 2.1] 内另一指按 lane 8：Single 消费，Hold 经直通记下尾窗口命中。
      if (at(t, 2.05)) return [began(2, 8, t)];
      if (at(t, 2.05 + FRAME)) return [ended(2, 8, t)];
      return [];
    }).flatMap((f) => f.events);
    const single = events.find((e) => e.uid === chart.roots[0]!.uid)!;
    expect(single.type).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.uid === chart.roots[1]!.uid).map((e) => e.type)).toEqual([5, 5]);
  });

  it('按住外观（_touched）：Ended 后保持，Canceled 后熄灭', () => {
    const endedEngine = new JudgeEngine(hold());
    run(endedEngine, 1.9, 2.2, pressUntil(2.1));
    expect(endedEngine.noteState(1).holding).toBe(true);
    expect(endedEngine.holdingCount()).toBe(1);

    const canceledEngine = new JudgeEngine(hold());
    run(canceledEngine, 1.9, 2.2, pressUntil(2.1, 'canceled'));
    expect(canceledEngine.noteState(1).holding).toBe(false);
    expect(canceledEngine.holdingCount()).toBe(0);
  });
});

/** 键盘分区（span）与 Air：预览自有输入，原版只有触摸。 */
describe('键盘分区与 Air', () => {
  const key = (id: number, span: [number, number], time: number, phase: JudgeTouch['phase'] = 'began'): JudgeTouch =>
    ({ id, phase, lane: (span[0] + span[1]) / 2, span, time, keyboard: true });
  const air = (time: number): JudgeTouch => ({ id: 99, phase: 'began', lane: 29.5, time, keyboard: true, air: true });
  const judged = (events: ReturnType<JudgeEngine['process']>) => events.filter((e) => e.kind === 'judge');

  it('分区按区间求交：中心点在可点范围外、区间边缘碰到也算命中；完全不碰则不算', () => {
    // 音符 lane 0..0，可点范围 [-5.5, 5.5]。
    const hit = new JudgeEngine(chartOf([note(1, '2', flags(0, 0, 0))]));
    expect(judged(hit.process(2, [key(1, [5, 13], 2)])).map((e) => e.type)).toEqual([5]);
    const miss = new JudgeEngine(chartOf([note(1, '2', flags(0, 0, 0))]));
    expect(judged(miss.process(2, [key(1, [6, 13], 2)]))).toEqual([]);
  });

  it('同时押排序：距离取区间里离可点范围中点最近的点', () => {
    // A 中点 2.5、B 中点 22.5；区间 [10, 30] 包含 B 的中点（距离 0），离 A 7.5 ⇒ 先给 B。
    const chart = chartOf([note(1, '2', flags(0, 0, 5)), note(2, '2', flags(0, 20, 25))]);
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [10, 30], 2)]));
    expect(events.map((e) => e.uid)).toEqual([chart.roots[1]!.uid]);
    expect(engine.noteState(chart.roots[0]!.uid).phase).toBe('pending');
  });

  it('不开 Air（默认）：键盘起手的 Flick 当帧即完成', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]));
    expect(judged(engine.process(2, [key(1, [8, 14], 2)])).map((e) => [e.type, e.flick])).toEqual([[5, true]]);
  });

  it('开 Air：键盘起手不完成；0.075 s 内按 Air 落账起手判定（Perfect+），Fast/Slow 用起手 diff', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]), { keyboardAir: true });
    expect(judged(engine.process(2.01, [key(1, [8, 14], 2.01)]))).toEqual([]);
    const events = judged(engine.process(2.05, [air(2.05)]));
    expect(events.map((e) => [e.type, e.condition, e.flick])).toEqual([[5, 2, true]]);
  });

  it('开 Air：起手后超过 0.075 s 才按 Air，按原版兜底判 Good', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]), { keyboardAir: true });
    engine.process(2, [key(1, [8, 14], 2)]);
    const late = run(engine, 2 + FRAME, 2.2, (t) => (at(t, 2.1) ? [air(t)] : [])).flatMap((f) => judged(f.events));
    expect(late.map((e) => [e.type, e.condition])).toEqual([[2, 3]]);
  });

  it('Air 不完成指针起手的 Flick（指针仍要真的划动），也不算空点', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12))]), { keyboardAir: true });
    const first = engine.process(2, [began(1, 11, 2, { x: 100, y: 100 })]);
    expect(judged(first)).toEqual([]);
    const events = engine.process(2.03, [air(2.03)]);
    expect(events).toEqual([]);
    const fallback = run(engine, 2.03 + FRAME, 2.2).flatMap((f) => judged(f.events));
    expect(fallback.map((e) => e.type)).toEqual([2]);
  });

  it('Air 一下完成所有仍在窗口内的键盘 Flick；没有起手的 Flick 不受影响', () => {
    const chart = chartOf([note(1, '2', flags(2, 0, 3)), note(2, '2', flags(2, 40, 43)), note(3, '2.3', flags(2, 20, 23))]);
    const engine = new JudgeEngine(chart, { keyboardAir: true });
    engine.process(2, [key(1, [0, 6], 2), key(2, [40, 46], 2)]);
    const events = judged(engine.process(2.04, [air(2.04)]));
    expect(events.map((e) => e.uid).sort()).toEqual([chart.roots[0]!.uid, chart.roots[1]!.uid].sort());
    expect(engine.noteState(chart.roots[2]!.uid).phase).toBe('pending');
  });

  it('只按 Air（上半屏）：不路由到音符、不发空点', () => {
    const engine = new JudgeEngine(chartOf([note(1, '5', flags(0, 0, 5))]), { keyboardAir: true });
    expect(engine.process(1, [{ ...air(1), y: 0 }])).toEqual([]);
  });

  it('setKeyboardAir 切换后对之后的起手生效', () => {
    const engine = new JudgeEngine(chartOf([note(1, '2', flags(2, 10, 12)), note(2, '3', flags(2, 10, 12))]));
    engine.setKeyboardAir(true);
    expect(judged(engine.process(2, [key(1, [8, 14], 2)]))).toEqual([]);
    engine.setKeyboardAir(false);
    const later = run(engine, 2 + FRAME, 3.1, (t) => (at(t, 3) ? [key(2, [8, 14], t)] : [])).flatMap((f) => judged(f.events));
    // 第一条超时兜底 Good，第二条在关掉 Air 后键盘起手即完成。
    expect(later.map((e) => e.type)).toEqual([2, 5]);
  });
});

/** 键盘同按组（chord）：一只手压到相邻几个分区，合起来只按一个音符。 */
describe('键盘同按组', () => {
  const key = (id: number, span: [number, number], time: number, chord?: number): JudgeTouch =>
    ({ id, phase: 'began', lane: (span[0] + span[1]) / 2, span, time, keyboard: true, ...(chord === undefined ? {} : { chord }) });
  const judged = (events: ReturnType<JudgeEngine['process']>) => events.filter((e) => e.kind === 'judge');
  // 2.0 s 一个音符、2.1 s 下一个音符，都在 lane 10..14；两个相邻分区都碰得到。
  const twoNotes = () => chartOf([note(1, '2', flags(0, 10, 14)), note(2, '2.1', flags(0, 10, 14))]);

  it('同组的多余键不去抢后面已进窗口的音符', () => {
    const chart = twoNotes();
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [6, 12], 2, 7), key(2, [12, 18], 2.003, 7)]));
    expect(events.map((e) => e.uid)).toEqual([chart.roots[0]!.uid]);
    expect(engine.noteState(chart.roots[1]!.uid).phase).toBe('pending');
  });

  it('对照：不带 chord 时多余键会提前吃掉下一个音符（这正是要修的问题）', () => {
    const chart = twoNotes();
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [6, 12], 2), key(2, [12, 18], 2.003)]));
    expect(events.map((e) => e.uid)).toEqual([chart.roots[0]!.uid, chart.roots[1]!.uid]);
  });

  it('同时押（|Δ| < 0.004 s）不受限：同组相邻键可以一起按', () => {
    const chart = chartOf([note(1, '2', flags(0, 0, 5)), note(2, '2.002', flags(0, 20, 25))]);
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [0, 10], 2, 3), key(2, [18, 28], 2.001, 3)]));
    expect(events.map((e) => e.uid).sort()).toEqual([chart.roots[0]!.uid, chart.roots[1]!.uid].sort());
  });

  it('同组的多余键不发空点', () => {
    const engine = new JudgeEngine(twoNotes(), { emptyTouch: () => true });
    engine.process(2, [key(1, [6, 12], 2, 9)]);
    // 后一个音符 2.1 s 不在 2.004 s 的同时押窗口内，被组规则挡掉；这一下不算空点。
    const events = engine.process(2.004, [key(2, [12, 18], 2.004, 9)]);
    expect(events.filter((e) => e.kind === 'empty')).toEqual([]);
  });

  it('首键没碰到音符时，组里后按的键照样能命中', () => {
    const chart = chartOf([note(1, '2', flags(0, 30, 32))]);
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [10, 20], 2, 4), key(2, [20, 30], 2.002, 4)]));
    expect(events.map((e) => e.uid)).toEqual([chart.roots[0]!.uid]);
  });

  it('不同组互不限制；同组号过了 1 s 记录作废、可再次消费', () => {
    const chart = twoNotes();
    const engine = new JudgeEngine(chart);
    const events = judged(engine.process(2, [key(1, [6, 12], 2, 1), key(2, [12, 18], 2.003, 2)]));
    expect(events).toHaveLength(2);
    const reuse = new JudgeEngine(chartOf([note(1, '2', flags(0, 10, 14)), note(2, '3.5', flags(0, 10, 14))]));
    expect(judged(reuse.process(2, [key(1, [6, 12], 2, 5)]))).toHaveLength(1);
    const later = run(reuse, 2 + FRAME, 3.6, (t) => (at(t, 3.5) ? [key(2, [6, 12], t, 5)] : [])).flatMap((f) => judged(f.events));
    expect(later.map((e) => e.type)).toEqual([5]);
  });

  it('reset 清掉组记录', () => {
    // 1.0 s 的音符被组 8 消费；1 s 内（未过期）重开后，同组号的键要能按 1.9 s 的音符。
    const chart = chartOf([note(1, '1', flags(0, 40, 44)), note(2, '1.9', flags(0, 10, 14))]);
    const blocked = new JudgeEngine(chart);
    blocked.process(1, [key(1, [38, 46], 1, 8)]);
    expect(judged(blocked.process(1.9, [key(2, [6, 12], 1.9, 8)]))).toEqual([]);
    const engine = new JudgeEngine(chart);
    engine.process(1, [key(1, [38, 46], 1, 8)]);
    engine.reset(1.5);
    expect(judged(engine.process(1.9, [key(2, [6, 12], 1.9, 8)])).map((e) => e.uid)).toEqual([chart.roots[1]!.uid]);
  });

  it('Stationary 不受组限制：同组按住的键照常续 Hold', () => {
    const chart = chartOf([note(1, '2', flags(1, 10, 14, 10, 14), ['2.5'])]);
    const engine = new JudgeEngine(chart);
    const hold = (id: number, t: number): JudgeTouch => ({ id, phase: 'stationary', lane: 9, span: [6, 12], time: t, keyboard: true });
    const frames = run(engine, 2, 2.6, (t) => (at(t, 2) ? [key(1, [6, 12], t, 6), key(2, [12, 18], t, 6)] : [hold(1, t)]));
    const events = frames.flatMap((f) => judged(f.events));
    expect(events.every((e) => e.type !== 0)).toBe(true);
    expect(events.length).toBeGreaterThan(1);
  });
});
