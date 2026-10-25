import { describe, expect, it } from 'vitest';
import { ResultScreen, type ResultSnapshot } from '../src/resultScreen';
import { formatScore, formatTechnical, technicalGoal } from '../src/resultScreenFormat';

/**
 * 结算界面状态机的单元测试（不画像素：open/tick/skip 全在纯状态上推进）。
 *
 * 时间轴与判定口径见 docs/evidence.md「结算界面」：
 * 标题 2.4167 s → 滑入 0.1*(n+1)+0.5 → 分数 0.5 → 技术分 0.5 → 6 行判定 0.2×6 →
 * combo 0.3 → 条件 0.2×3 → 旗标前等待 0.5 → 旗标 clip 0.7 → 灯 clip 0.7 → 按钮。
 */

const PATH = {
  score: 'UserRecordContent(A)/ScorePanel/ScoreContent/Number-Score',
  technical: 'UserRecordContent(A)/ScorePanel/TechnicalScoreContent/Number-TechnicalScore',
  judgement: [
    'UserRecordContent(A)/JudgementPanel/PerfectPlusContent/Number-PerfectPlus',
    'UserRecordContent(A)/JudgementPanel/PerfectContent/Number-Perfect',
    'UserRecordContent(A)/JudgementPanel/GreatContent/Number-Great',
    'UserRecordContent(A)/JudgementPanel/GoodContent/Number-Good',
    'UserRecordContent(A)/JudgementPanel/BadContent/Number-Bad',
    'UserRecordContent(A)/JudgementPanel/MissContent/Number-Miss',
  ],
  fastSlow: 'UserRecordContent(A)/JudgementPanel/FastSlowContent',
  comboEffect: 'UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot',
  flag: 'UserRecordContent(A)/JudgementPanel/ComboContent/ComboEffectRoot/Image/Text-APFC',
  rate: 'UserRecordContent(A)/JudgementPanel/RateContent',
  playerRate: 'UserRecordContent(A)/JudgementPanel/PlayerRateContent',
  rank: 'TitleContent/RhythmGameScoreRankIcon/White/RankColor/RankName',
  nextButton: 'UserRecordContent(A)/NextButton',
  nextText: 'UserRecordContent(A)/NextButton/Text',
} as const;

const snapshot = (over: Partial<ResultSnapshot> = {}): ResultSnapshot => ({
  score: 123_456_789,
  technicalRaw: 5_123,
  userCombo: 456,
  judgements: [2, 3, 4, 5, 6, 7],
  conditions: [8, 9, 10],
  comboFlags: 3,
  remainMental: 700,
  scoreRank: 4,
  musicTitle: 'タイトル',
  difficulty: 'EXPERT',
  difficultyId: 3,
  difficultyLevel: 27,
  totalNoteCount: 1000,
  enableFastSlow: true,
  oldClearLamps: [0, 0, 0, 0],
  jacketUrl: null,
  ...over,
});

const run = (screen: ResultScreen, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) screen.tick(dt);
};

