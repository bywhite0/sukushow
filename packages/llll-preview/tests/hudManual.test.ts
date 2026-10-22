import { describe, expect, it } from 'vitest';
import { parseChart, type Chart } from '@sukushow/chart/chart';
import { LiveHud } from '../src/hud';
import { DEFAULT_SCORE_CONFIG, ScoreEngine } from '../src/score';
import { SE_CUE, SeResolver, cueIndexForJudgement, type SeOutput } from '../src/se';
import type { JudgeEvent } from '../src/judge';
import type { NoteJudgementType } from '../src/rgOptions';

/** 记录 SE 输出的假实现（与 tests/se.test.ts 同形）。 */
class FakeOut implements SeOutput {
  plays: { index: number; vol: number; offset?: number }[] = [];
  stops: string[] = [];
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
  pauseHold() {}
  resumeHold() {}
  setTapVolume() {}
  setSeVolume() {}
  dispose() {}
}

function chartOf(times: number[]): Chart {
  return parseChart({
    Notes: times.map((just, i) => ({ Uid: i + 1, just, Flags: 0, holds: [] as number[] })),
    Bpms: [{ Time: 0, Bpm: 120 }],
  });
}

/** 构造一条判定事件；未给的字段取 Single / 判定线正中 / 无 SE 线哈希。 */
function event(over: Partial<JudgeEvent> & { type: NoteJudgementType }): JudgeEvent {
  return {
    kind: 'judge', uid: 1, noteType: 0, condition: 0, time: 1, target: 1, lane: 29.5, width: 1,
    lineHash: 0, hold: false, holdEnd: false, flick: false, head: true, holdIndex: -1, ...over,
  };
}

/** 手动模式 HUD + 独立计分器：同一谱面、同一配置，用于逐条比对分数 / combo。 */
function setup(chart: Chart = chartOf([1, 2, 3])) {
  const out = new FakeOut();
  const hud = new LiveHud();
  hud.setSe(new SeResolver(out));
  hud.setManualPlay(true);
  hud.sync(chart, 0, true);
  const engine = new ScoreEngine(DEFAULT_SCORE_CONFIG);
  engine.reset(chart);
  return { out, hud, chart, engine };
}

describe('LiveHud 手动模式：计分与 combo', () => {
  it('10 条 Perfect 判定后分数 / combo / AP 倍率与逐条 ScoreEngine.add 一致', () => {
    const { hud, chart, engine } = setup();
    for (let i = 1; i <= 10; i++) {
      const t = i * 0.1;
      hud.applyJudgement(event({ type: 4, time: t, target: t }));
      engine.add(4);
      hud.sync(chart, t, true);
      expect(hud.inspect().combo.value).toBe(engine.combo);
      expect(hud.inspect().score.value).toBe(engine.score);
      expect(hud.inspect().apRate.value).toBe(engine.apRate);
    }
    expect(hud.inspect().combo.value).toBe(10);
    expect(hud.inspect().score.value).toBeGreaterThan(0);
  });

  it('Miss 断连、分数不变、不派发 SE', () => {
    const { hud, out } = setup();
    for (let i = 1; i <= 5; i++) hud.applyJudgement(event({ type: 4, time: i * 0.1 }));
    const before = hud.inspect().score.value;
    expect(hud.inspect().combo.value).toBe(5);
    out.plays = [];
    hud.applyJudgement(event({ type: 0, time: 0.6 }));
    expect(hud.inspect().combo.value).toBe(0);
    expect(hud.inspect().score.value).toBe(before);
    expect(hud.inspect().apRate.value).toBe(0);
    expect(out.plays).toEqual([]);
  });

  it('AP 継続：连续 10 Perfect 后特效层可见，一次 Great 后关闭', () => {
    const { hud, chart } = setup();
    for (let i = 1; i <= 10; i++) {
      const t = i * 0.1;
      hud.applyJudgement(event({ type: 4, time: t }));
      hud.sync(chart, t, true);
    }
    expect(hud.inspect().fx.lowerOutline.visible).toBe(true);
    hud.applyJudgement(event({ type: 3, time: 1.05 }));
    hud.sync(chart, 1.05, true);
    expect(hud.inspect().combo.value).toBe(11);
    expect(hud.inspect().fx.lowerOutline.visible).toBe(false);
  });

  it('判定字与 FAST/SLOW 由事件驱动（时间戳取自事件）', () => {
    const { hud, chart } = setup();
    hud.applyJudgement(event({ type: 3, condition: 1, time: 0.1 }));
    hud.sync(chart, 0.1, true);
    const shown = hud.inspect();
    expect(shown.judge.visible).toBe(true);
    expect(shown.judge.sprite).toBe('ui_sc2_ingame_hantei_great');
    // 默认 FastSlowThreshold=Off：FAST/SLOW 不显示。
    expect(shown.condition.visible).toBe(false);

    hud.setFastSlowThreshold(2);
    hud.applyJudgement(event({ type: 3, condition: 1, time: 0.2 }));
    hud.sync(chart, 0.2, true);
    expect(hud.inspect().condition.sprite).toBe('ui_sc2_ingame_hantei_fast');
  });
});

