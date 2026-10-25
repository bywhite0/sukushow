import { test, expect, type Page } from '@playwright/test';

/**
 * 结算界面（RhythmGameResultScene / level57）集成测试。
 *
 * 范围：只在游玩模式、曲终横幅（4 s clip）播完后出现；分数 / 技术分 / 判定计数 /
 * 最大 combo / 曲终旗标都取本局实际成绩；跳过、重玩与退出按钮生效；AutoPlay 预览不进入结算。
 */

// 结算包含曲终横幅与标题演出，重玩用例会走两次场景切换。
test.describe.configure({ timeout: 120_000 });

const RECORD = 'UserRecordContent(A)';
const PATH = {
  score: `${RECORD}/ScorePanel/ScoreContent/Number-Score`,
  technical: `${RECORD}/ScorePanel/TechnicalScoreContent/Number-TechnicalScore`,
  judgement: [
    `${RECORD}/JudgementPanel/PerfectPlusContent/Number-PerfectPlus`,
    `${RECORD}/JudgementPanel/PerfectContent/Number-Perfect`,
    `${RECORD}/JudgementPanel/GreatContent/Number-Great`,
    `${RECORD}/JudgementPanel/GoodContent/Number-Good`,
    `${RECORD}/JudgementPanel/BadContent/Number-Bad`,
    `${RECORD}/JudgementPanel/MissContent/Number-Miss`,
  ],
  fastSlow: `${RECORD}/JudgementPanel/FastSlowContent`,
  flag: `${RECORD}/JudgementPanel/ComboContent/ComboEffectRoot/Image/Text-APFC`,
  rank: 'TitleContent/RhythmGameScoreRankIcon/White/RankColor/RankName',
  nextText: `${RECORD}/NextButton/Text`,
};

const setTime = (page: Page, v: number) =>
  page.locator('#timeline').evaluate((e: HTMLInputElement, value: number) => {
    e.value = String(value);
    e.dispatchEvent(new Event('input'));
  }, v);

const loadReady = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
};

/** 侧栏「FAST/SLOW 显示」= Perfect 以下 时，结算才显示 FAST / SLOW / FLICK 面板。 */
const enableFastSlow = (page: Page) =>
  page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>('#opt-fast-slow');
    if (!select) throw new Error('缺少 #opt-fast-slow');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

/** 直接向 HUD 送一条判定（绕过输入层，构造确定的成绩）。 */
const injectJudge = (page: Page, type: number, over: Record<string, unknown> = {}) =>
  page.evaluate((arg: { type: number; over: Record<string, unknown> }) => {
    const hud = (window as unknown as { __LPW__: { hud: any } }).__LPW__.hud;
    hud.applyJudgement({
      kind: 'judge', uid: 1, noteType: 0, condition: 0, time: 1, target: 1, lane: 29.5, width: 1,
      lineHash: 0, hold: false, holdEnd: false, flick: false, head: true, holdIndex: -1,
      ...arg.over, type: arg.type,
    });
  }, { type, over });

/** 进入游玩模式并跳到曲终前的空窗（末音符之后、FinishTime 之前），返回 FinishTime。 */
async function startPlayModeNearEnd(page: Page, fastSlow = false): Promise<number> {
  await loadReady(page);
  if (fastSlow) await enableFastSlow(page);
  const info = await page.evaluate(() => {
    const lpw = (window as unknown as { __LPW__: { chart: any; finishTime: number } }).__LPW__;
    let last = 0;
    for (const root of lpw.chart.roots as any[]) {
      let tail = root;
      while (tail.next) tail = tail.next;
      last = Math.max(last, tail.end as number);
    }
    return { last, finish: lpw.finishTime };
  });
  expect(info.finish).toBeGreaterThan(info.last);
  await page.locator('#play-mode').click();
  await setTime(page, Math.max(info.last + 0.05, info.finish - 0.4));
  return info.finish;
}

const resultVisible = (page: Page) =>
  page.evaluate(() => !!(window as unknown as { __LPW__: any }).__LPW__.resultScreen?.visible);