describe('ResultScreen 编排', () => {
  it('无冻帧：标题 → 滑入 → 计数 → 旗标 / 灯 → 按钮，终值取实际成绩', () => {
    const screen = new ResultScreen();
    screen.open(snapshot());
    expect(screen.visible).toBe(true);
    expect(screen.currentPhase).toBe('title');
    expect(screen.activeOf(PATH.rate)).toBe(false);
    expect(screen.activeOf(PATH.playerRate)).toBe(false);
    run(screen, 12);
    expect(screen.done).toBe(true);
    expect(screen.currentPhase).toBe('done');
    expect(screen.textOf(PATH.score)).toBe(formatScore(123_456_789));
    expect(screen.textOf(PATH.technical)).toBe(formatTechnical(technicalGoal(5_123, 1000)));
    // 行序 PP→Miss，数据索引 Miss→PP 反序。
    expect(screen.textOf(PATH.judgement[0])).toBe('7');
    expect(screen.textOf(PATH.judgement[1])).toBe('6');
    expect(screen.textOf(PATH.judgement[5])).toBe('2');
    expect(screen.textOf(PATH.flag)).toBe('ALL PERFECT');
    expect(screen.textOf(PATH.rank)).toBe('S');
    expect(screen.textOf(PATH.nextText)).toBe('再玩一次');
    expect(screen.activeOf(PATH.comboEffect)).toBe(true);
    expect(screen.activeOf(PATH.nextButton)).toBe(true);
  });

  it('标题阶段禁止跳过，内容段跳过后计数直达目标值', () => {
    const screen = new ResultScreen();
    screen.open(snapshot());
    screen.skip();
    expect(screen.done).toBe(false);
    expect(screen.currentPhase).toBe('title');
    run(screen, 3.2); // 已过标题（2.4167 s），处在滑入段
    expect(screen.done).toBe(false);
    screen.skip();
    expect(screen.done).toBe(true);
    expect(screen.currentPhase).toBe('done');
    expect(screen.textOf(PATH.score)).toBe(formatScore(123_456_789));
    expect(screen.textOf(PATH.judgement[0])).toBe('7');
    expect(screen.activeOf(PATH.nextButton)).toBe(true);
  });

  it('键盘：演出中 Space 跳过，完成后 Enter 重玩、Esc 退出', () => {
    const screen = new ResultScreen();
    screen.open(snapshot());
    expect(screen.key('Space')).toBeNull();
    run(screen, 3.2);
    expect(screen.key('Space')).toBe('skip');
    expect(screen.done).toBe(true);
    expect(screen.key('Enter')).toBe('retry');
    expect(screen.key('Escape')).toBe('exit');
  });

  it('FAST/SLOW 关闭：隐藏面板，Conditions 段不出现', () => {
    const screen = new ResultScreen();
    screen.open(snapshot({ enableFastSlow: false, conditions: [0, 0, 0] }));
    expect(screen.activeOf(PATH.fastSlow)).toBe(false);
    run(screen, 12);
    expect(screen.done).toBe(true);
    // 关闭时不播条件段，三个数字保持初始 0。
    expect(screen.textOf('UserRecordContent(A)/JudgementPanel/FastSlowContent/Horizontal/Root1/Number-Fast')).toBe('0');
  });

  it('提供 Rate / PlayerRate 数据时显示两块并计数到目标值', () => {
    const screen = new ResultScreen();
    screen.open(snapshot({ rate: 300, playerRate: 10_000, rateIncrease: 50, playerRateIncrease: 20 }));
    expect(screen.activeOf(PATH.rate)).toBe(true);
    expect(screen.activeOf(PATH.playerRate)).toBe(true);
    run(screen, 12);
    expect(screen.textOf('UserRecordContent(A)/JudgementPanel/RateContent/Number-Rate')).toBe('300');
    expect(screen.textOf('UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRate')).toBe('10000');
    // Increase 行只在 GoalValue >= 1 时出现（§3 第 8/10 步）。
    expect(screen.activeOf('UserRecordContent(A)/JudgementPanel/RateContent/Number-RateIncrease')).toBe(true);
    expect(screen.textOf('UserRecordContent(A)/JudgementPanel/RateContent/Number-RateIncrease')).toBe('(+50)');
    expect(screen.activeOf('UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRateIncrease')).toBe(true);
    expect(screen.textOf('UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRateIncrease')).toBe('(+20)');
  });

  it('已有 Rate 没有提升时，两条 Increase 行保持隐藏', () => {
    const screen = new ResultScreen();
    screen.open(snapshot({ rate: 300, playerRate: 10_000 }));
    run(screen, 12);
    expect(screen.activeOf('UserRecordContent(A)/JudgementPanel/RateContent/Number-RateIncrease')).toBe(false);
    expect(screen.activeOf('UserRecordContent(A)/JudgementPanel/PlayerRateContent/Number-PlayerRateIncrease')).toBe(false);
  });

  it('FullCombo 成绩显示 FULL COMBO', () => {
    const fc = new ResultScreen();
    fc.open(snapshot({ comboFlags: 2 }));
    expect(fc.textOf(PATH.flag)).toBe('FULL COMBO');
  });
});