describe('LiveHud 手动模式：SE 派发', () => {
  it('按判定档位取 cue；Flick 走 AddFlick；空点走 AddEmptyTouch', () => {
    const { hud, out } = setup();
    hud.applyJudgement(event({ type: 1 }));
    hud.applyJudgement(event({ type: 2 }));
    hud.applyJudgement(event({ type: 3 }));
    hud.applyJudgement(event({ type: 4 }));
    hud.applyJudgement(event({ type: 5 }));
    hud.applyJudgement(event({ type: 2, noteType: 2, condition: 3, flick: true, lineHash: 7 }));
    hud.applyJudgement(event({ kind: 'empty', uid: -1, noteType: -1, type: 0, head: false, time: 1.1 }));
    expect(out.plays.map((p) => p.index)).toEqual([
      SE_CUE.bad, SE_CUE.good, SE_CUE.great, SE_CUE.perfect, SE_CUE.perfect, SE_CUE.flick, SE_CUE.touch,
    ]);
  });

  it('cueIndexForJudgement 映射不变', () => {
    expect(cueIndexForJudgement(1)).toBe(SE_CUE.bad);
    expect(cueIndexForJudgement(2)).toBe(SE_CUE.good);
    expect(cueIndexForJudgement(3)).toBe(SE_CUE.great);
    expect(cueIndexForJudgement(4)).toBe(SE_CUE.perfect);
    expect(cueIndexForJudgement(5)).toBe(SE_CUE.perfect);
    expect(cueIndexForJudgement(0)).toBe(SE_CUE.perfect);
  });

  it('Hold：头判发判定音、中间航点静音但计分、尾判发 Perfect 音', () => {
    const { hud, out } = setup();
    hud.applyJudgement(event({ type: 4, noteType: 1, hold: true, head: true, holdIndex: 0, lineHash: 11, time: 0.1 }));
    hud.applyJudgement(event({ type: 5, noteType: 1, hold: true, head: false, holdIndex: 1, lineHash: 11, time: 0.2 }));
    hud.applyJudgement(event({ type: 5, noteType: 1, hold: true, head: false, holdEnd: true, holdIndex: 2, lineHash: 22, time: 0.3 }));
    expect(out.plays.map((p) => p.index)).toEqual([SE_CUE.perfect, SE_CUE.perfect]);
    expect(hud.inspect().combo.value).toBe(3);
  });

  it('断链后的 Hold 尾判 Miss 不发声', () => {
    const { hud, out } = setup();
    hud.applyJudgement(event({ type: 0, noteType: 1, hold: true, head: false, holdEnd: true, holdIndex: 1, time: 0.2 }));
    expect(out.plays).toEqual([]);
  });

  it('Hold 持续音：按住数 >0 起播、归零停播', () => {
    const { hud, out, chart } = setup();
    hud.setHoldingHolds(2);
    hud.sync(chart, 0.1, true);
    expect(out.holdStarts).toBe(1);
    hud.setHoldingHolds(0);
    hud.sync(chart, 0.2, true);
    expect(out.holdStops).toBe(1);
  });
});