const resultDone = (page: Page) =>
  page.evaluate(() => !!(window as unknown as { __LPW__: any }).__LPW__.resultScreen?.done);
const resultPhase = (page: Page) =>
  page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.resultScreen?.currentPhase as string | null);
const resultSnapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.resultScreen?.currentSnapshot);
const resultText = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __LPW__: any }).__LPW__.resultScreen?.textOf(p) as string | null, path);
const resultActive = (page: Page, path: string) =>
  page.evaluate((p) => (window as unknown as { __LPW__: any }).__LPW__.resultScreen?.activeOf(p) as boolean | null, path);

/** CountupScore 的期望文本（12 位零填充 + 千分位；前导零的淡色标签单独剥离）。 */
function expectedScore(v: number): string {
  return Math.max(0, Math.trunc(v)).toString().padStart(12, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
/** CountupTechnicalScore 的期望文本（'000.0000'+'%'，整数部不足 3 位补零；前导零的淡色标签单独剥离）。 */
function expectedTechnical(raw: number, total: number): string {
  const goal = total > 0 ? Math.trunc((raw / total) * 10000) : 0;
  const [int, frac] = (goal / 10000).toFixed(4).split('.');
  return `${(int ?? '0').padStart(3, '0')}.${frac ?? '0000'}%`;
}
const stripTags = (v: string | null) => (v ?? '').replace(/<[^>]*>/g, '');

/** 点击结算画布上的按钮（结果界面画在舞台合成画布上，没有 DOM 节点）。 */
async function clickResultButton(page: Page, which: 'retry' | 'exit') {
  // 跳过与按钮共用 0.3 s 点击节流；按实际场景关闭结果等待可操作时刻。
  await expect(async () => {
    const point = await page.evaluate((w) => {
      const lpw = (window as unknown as { __LPW__: any }).__LPW__;
      const rect = document.querySelector('#stage-canvas')!.getBoundingClientRect();
      const b = lpw.resultScreen.buttons[w];
      return { x: rect.left + b.x + b.w / 2, y: rect.top + b.y + b.h / 2 };
    }, which);
    await page.mouse.click(point.x, point.y);
    expect(await resultVisible(page)).toBe(false);
  }).toPass({ timeout: 5_000 });
}

async function skipResultAnimation(page: Page) {
  // 标题结束后 blocker 才激活，使用真实画布点击验证事件接线。
  await expect.poll(async () => {
    const phase = await resultPhase(page);
    return phase !== 'reveal' && phase !== 'title';
  }, { timeout: 15_000 }).toBe(true);
  const canvas = page.locator('#stage-canvas');
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect.poll(() => resultDone(page), { timeout: 5_000 }).toBe(true);
}

test('结算：横幅结束后进入，分数 / 技术分 / 判定 / 最大连击 / 曲终旗标取本局实际成绩', async ({ page }) => {
  await startPlayModeNearEnd(page, true);
  for (let i = 0; i < 20; i += 1) await injectJudge(page, 4, { condition: i % 2 ? 1 : 2 });
  await injectJudge(page, 5);
  await injectJudge(page, 5);
  // Flick 桶只数「起手成功但划动未完成」的兜底 Good（condition=Flick=3），不是 Flick 音符总数。
  await injectJudge(page, 2, { condition: 3, flick: true, noteType: 2 });

  await expect.poll(() => resultVisible(page), { timeout: 20_000 }).toBe(true);
  const snapshot = await resultSnapshot(page);
  expect(snapshot.score).toBeGreaterThan(0);
  expect(snapshot.userCombo).toBe(23);
  // 兜底 Good 让本局成为 FullCombo（不是 AllPerfect）。
  expect(snapshot.comboFlags).toBe(2);
  // 默认曲目的 Musics.SongType（曲目类型图标 icon_song_type_1）。
  expect(snapshot.songType).toBe(1);
  // UnderPerfect：Perfect 及以下才标 FAST/SLOW，Perfect+ 不计；FLICK 只计兜底 Good 一条。
  expect(snapshot.conditions).toEqual([10, 10, 1]);

  await expect.poll(() => resultDone(page), { timeout: 25_000 }).toBe(true);
  // 段位表：0 None→D、1 C、2 B、3 A、4 S（ChangeAchievementStatusToText）。
  expect(await resultText(page, PATH.rank)).toBe(['D', 'C', 'B', 'A', 'S'][snapshot.scoreRank]);
  expect(await resultText(page, PATH.flag)).toBe('FULL COMBO');
  expect(stripTags(await resultText(page, PATH.score))).toBe(expectedScore(snapshot.score));
  expect(stripTags(await resultText(page, PATH.technical))).toBe(expectedTechnical(snapshot.technicalRaw, snapshot.totalNoteCount));
  expect(await resultText(page, PATH.judgement[0])).toBe('2');   // Perfect+
  expect(await resultText(page, PATH.judgement[1])).toBe('20'); // Perfect
  expect(await resultText(page, PATH.judgement[2])).toBe('0');  // Great
  expect(await resultText(page, PATH.judgement[3])).toBe('1');  // Good（Flick 兜底）
  expect(await resultText(page, PATH.judgement[4])).toBe('0');  // Bad
  expect(await resultText(page, PATH.judgement[5])).toBe('0');  // Miss
  expect(await resultText(page, PATH.nextText)).toBe('再玩一次');
  expect(await resultActive(page, PATH.fastSlow)).toBe(true);
  // Rate / PlayerRate：本地成绩库 + masterdata（Level/MaxCombo）按 4.12.0 公式算；首局从 0 提升。
  expect(snapshot.rate).toBeGreaterThan(0);
  expect(snapshot.rateIncrease).toBe(snapshot.rate);
  expect(snapshot.playerRate).toBe(snapshot.rate);
  expect(snapshot.playerRateIncrease).toBe(snapshot.rate);
  expect(await resultActive(page, `${RECORD}/JudgementPanel/RateContent`)).toBe(true);
  expect(await resultActive(page, `${RECORD}/JudgementPanel/PlayerRateContent`)).toBe(true);
  expect(await resultText(page, `${RECORD}/JudgementPanel/RateContent/Number-Rate`)).toBe(String(snapshot.rate));
  expect(await resultText(page, `${RECORD}/JudgementPanel/RateContent/Number-RateIncrease`)).toBe(`(+${snapshot.rate})`);
  expect(await resultText(page, `${RECORD}/JudgementPanel/PlayerRateContent/Number-PlayerRate`)).toBe(String(snapshot.playerRate));
  expect(await resultText(page, `${RECORD}/JudgementPanel/PlayerRateContent/Number-PlayerRateIncrease`)).toBe(`(+${snapshot.playerRate})`);
  // 本地成绩库按「曲目 ID:难度」分行，不能把不同曲目写进同一个键。
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('sukushow:result-records:v1')!).history);
  expect(Object.keys(rows)).toEqual(['103103:MASTER']);
  expect(rows['103103:MASTER']).toHaveLength(1);
  expect(rows['103103:MASTER'][0]).toMatchObject({
    score: snapshot.score, technical: snapshot.technicalRaw, judgements: snapshot.judgements,
    userCombo: snapshot.userCombo,
    technicalPercent: Math.trunc(snapshot.technicalRaw / snapshot.totalNoteCount * 10000) / 10000,
    recordedAt: expect.any(Number),
    judgementConditions: [[0, 0, 0], [0, 0, 0], [0, 0, 1], [0, 0, 0], [10, 10, 0], [0, 0, 0]],
    cleared: true,
  });
});

