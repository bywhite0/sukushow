import { test, expect, type Page } from '@playwright/test';
import { hudInfo, resultInfo } from './lpwHook';

/**
 * 游玩模式（手动判定）集成测试。
 *
 * 判定窗口来自 4.12.0：Single 可点范围 = 音符左右各 5.5 lane，命中窗口 ±0.125 s。
 * 这里用默认歌曲谱面里第一个「键盘键位落在可点范围内」的 Single 音符做受控输入，
 * 断言 HUD 的 combo / score 由手动判定驱动，而不是 AutoPlay 重放。
 */

type NoteInfo = { uid: number; time: number; lane: number; key: string };

/**
 * 默认键位：九区 A S D F G H J K L（`playKeys.ts` 的 `DEFAULT_PLAY_KEY_LAYOUT`），区中心以 lane 29.5 为中心、
 * 间距 20/3 轨（= SIF 视图 9 等分的中线）。按键触碰整个分区，这里取区中心挑音符，保证落在可点范围内。
 */
const KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'];
const LANES = KEYS.map((_, i) => 29.5 + (i - 4) * (20 / 3));

/** 找一个能用键盘打到的 Single 音符（某个键位 lane 落在音符可点范围内）。 */
async function pickKeyboardNote(page: Page): Promise<NoteInfo | null> {
  return page.evaluate((arg: { keys: string[]; lanes: number[] }) => {
    const chart = (window as unknown as { __LPW__: { chart: any } }).__LPW__.chart;
    for (const note of chart.roots as { uid: number; type: number; time: number; l: number; r: number }[]) {
      if (note.type !== 0) continue;
      const center = (note.l + note.r) / 2;
      const index = arg.lanes.findIndex((lane) => Math.abs(center - lane) <= 4);
      if (index >= 0 && note.time > 1.5 && note.time < 20) {
        return { uid: note.uid, time: note.time, lane: arg.lanes[index]!, key: arg.keys[index]! };
      }
    }
    return null;
  }, { keys: KEYS, lanes: LANES }) as Promise<NoteInfo | null>;
}

const setTime = (page: Page, v: number) =>
  page.locator('#timeline').evaluate((e: HTMLInputElement, value: number) => {
    e.value = String(value);
    e.dispatchEvent(new Event('input'));
  }, v);

/** 等 n 个动画帧。 */
const nextFrames = (page: Page, count = 2) =>
  page.evaluate((n: number) => new Promise<void>((resolve) => {
    let left = n;
    const step = (): void => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), count);

const judgeState = (page: Page, uid: number) =>
  page.evaluate((id: number) => (window as unknown as { __LPW__: { judge: any } }).__LPW__.judge?.noteState(id), uid);

/** 找一个键盘能打到头部、且链尾至少还有 0.5 s 的 Hold（取链最长的一条，给松手留观察窗口）。 */
async function pickKeyboardHold(page: Page): Promise<{ uid: number; time: number; end: number; lane: number; key: string } | null> {
  return page.evaluate((arg: { keys: string[]; lanes: number[] }) => {
    const chart = (window as unknown as { __LPW__: { chart: any } }).__LPW__.chart;
    let best: { uid: number; time: number; end: number; lane: number; key: string } | null = null;
    for (const note of chart.roots as any[]) {
      if (note.type !== 1) continue;
      let tail = note;
      while (tail.next) tail = tail.next;
      const center = (note.l + note.r) / 2;
      const index = arg.lanes.findIndex((lane) => Math.abs(center - lane) <= 4);
      if (index < 0 || note.time <= 1.5 || note.time >= 12 || tail.end >= 20) continue;
      if (tail.end - note.time < 0.5) continue;
      const candidate = { uid: note.uid, time: note.time, end: tail.end, lane: arg.lanes[index]!, key: arg.keys[index]! };
      if (!best || tail.end - note.time > best.end - best.time) best = candidate;
    }
    return best;
  }, { keys: KEYS, lanes: LANES }) as Promise<{ uid: number; time: number; end: number; lane: number; key: string } | null>;
}

const zoneKeys = (page: Page) => page.locator('#panel-track [data-play-zone]');

test('游玩键位：默认九区 A–L、Air 为空格', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-inspector-toggle]').click();
  await expect(page.locator('#play-zones')).toHaveValue('9');
  await expect(zoneKeys(page)).toHaveText(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L']);
  await expect(page.locator('#panel-track [data-play-air]')).toHaveText('空格');
  await expect(page.locator('#play-chord')).toHaveValue('30');
});