describe('LiveHud 手动模式：sync 分支', () => {
  it('不按时间累计 AutoPlay 判定 / 分数 / SE', () => {
    const chart = chartOf([0.1, 0.2, 0.3, 0.4]);
    const out = new FakeOut();
    const hud = new LiveHud();
    hud.setSe(new SeResolver(out));
    hud.setManualPlay(true);
    hud.sync(chart, 0, true);
    for (let i = 1; i <= 30; i++) hud.sync(chart, i * 0.05, true);
    expect(hud.inspect().score.value).toBe(0);
    expect(hud.inspect().combo.value).toBe(0);
    expect(out.plays).toEqual([]);
    expect(out.holdStarts).toBe(0);
  });

  it('sync 不按时间差自行重开：大步前进（卡顿 / 后台恢复）与暂停拖动都保留累计，重开只由 resetManual 触发', () => {
    const { hud, chart } = setup();
    for (let i = 1; i <= 5; i++) hud.applyJudgement(event({ type: 4, time: i * 0.1 }));
    const score = hud.inspect().score.value;
    expect(hud.inspect().combo.value).toBe(5);
    // 播放中一帧跨 10 s：不是跳转，状态与判定引擎一样继续累计。
    hud.sync(chart, 10, true);
    hud.sync(chart, 10.05, true);
    expect(hud.inspect().combo.value).toBe(5);
    expect(hud.inspect().score.value).toBe(score);
    // 暂停中时间变化、播放中时间倒退：都只跟随时间，不清零。
    hud.sync(chart, 20, false);
    hud.sync(chart, 3, true);
    expect(hud.inspect().combo.value).toBe(5);
    hud.applyJudgement(event({ type: 4, time: 3.1 }));
    expect(hud.inspect().combo.value).toBe(6);
    // 调用方显式重开：分数与 combo 归零，之后按新时刻继续。
    hud.resetManual(30);
    expect(hud.inspect().combo.value).toBe(0);
    expect(hud.inspect().score.value).toBe(0);
    hud.sync(chart, 30.05, true);
    expect(hud.inspect().combo.value).toBe(0);
  });

  it('换谱：状态归零并清掉已发出的击中音', () => {
    const { hud, out } = setup();
    for (let i = 1; i <= 3; i++) hud.applyJudgement(event({ type: 4, time: i * 0.1 }));
    expect(hud.inspect().combo.value).toBe(3);
    hud.sync(chartOf([5, 6]), 0, true);
    expect(hud.inspect().combo.value).toBe(0);
    expect(hud.inspect().score.value).toBe(0);
    expect(out.stops).toContain('tap');
  });

  it('退出手动后按当前时刻重建 AutoPlay 累计状态', () => {
    const chart = chartOf([0.1, 0.2, 0.3]);
    const hud = new LiveHud();
    hud.setManualPlay(true);
    hud.sync(chart, 0, true);
    hud.applyJudgement(event({ type: 4, time: 0.1 }));
    expect(hud.inspect().combo.value).toBe(1);
    hud.sync(chart, 0.3, true);
    hud.setManualPlay(false);
    expect(hud.inspect().combo.value).toBe(3);
  });
});