test('关闭 FAST/SLOW 的结算支持点击跳过、重玩和退出', async ({ page }) => {
  const finish = await startPlayModeNearEnd(page);
  for (let i = 0; i < 5; i += 1) await injectJudge(page, 4);
  await expect.poll(() => resultVisible(page), { timeout: 20_000 }).toBe(true);
  await skipResultAnimation(page);
  const snapshot = await resultSnapshot(page);
  expect(snapshot.enableFastSlow).toBe(false);
  expect(snapshot.conditions).toEqual([0, 0, 0]);
  expect(await resultActive(page, PATH.fastSlow)).toBe(false);
  expect(stripTags(await resultText(page, PATH.score))).toBe(expectedScore(snapshot.score));
  expect(await resultText(page, PATH.judgement[1])).toBe('5');

  await clickResultButton(page, 'retry');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.playMode), { timeout: 5_000 }).toBe(true);
  // 重玩 = 重新进入游玩模式：从走带起点开播（含开场过场时是负时刻）。
  await expect.poll(async () => page.evaluate(() => {
    const transport = (window as unknown as { __LPW__: any }).__LPW__.player.transport;
    return transport.playing && transport.time < transport.start + 2;
  }), { timeout: 10_000 }).toBe(true);

  // 再进一次结算，点退出按钮：回到 AutoPlay 预览。
  await setTime(page, finish - 0.4);
  await expect.poll(() => resultVisible(page), { timeout: 20_000 }).toBe(true);
  await skipResultAnimation(page);
  await clickResultButton(page, 'exit');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.playMode), { timeout: 5_000 }).toBe(false);
  await expect(page.locator('#play-mode')).toHaveAttribute('aria-pressed', 'false');
});

