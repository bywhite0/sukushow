import { describe, expect, it } from 'vitest';
import { CapturingSeOutput, SE_CUE, SeResolver, seBusFor } from '../src/se';
import { fnv1a, lcg, mixSeed } from '../src/rng';

describe('CapturingSeOutput', () => {
  it('按 now 记录单发音，gain = 事件音量 × 所在总线音量', () => {
    const out = new CapturingSeOutput({ tapVolume: 0.5, seVolume: 0.8 });
    const se = new SeResolver(out);
    out.now = 1.25;
    se.process();
    se.addSingle(0, 0);
    se.playFinish(0);
    expect(out.events).toEqual([
      { type: 'oneShot', key: String(SE_CUE.perfect), gain: 0.5, startSec: 1.25, endSec: Infinity, offsetSec: 0 },
      { type: 'oneShot', key: String(SE_CUE.finish4), gain: 0.8, startSec: 1.25, endSec: Infinity, offsetSec: 0 },
    ]);
  });

  it('同一 line hash 在后续两帧内 ×1.5（SeResolver 3 帧窗口）', () => {
    const out = new CapturingSeOutput({ tapVolume: 1, seVolume: 1 });
    const se = new SeResolver(out);
    se.process(); se.addSingle(0, 7);
    se.process(); se.addSingle(0, 7);
    se.process(); se.process(); se.process(); se.addSingle(0, 7);
    expect(out.events.map((e) => e.gain)).toEqual([1, 1.5, 1]);
  });

  it('hold 循环按帧尾 applyHold 开始 / 结束，finish 截断仍在响的段', () => {
    const out = new CapturingSeOutput({ tapVolume: 0.6, seVolume: 1 });
    const se = new SeResolver(out);
    out.now = 2; se.process(); se.addHold(); se.applyHold();
    out.now = 2.5; se.process(); se.addHold(); se.applyHold();
    out.now = 3; se.process(); se.applyHold();
    out.now = 4; se.process(); se.addHold(); se.applyHold();
    out.finish(4.5);
    expect(out.events).toEqual([
      { type: 'loop', key: String(SE_CUE.hold), gain: 0.6, startSec: 2, endSec: 3, offsetSec: 0 },
      { type: 'loop', key: String(SE_CUE.hold), gain: 0.6, startSec: 4, endSec: 4.5, offsetSec: 0 },
    ]);
  });

  it('跳转只截断 tap 总线；开场 SE 带素材偏移；缺失的 cue 不记录', () => {
    const out = new CapturingSeOutput({ tapVolume: 1, seVolume: 1, hasCue: (i) => i !== SE_CUE.flick });
    const se = new SeResolver(out);
    out.now = -3; se.playStart(0.4);
    out.now = 0.5; se.process(); se.addSingle(0, 0); se.addFlick(0);
    out.now = 0.6; se.clear();
    expect(out.events).toHaveLength(2);
    expect(out.events[0]).toMatchObject({ key: String(SE_CUE.start), offsetSec: 0.4, endSec: Infinity });
    expect(out.events[1]).toMatchObject({ key: String(SE_CUE.perfect), endSec: 0.6 });
    expect(seBusFor(SE_CUE.start)).toBe('se');
    expect(seBusFor(SE_CUE.hold)).toBe('tap');
  });
});

describe('rng', () => {
  it('同种子序列一致，不同种子不同', () => {
    const a = lcg(mixSeed(fnv1a('hit'), 3, 1.5));
    const b = lcg(mixSeed(fnv1a('hit'), 3, 1.5));
    const c = lcg(mixSeed(fnv1a('hit'), 4, 1.5));
    const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) expect(v >= 0 && v < 1).toBe(true);
  });
});