test('同按合并窗口：改值即生效并在刷新后保留，越界给提示且不改值，恢复默认回到 30', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-inspector-toggle]').click();
  const chord = page.locator('#play-chord');
  await chord.fill('50');
  await chord.dispatchEvent('change');
  await page.reload();
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-inspector-toggle]').click();
  await expect(chord).toHaveValue('50');

  await chord.fill('120');
  await chord.dispatchEvent('change');
  await expect(chord).toHaveValue('50');
  await expect(page.locator('#message')).toHaveText(/同按合并需是 0 至 80/);

  await page.locator('#panel-track [data-play-keys-reset]').click();
  await expect(chord).toHaveValue('30');
});

test('游玩键位自定义：改分区数、录入新键、占用互换、Esc 取消、刷新后保留、恢复默认', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-inspector-toggle]').click();
  await page.locator('#play-zones').fill('4');
  await page.locator('#play-zones').dispatchEvent('change');
  await expect(zoneKeys(page)).toHaveText(['A', 'S', 'D', 'F']);

  // 录入：点第 1 区，按 Q。录入期间按键不进页面快捷键（Q 本来也不是快捷键，这里看结果）。
  await zoneKeys(page).nth(0).click();
  await expect(zoneKeys(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('KeyQ');
  await expect(zoneKeys(page)).toHaveText(['Q', 'S', 'D', 'F']);

  // 占用互换：第 4 区抢 S，第 2 区换成 F。
  await zoneKeys(page).nth(3).click();
  await page.keyboard.press('KeyS');
  await expect(zoneKeys(page)).toHaveText(['Q', 'F', 'D', 'S']);

  // Esc 取消录入，键位不变；录入期间按空格也不会触发播放。
  const playing = () => page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.player.transport.playing as boolean);
  const before = await playing();
  await page.locator('#panel-track [data-play-air]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel-track [data-play-air]')).toHaveText('空格');
  await zoneKeys(page).nth(2).click();
  await page.keyboard.press('Space');
  await expect(zoneKeys(page)).toHaveText(['Q', 'F', '空格', 'S']);
  await expect(page.locator('#panel-track [data-play-air]')).toHaveText('D');
  expect(await playing()).toBe(before);

  await page.reload();
  await expect(page.locator('#play')).toBeEnabled();
  await page.locator('[data-inspector-toggle]').click();
  await expect(zoneKeys(page)).toHaveText(['Q', 'F', '空格', 'S']);
  await expect(page.locator('#panel-track [data-play-air]')).toHaveText('D');

  await page.locator('#panel-track [data-play-keys-reset]').click();
  await expect(zoneKeys(page)).toHaveText(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L']);
  await expect(page.locator('#panel-track [data-play-air]')).toHaveText('空格');
});