describe('LiveHud AutoPlay 路径回归', () => {
  it('未开手动模式时仍按时间累计判定与分数', () => {
    const chart = chartOf([0.1, 0.2, 0.3]);
    const hud = new LiveHud();
    hud.sync(chart, 0, true);
    for (let i = 1; i <= 10; i++) hud.sync(chart, i * 0.05, true);
    expect(hud.inspect().combo.value).toBe(3);
    const engine = new ScoreEngine(DEFAULT_SCORE_CONFIG);
    engine.reset(chart);
    engine.addMany(4, 3);
    expect(hud.inspect().score.value).toBe(engine.score);
  });
});

describe('LiveHud 手动模式：Mental', () => {
  it('Miss 扣 100、Bad 扣 60、Hold 中间航点 Miss 扣 40、Trace Miss 扣 40（TotalMental 1000）', () => {
    const { hud } = setup();
    expect(hud.inspect().mental).toEqual({ value: 1000, max: 1000, red: false });
    hud.applyJudgement(event({ type: 0 }));
    expect(hud.inspect().mental.value).toBe(900);
    hud.applyJudgement(event({ type: 1 }));
    expect(hud.inspect().mental.value).toBe(840);
    hud.applyJudgement(event({ type: 0, noteType: 1, hold: true, head: false, holdEnd: false }));
    expect(hud.inspect().mental.value).toBe(800);
    hud.applyJudgement(event({ type: 0, noteType: 3 }));
    expect(hud.inspect().mental.value).toBe(760);
  });

  it('扣到 0 不失败：分数冻结、combo 仍累计、技术分归零、血条转红', () => {
    const { hud } = setup();
    hud.setTechnicalScoreDisplay(1);
    for (let i = 1; i <= 10; i++) hud.applyJudgement(event({ type: 0, time: i * 0.1 }));
    expect(hud.inspect().mental).toEqual({ value: 0, max: 1000, red: true });
    const frozen = hud.inspect().score.value;
    hud.applyJudgement(event({ type: 4, time: 1.1 }));
    const after = hud.inspect();
    expect(after.combo.value).toBe(1);
    expect(after.score.value).toBe(frozen);
    expect(after.tech).toBe('0.0000 %');
  });

  it('重开（resetManual）恢复满血', () => {
    const { hud } = setup();
    for (let i = 1; i <= 5; i++) hud.applyJudgement(event({ type: 0 }));
    expect(hud.inspect().mental.value).toBe(500);
    hud.resetManual(0);
    expect(hud.inspect().mental).toEqual({ value: 1000, max: 1000, red: false });
  });
});

describe('LiveHud 手动模式：ComboFlags（曲终横幅档位）', () => {
  it('全 Perfect 判 Perfect+ → AllPerfect|FullCombo（3）', () => {
    const { hud } = setup();
    expect(hud.liveComboFlags).toBe(3); // 一条判定都没有时 0 == 0 也算 AP（原版 GetComboFlags）
    for (let i = 0; i < 10; i++) hud.applyJudgement(event({ type: 4, time: i * 0.1 }));
    expect(hud.liveComboFlags).toBe(3);
  });

  it('Great 只断 AllPerfect，不断 FullCombo', () => {
    const { hud } = setup();
    for (let i = 0; i < 10; i++) hud.applyJudgement(event({ type: 4, time: i * 0.1 }));
    hud.applyJudgement(event({ type: 3, time: 1.05 }));
    expect(hud.liveComboFlags).toBe(2);
  });

  it('Bad / Miss 断 FullCombo', () => {
    const { hud } = setup();
    hud.applyJudgement(event({ type: 4, time: 0.1 }));
    hud.applyJudgement(event({ type: 1, time: 0.2 }));
    expect(hud.liveComboFlags).toBe(0);
    hud.applyJudgement(event({ type: 0, time: 0.3 }));
    expect(hud.liveComboFlags).toBe(0);
  });

  it('重开后回到未判定状态', () => {
    const { hud } = setup();
    hud.applyJudgement(event({ type: 0, time: 0.1 }));
    expect(hud.liveComboFlags).toBe(0);
    hud.resetManual(0);
    expect(hud.liveComboFlags).toBe(3);
  });
});