test('AutoPlay 预览不进入结算：跳到曲终之后仍只播曲终横幅', async ({ page }) => {
  await loadReady(page);
  const finish = await page.evaluate(() => (window as unknown as { __LPW__: { finishTime: number } }).__LPW__.finishTime);
  await setTime(page, finish + 4);
  await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-time'))).toBeGreaterThan(finish + 3.9);
  expect(await resultVisible(page)).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.playMode)).toBe(false);
});

test('未 clear（mental 归零）：结算技术分显示 0，历史保留实际成绩且不提升 Rate', async ({ page }) => {
  await startPlayModeNearEnd(page);
  for (let i = 0; i < 20; i += 1) await injectJudge(page, 4);
  // 连续 Miss 把 Mental 扣到 0（1000 上限，Miss 每条约 100）。
  const mental = await page.evaluate(() => {
    const lpw = (window as unknown as { __LPW__: any }).__LPW__;
    const hud = lpw.hud;
    let n = 0;
    while (hud.liveMental > 0 && n < 100) {
      hud.applyJudgement({
        kind: 'judge', uid: 1, noteType: 0, condition: 0, time: 1, target: 1, lane: 29.5, width: 1,
        lineHash: 0, hold: false, holdEnd: false, flick: false, head: true, holdIndex: -1, type: 0,
      });
      n += 1;
    }
    return { mental: hud.liveMental, n };
  });
  expect(mental.mental).toBe(0);
  expect(mental.n).toBeLessThan(100);
  await expect.poll(() => resultVisible(page), { timeout: 20_000 }).toBe(true);
  const snapshot = await resultSnapshot(page);
  expect(snapshot.remainMental).toBe(0);
  // 原版 RhythmGameResultSceneParam.TechnicalScore = mental > 0 ? raw : 0。
  expect(snapshot.technicalRaw).toBe(0);

  await skipResultAnimation(page);
  expect(stripTags(await resultText(page, PATH.technical))).toBe('000.0000%');
  // Rate 面板仍显示旧记录（这里没有记录 → 0），Increase 行不出现。
  expect(await resultActive(page, `${RECORD}/JudgementPanel/RateContent`)).toBe(true);
  expect(await resultText(page, `${RECORD}/JudgementPanel/RateContent/Number-Rate`)).toBe('0');
  expect(await resultActive(page, `${RECORD}/JudgementPanel/RateContent/Number-RateIncrease`)).toBe(false);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('sukushow:result-records:v1')!).history['103103:MASTER']);
  expect(history).toHaveLength(1);
  expect(history[0].cleared).toBe(false);
  expect(history[0].technical).toBeGreaterThan(0);
  expect(history[0].judgements[0]).toBe(mental.n);
});