test('进入游玩模式：判定引擎接管、分数归零、从走带起点开播；退出后回到 AutoPlay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();

  const mode = page.locator('#play-mode');
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await mode.click();

  await expect(mode).toHaveAttribute('aria-pressed', 'true');
  await expect(mode).toContainText('退出游玩');
  const state = await page.evaluate(() => {
    const lpw = (window as unknown as { __LPW__: any }).__LPW__;
    return { playMode: lpw.playMode, hasJudge: lpw.judge !== null, time: lpw.player.transport.time };
  });
  expect(state.playMode).toBe(true);
  expect(state.hasJudge).toBe(true);
  // 手动模式从走带起点重开：分数与 combo 归零。
  const hud = await hudInfo(page);
  expect(hud.score.value).toBe(0);
  expect(hud.combo.value).toBe(0);

  // 播到有音符的位置再退出：AutoPlay 累计按当前时刻重建，combo 应大于 0。
  await page.locator('#play').click();
  await setTime(page, 5);
  await page.locator('#play').click();
  await mode.click();
  await expect(mode).toHaveAttribute('aria-pressed', 'false');
  await expect(mode).toContainText('游玩');
  const after = await page.evaluate(() => {
    const lpw = (window as unknown as { __LPW__: any }).__LPW__;
    return { playMode: lpw.playMode, hasJudge: lpw.judge !== null };
  });
  expect(after.playMode).toBe(false);
  expect(after.hasJudge).toBe(false);
  await expect.poll(async () => (await hudInfo(page)).combo.value).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('开场过场中进入游玩模式不会跳过开场', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  // 走带起点为负（开场过场开启），此时舞台在待机画面。
  await expect(page.locator('#timeline')).toHaveAttribute('min', /^-3\.66/);

  await page.locator('#play-mode').click();
  // 进入游玩模式 = 从走带起点开播：开场照常播，判定从 0 秒起生效。
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-intro', 'playing');
  const time = await page.evaluate(() => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time);
  expect(time).toBeLessThan(0);
  await expect.poll(
    () => page.evaluate(() => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);
});

test('窄屏下「游玩」按钮落在走带第三行，不与其它控件重叠', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();

  const boxes = await page.evaluate(() => {
    const pick = (selector: string) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height } : null;
    };
    return { mode: pick('#play-mode'), svg: pick('#export-svg'), video: pick('#export-video'), time: pick('#time'), row: pick('.transport-row') };
  });
  expect(boxes.mode).not.toBeNull();
  const mode = boxes.mode!;
  // 不越出走带条与视口。
  expect(mode.x).toBeGreaterThanOrEqual(boxes.row!.x);
  expect(mode.x + mode.w).toBeLessThanOrEqual(boxes.row!.x + boxes.row!.w + 0.5);
  // 与同一行的 SVG 导出、以及上一行的控件都不重叠。
  for (const other of [boxes.svg!, boxes.video!, boxes.time!]) {
    const overlap = mode.x < other.x + other.w - 0.5 && other.x < mode.x + mode.w - 0.5
      && mode.y < other.y + other.h - 0.5 && other.y < mode.y + mode.h - 0.5;
    expect(overlap).toBe(false);
  }
  // 窄屏只留图标，按钮靠 aria-label 与按下态表达语义。
  await expect(page.locator('#play-mode')).toHaveAttribute('aria-label', '进入游玩模式');
});

test('游玩模式下舞台里的 3D / 2D / SIF 按钮照常切换，游玩模式保持开启', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.locator('#play-mode').click();
  await expect(page.locator('#play-mode')).toHaveAttribute('aria-pressed', 'true');

  // 输入捕获挂在 #stage 上：按钮上的按下若被捕获，click 会改投到舞台、按钮失灵。
  for (const mode of ['2d', 'sif', '3d']) {
    const button = page.locator(`.stage-mode-switch button[data-stage-mode="${mode}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#stage')).toHaveAttribute('data-stage-mode', mode);
  }
  await expect(page.locator('#play-mode')).toHaveAttribute('aria-pressed', 'true');
});

test('完全不输入：音符判 Miss，分数保持 0', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.locator('#play-mode').click();

  const uid = await page.evaluate(() => (window as unknown as { __LPW__: { chart: any } }).__LPW__.chart.roots[0].uid as number);
  // 第一个音符的判定窗口过去后必定判 Miss（Single 的 ProcessView 兜底）。
  await expect.poll(() => judgeState(page, uid), { timeout: 10_000 }).toMatchObject({ phase: 'missed', finished: true });
  const hud = await hudInfo(page);
  expect(hud.score.value).toBe(0);
  expect(hud.combo.value).toBe(0);
});

/** 找一个默认键位能打到的 Flick（区中心离音符中心 ≤ 4 轨）。 */
async function pickKeyboardFlick(page: Page): Promise<NoteInfo | null> {
  return page.evaluate((arg: { keys: string[]; lanes: number[] }) => {
    const chart = (window as unknown as { __LPW__: { chart: any } }).__LPW__.chart;
    for (const note of chart.roots as { uid: number; type: number; time: number; l: number; r: number }[]) {
      if (note.type !== 2 || note.time <= 1.5 || note.time >= 60) continue;
      const index = arg.lanes.findIndex((lane) => Math.abs((note.l + note.r) / 2 - lane) <= 4);
      if (index >= 0) return { uid: note.uid, time: note.time, lane: arg.lanes[index]!, key: arg.keys[index]! };
    }
    return null;
  }, { keys: KEYS, lanes: LANES }) as Promise<NoteInfo | null>;
}

test('键盘 Flick：分区键起手后按 Air（空格）完成上滑；焦点留在「游玩」按钮上也能打，空格不暂停', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  const note = await pickKeyboardFlick(page);
  expect(note).not.toBeNull();

  // 鼠标点进游玩模式，焦点留在按钮上（不 blur）。
  await page.locator('#play-mode').click();
  // 记下送进 HUD 的判定事件：HUD 的判定字只显示最近一条，会被后面没按的音符覆盖。
  await page.evaluate(() => {
    const w = window as unknown as { __LPW__: any; __judged: any[] };
    const hud = w.__LPW__.hud;
    const apply = hud.applyJudgement.bind(hud);
    w.__judged = [];
    hud.applyJudgement = (event: any) => { w.__judged.push(event); apply(event); };
  });
  let landed = false;
  for (let attempt = 0; attempt < 3 && !landed; attempt++) {
    await setTime(page, note!.time - 0.3);
    await page.waitForFunction(
      (t) => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time >= t,
      note!.time - 0.03,
      { polling: 5 },
    );
    await page.keyboard.down(note!.key);
    await page.keyboard.press('Space');
    await page.keyboard.up(note!.key);
    landed = await expect.poll(() => judgeState(page, note!.uid), { timeout: 3_000 })
      .toMatchObject({ phase: 'judged' }).then(() => true).catch(() => false);
  }
  expect(landed).toBe(true);
  // 划动完成按起手判定落账（Perfect+ 5 / Great 3），不是超时兜底的 Good（2）。
  const type = await page.evaluate((uid: number) => {
    const events = (window as unknown as { __judged: any[] }).__judged.filter((e) => e.uid === uid);
    return events.at(-1)?.type as number | undefined;
  }, note!.uid);
  expect([5, 3]).toContain(type);
  expect(await page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.player.transport.playing)).toBe(true);
});

test('键盘在窗口内按下：判 Perfect 档、combo 与分数由手动判定增加', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  const note = await pickKeyboardNote(page);
  expect(note).not.toBeNull();

  await page.locator('#play-mode').click();
  // 键盘按键的落点是真实时间，机器忙时可能错过窗口：没打中就重开这一局再打一次。
  for (let attempt = 0; attempt < 3; attempt++) {
    // 跳到目标音符前 0.3 s（游玩模式跳转 = 从该时刻重开），播放中直接跳转。
    await setTime(page, note!.time - 0.3);
    // 等到进入判定窗口再按键（键盘 lane 由 PlayInput 固定映射到键位中心）。
    await page.waitForFunction(
      (t) => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time >= t,
      note!.time - 0.05,
      { polling: 5 },
    );
    await page.keyboard.press(note!.key);
    const landed = await expect
      .poll(async () => (await hudInfo(page)).combo.value, { timeout: 5_000 })
      .toBeGreaterThan(0)
      .then(() => true)
      .catch(() => false);
    if (landed) break;
  }

  const hud = await hudInfo(page);
  expect(hud.combo.value).toBeGreaterThan(0);
  expect(hud.score.value).toBeGreaterThan(0);
  expect(hud.judge.sprite).toMatch(/hantei_(perfect|great|good)/);
  expect(await judgeState(page, note!.uid)).toMatchObject({ phase: 'judged' });
});

test('Hold 提前松手：ribbon 与循环特效继续到离场，尾判 Miss 后头部图标继续下落', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  const hold = await pickKeyboardHold(page);
  expect(hold).not.toBeNull();
  const note = hold!;

  await page.locator('#play-mode').click();
  await setTime(page, note.time - 0.3);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', (Math.round((note.time - 0.3) * 1000) / 1000).toFixed(4));
  await page.waitForFunction(
    (t) => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time >= t,
    note.time - 0.05,
    { polling: 5 },
  );
  const key = note.key;
  const release = note.time + Math.min(0.2, (note.end - note.time) * 0.5);
  await page.keyboard.down(key);
  // 起判后在尾窗口之前松手：之后没有触摸续采样，剩余采样按 Miss 走，但 HoldStatus.index 仍在推进。
  await page.waitForFunction(
    (t) => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time >= t,
    release,
    { polling: 5 },
  );
  await page.keyboard.up(key);

  // 松手后仍是「按住」外观（原版 `_touched` 只看 index 与 Canceled）：holding 保持 true，渲染器继续画这条 Hold。
  await expect.poll(() => judgeState(page, note.uid), { timeout: 5_000 })
    .toMatchObject({ holding: true, finished: false, missed: false });
  expect(Number(await page.locator('#chart-canvas').getAttribute('data-visible-notes'))).toBeGreaterThan(0);

  // 中间采样判 Miss 之后（broken）、离场之前：循环特效仍在场（原版每帧 SetActive(_touched)，中间 Miss 不收）。
  const hasLoop = () => page.evaluate((uid: number) =>
    (window as unknown as { __LPW__: any }).__LPW__.renderer.fx.hasLoop(uid) as boolean, note.uid);
  await expect.poll(() => judgeState(page, note.uid), { timeout: 5_000 })
    .toMatchObject({ broken: true, finished: false });
  expect(await hasLoop()).toBe(true);

  // 链尾 Miss 离场：finished + missed（渲染器改画继续下落的头部图标）。
  await expect.poll(() => judgeState(page, note.uid), { timeout: 15_000 })
    .toMatchObject({ finished: true, missed: true, broken: true, holding: false });
  // 尾 Miss 离场：ReleaseHold，循环特效收掉。
  await expect.poll(hasLoop).toBe(false);
  await expect.poll(async () => (await hudInfo(page)).combo.value, { timeout: 5_000 }).toBe(0);
});

/** 直接向 HUD 送一条判定（绕过输入层，用于确定性地构造 Mental 状态）。 */
const injectJudge = (page: Page, type: number, over: Record<string, unknown> = {}) =>
  page.evaluate((arg: { type: number; over: Record<string, unknown> }) => {
    const hud = (window as unknown as { __LPW__: { hud: any } }).__LPW__.hud;
    hud.applyJudgement({
      kind: 'judge', uid: 1, noteType: 0, condition: 0, time: 1, target: 1, lane: 29.5, width: 1,
      lineHash: 0, hold: false, holdEnd: false, flick: false, head: true, holdIndex: -1,
      ...arg.over, type: arg.type,
    });
  }, { type, over });

const transportTime = (page: Page) =>
  page.evaluate(() => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time as number);

test('卡顿 / 后台恢复造成的时间大步前进不算跳转：HUD 不清零，与判定引擎一起继续', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.locator('#play-mode').click();
  await expect.poll(() => transportTime(page), { timeout: 10_000 }).toBeGreaterThan(0.2);
  await injectJudge(page, 4);
  const before = (await hudInfo(page)).score.value;
  expect(before).toBeGreaterThan(0);
  const t0 = await transportTime(page);
  // 主线程忙 0.8 s：走带时间照走，下一帧一次前进超过 0.5 s（HUD 的 AutoPlay 跳转阈值 SEEK_GAP）。
  await page.evaluate(() => { const end = performance.now() + 800; while (performance.now() < end) { /* 占住主线程 */ } });
  await nextFrames(page);
  expect(await transportTime(page) - t0).toBeGreaterThan(0.5);
  // 漏判只断 combo、不扣分：分数保持说明 HUD 没有自行重开。
  expect((await hudInfo(page)).score.value).toBeGreaterThanOrEqual(before);
  expect(await page.evaluate(() => (window as unknown as { __LPW__: any }).__LPW__.playMode)).toBe(true);
});

test('Mental 扣完不失败：分数冻结、播放继续，之后判 Perfect 只加 combo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.locator('#play-mode').click();

  // 先打一条 Perfect 让分数大于 0，再用 10 次 Miss（各扣 100）把 Mental 打到 0。
  await injectJudge(page, 4);
  const hit = await hudInfo(page);
  expect(hit.score.value).toBeGreaterThan(0);
  for (let i = 0; i < 10; i++) await injectJudge(page, 0);
  const dead = await hudInfo(page);
  expect(dead.mental).toEqual({ value: 0, max: 1000, red: true });
  expect(dead.combo.value).toBe(0);

  // 不失败：播放继续走。
  const t0 = await page.evaluate(() => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time);
  await page.waitForTimeout(600);
  const t1 = await page.evaluate(() => (window as unknown as { __LPW__: { player: any } }).__LPW__.player.transport.time);
  expect(t1).toBeGreaterThan(t0);

  // 归零后判定照常给 combo，但不再加分（ScoreResolver.Add 的 mental 门）。
  await injectJudge(page, 4);
  const after = await hudInfo(page);
  expect(after.combo.value).toBe(1);
  expect(after.score.value).toBe(hit.score.value);
});

test('Mental 归零后曲终横幅取 Finish 档', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  const finish = await page.evaluate(() => (window as unknown as { __LPW__: { finishTime: number } }).__LPW__.finishTime);
  expect(finish).toBeGreaterThan(0);
  await page.locator('#play-mode').click();
  // 跳到曲终前，再把 Mental 打空（跳转本身会重开一局、回满血，所以顺序不能反）。
  await setTime(page, finish - 1.2);
  for (let i = 0; i < 10; i++) await injectJudge(page, 0);
  expect((await hudInfo(page)).mental.value).toBe(0);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-result', '3', { timeout: 15_000 });
  expect(await resultInfo(page)).toEqual({ visible: true, kind: 3 });
});

/**
 * 进入游玩模式并停在曲终前的空窗（末音符之后、FinishTime 之前），返回 FinishTime。
 * 先把「曲终横幅」设置改成 Finish：游玩模式不吃这个设置，档位只能由实际成绩算出来。
 */
async function startPlayModeNearEnd(page: Page): Promise<number> {
  await page.goto('/');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.locator('[data-inspector-toggle]').click();
  await page.locator('#tab-display').click();
  await page.locator('#opt-combo-result').selectOption('3');
  await expect.poll(async () => (await resultInfo(page)).kind).toBe(3);
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
  expect(info.last).toBeLessThan(info.finish);
  await page.locator('#play-mode').click();
  // 从末音符之后跳到曲终前：窗口里没有真实音符，注入的判定就是全部判定。
  await setTime(page, Math.max(info.last + 0.05, info.finish - 0.4));
  return info.finish;
}

test('游玩模式横幅按实际成绩取档：有 Great 时是 FullCombo，不采用预览设置', async ({ page }) => {
  await startPlayModeNearEnd(page);
  for (let i = 0; i < 10; i++) await injectJudge(page, 4);
  await injectJudge(page, 3);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-result', '1', { timeout: 15_000 });
  expect(await resultInfo(page)).toEqual({ visible: true, kind: 1 });
});

test('游玩模式横幅按实际成绩取档：全 Perfect 时是 AllPerfect', async ({ page }) => {
  await startPlayModeNearEnd(page);
  for (let i = 0; i < 10; i++) await injectJudge(page, 4);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-result', '0', { timeout: 15_000 });
  expect(await resultInfo(page)).toEqual({ visible: true, kind: 0 });
});
