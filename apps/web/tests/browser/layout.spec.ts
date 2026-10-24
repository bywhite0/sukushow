import { CHART_FIXTURE_PATH, openChartFixture } from './chartFixture';
import { test, expect, type Page } from '@playwright/test';

async function openPreview(page: Page, view: 'llll' | 'pjsk') {
  await page.goto(`/?view=${view}&chart=/fixture-missing.json`);
  await expect(page.locator('#source-status')).toContainText('来源加载失败');
  await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH);
  await expect(page.locator('#chart-name')).toHaveText('custom-chart.json', { timeout: 60_000 });
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#play')).toBeEnabled();
}

for (const view of ['llll', 'pjsk'] as const) {
  for (const width of [1440, 900, 390]) {
    test(`${view} ${width}px 默认优先展示谱面，设置按需展开并保留键盘导航`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await openPreview(page, view);

      const inspector = page.locator('#preview-inspector');
      const toggle = page.locator('[data-inspector-toggle]');
      const record = page.locator('.now-playing');
      await expect(inspector).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      if (width <= 900) await expect(record).toBeHidden();
      else await expect(record).toBeVisible();

      // 无需滚动就能操作走带；小屏也必须完整显示核心播放控制。
      for (const selector of ['#play', '#timeline', '#restart', '#rate', '#fullscreen']) {
        const box = (await page.locator(selector).boundingBox())!;
        expect(box.x, selector).toBeGreaterThanOrEqual(0);
        expect(box.y, selector).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 1);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(900);
      }

      await toggle.click();
      await expect(inspector).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const tabs = page.getByRole('tablist', { name: '设置分类' });
      await expect(tabs).toBeVisible();
      for (const name of ['播放与轨道', '显示与特效', '音量', '计分']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
        await expect(page.getByRole('tabpanel')).toHaveCount(1);
      }
      await page.getByRole('tab', { name: '播放与轨道', exact: true }).click();
      await page.locator('#mirror').check();
      await page.getByRole('tab', { name: '音量', exact: true }).click();
      await page.getByRole('tab', { name: '播放与轨道', exact: true }).click();
      await expect(page.locator('#mirror')).toBeChecked();
      await page.getByRole('tab', { name: '播放与轨道', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: '显示与特效', exact: true })).toBeFocused();
      await page.keyboard.press('End');
      await expect(page.getByRole('tab', { name: '计分', exact: true })).toHaveAttribute('aria-selected', 'true');

      await page.locator('[data-inspector-close]').click();
      await expect(inspector).toBeHidden();
      await expect(toggle).toBeFocused();
      await toggle.click();
      await page.keyboard.press('Escape');
      await expect(inspector).toBeHidden();
      await expect(toggle).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    });
  }

  test(`${view} 专注预览收起曲目和设置并扩大谱面空间`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPreview(page, view);
    const record = page.locator('.now-playing');
    const recordToggle = page.locator('[data-record-toggle]');
    const shell = page.locator('.stage-shell');
    await expect(record).toBeVisible();
    await expect(page.locator('.now-playing #song-picker-mount')).toBeAttached();
    const before = (await shell.boundingBox())!;
    const stageBefore = (await page.locator('#stage').boundingBox())!;
    await page.locator('[data-inspector-toggle]').click();
    await expect(page.locator('#preview-inspector')).toBeVisible();
    await page.locator('[data-focus-toggle]').click();
    await expect(record).toBeHidden();
    await expect(page.locator('#preview-inspector')).toBeHidden();
    await expect(recordToggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(async () => (await shell.boundingBox())!.width).toBeGreaterThan(before.width + 100);
    // PJSK 保留 16:9；可用空间扩大后不应拉伸或缩小原有舞台。
    const stageAfter = (await page.locator('#stage').boundingBox())!;
    if (view === 'llll') expect(stageAfter.width).toBeGreaterThan(stageBefore.width + 100);
    else {
      expect(stageAfter.width).toBeGreaterThanOrEqual(stageBefore.width - 1);
      expect(stageAfter.width / stageAfter.height).toBeCloseTo(16 / 9, 2);
    }
    await expect.poll(() => page.locator('#chart-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return Math.max(Math.abs(canvas.width - bounds.width * dpr), Math.abs(canvas.height - bounds.height * dpr));
    })).toBeLessThanOrEqual(2);
    await expect(page.locator('#play')).toBeEnabled();
    await recordToggle.click();
    await expect(record).toBeVisible();
    await expect(recordToggle).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test(`${view} 全屏保留画布和播放控制，退出后恢复工作台`, async ({ page }) => {
    test.setTimeout(90_000);
    await openPreview(page, view);
    await page.getByRole('button', { name: '全屏预览' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
    await expect(page.locator('#play')).toBeVisible();
    const stage = await page.locator('#stage').boundingBox();
    expect(stage!.height).toBeGreaterThan(200);
    await page.keyboard.press('/');
    const search = page.locator('#song-search');
    await expect(search).toBeFocused();
    await search.fill('103103');
    await expect(page.locator('#song-listbox [role="option"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#song-panel')).toBeHidden();
    await expect(page.getByRole('button', { name: '退出全屏' })).toBeFocused();
    await page.keyboard.press('/');
    await expect(search).toBeFocused();
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator('#song-panel')).toBeHidden();
    await page.locator('#browse-library').click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('103103');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.locator('[data-inspector-toggle]')).toBeVisible();
    await expect(page.locator('#preview-inspector')).toBeHidden();
  });

  test(`${view} 全屏控制区静止后自动隐藏，指针移动后恢复`, async ({ page }) => {
    test.setTimeout(90_000);
    await openPreview(page, view);
    const viewer = page.locator('.viewer');
    const lock = page.locator('[data-chrome-lock]');
    const viewport = page.viewportSize()!;
    await page.getByRole('button', { name: '全屏预览' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
    // 学视频播放器：一条贴底通栏，曲目名在栏内顶部，下面依次是进度条和按钮行；锁定按钮在左侧中部。
    const toolbarBox = (await page.locator('.stage-toolbar').boundingBox())!;
    const transportBox = (await page.locator('.transport').boundingBox())!;
    const timelineBox = (await page.locator('#timeline').boundingBox())!;
    const lockBox = (await lock.boundingBox())!;
    expect(transportBox.x).toBeLessThanOrEqual(1);
    expect(Math.abs(transportBox.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(transportBox.y + transportBox.height).toBeGreaterThan(viewport.height - 20);
    expect(Math.abs(toolbarBox.y - transportBox.y)).toBeLessThanOrEqual(1);
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(timelineBox.y);
    expect(Math.abs(lockBox.y + lockBox.height / 2 - viewport.height / 2)).toBeLessThan(4);
    expect(lockBox.x).toBeLessThan(60);
    // 控制栏只在底部压一层淡黑渐变，不做模糊，控件仍直接浮在画面上。
    const chrome = await page.locator('.transport').evaluate(el => ({
      background: getComputedStyle(el).backgroundImage,
      blur: getComputedStyle(el).backdropFilter,
    }));
    expect(chrome.background).toContain('linear-gradient');
    expect(chrome.background).toContain('rgba(0, 0, 0');
    expect(chrome.blur).toBe('none');
    // 指针移出控制栏，空闲计时结束后整组控制一起隐藏；锁定按钮常驻。
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect(viewer).toHaveClass(/is-chrome-idle/, { timeout: 6000 });
    await expect(page.locator('.stage-toolbar')).toBeHidden();
    await expect(page.locator('.transport')).toBeHidden();
    await expect(lock).toBeVisible();
    // 隐藏时控制栏退出焦点顺序，重新出现后恢复。
    await expect(page.locator('.transport')).toHaveAttribute('inert', '');
    // 隐藏只改变叠层，不改变舞台尺寸。
    const stage = (await page.locator('#stage').boundingBox())!;
    expect(stage.height).toBeGreaterThan(viewport.height * 0.9);
    // 指针移动把控制栏叫回来。
    await page.mouse.move(viewport.width / 2 - 40, viewport.height / 2 - 40);
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
    await expect(page.locator('#play')).toBeVisible();
    await expect(page.locator('.transport')).not.toHaveAttribute('inert', '');
    // 指针停在控制栏上（含条上的空白处）也算停在控制栏上，不会从指针底下消失。
    await page.mouse.move(transportBox.x + transportBox.width / 2, transportBox.y + transportBox.height - 6);
    await page.waitForTimeout(3200);
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
    // 状态提示出现时把控制栏叫回来（隐藏后写入状态行，走状态行的观察器）。
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect(viewer).toHaveClass(/is-chrome-idle/, { timeout: 6000 });
    await page.evaluate(() => { document.querySelector('#message')!.textContent = '测试状态提示'; });
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
    await expect(page.locator('#message')).toHaveText('测试状态提示');
    await page.evaluate(() => { document.querySelector('#message')!.textContent = ''; });
    // 锁定后控制栏保持隐藏，按键与误触都不会把它叫回来；左侧锁定按钮常驻，锁定时变成解锁入口。
    await expect(lock).toHaveAttribute('aria-label', '锁定控制栏');
    await lock.click();
    await expect(viewer).toHaveClass(/is-chrome-locked/);
    await expect(viewer).toHaveClass(/is-chrome-idle/);
    await expect(lock).toHaveAttribute('aria-pressed', 'true');
    await expect(lock).toHaveAttribute('aria-label', '解除锁定');
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(300);
    await expect(page.locator('.transport')).toBeHidden();
    await expect(lock).toBeVisible();
    await lock.click();
    await expect(viewer).not.toHaveClass(/is-chrome-locked/);
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
    await expect(page.locator('#play')).toBeVisible();
    // 解锁后回到自动隐藏。
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await expect(viewer).toHaveClass(/is-chrome-idle/, { timeout: 6000 });
    // 曲库弹层打开时控制栏保持显示（弹层是挂在全屏元素里的 popover）。
    await page.keyboard.press('/');
    await expect(page.locator('#song-search')).toBeFocused();
    await page.waitForTimeout(3200);
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
    await expect(page.locator('.transport')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#song-panel')).toBeHidden();
    // 退出全屏后控制栏恢复常驻。
    await page.evaluate(() => document.exitFullscreen());
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(page.locator('.transport')).toBeVisible();
    await expect(viewer).not.toHaveClass(/is-chrome-idle/);
  });
}

test('LLLL 全屏控制栏铺满宽屏且固定深色，不跟随浅色主题', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem('sukushow:appearance:v1', JSON.stringify({ mode: 'light', accent: 'default' })));
  await page.setViewportSize({ width: 2560, height: 1080 });
  await openPreview(page, 'llll');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '全屏预览' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
  // 不再限宽：进度条从左内边距铺到右内边距。
  const timeline = (await page.locator('#timeline').boundingBox())!;
  expect(Math.abs(timeline.x - 16)).toBeLessThanOrEqual(2);
  expect(Math.abs(timeline.width - (2560 - 32))).toBeLessThanOrEqual(2);
  // 浅色主题下控制区仍是深色面板配浅色文字。
  const chrome = await page.locator('.transport').evaluate(el => ({
    panel: getComputedStyle(el).getPropertyValue('--shell-panel').trim(),
    color: getComputedStyle(el).color,
  }));
  expect(chrome.panel).toBe('#202025');
  expect(chrome.color).toBe('rgb(239, 238, 233)');
  expect(await page.locator('.stage-heading h2').evaluate(el => getComputedStyle(el).color)).toBe('rgb(239, 238, 233)');
  // 全屏里打开的弹层（挂在 body 上的对话框）同样固定深色，不跟随浅色主题。
  await page.locator('#export-video').click();
  const dialog = page.locator('.export-dialog');
  await expect(dialog).toBeVisible();
  const dialogChrome = await dialog.evaluate(el => ({
    surface: getComputedStyle(el).getPropertyValue('--shell-surface').trim(),
    background: getComputedStyle(el).backgroundColor,
  }));
  expect(dialogChrome.surface).toBe('#1b1b1e');
  expect(dialogChrome.background).toBe('rgb(27, 27, 30)');
  await dialog.locator('[data-close]').click();
  await expect(dialog).toBeHidden();
  // 退出全屏后回到浅色主题。
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  expect(await page.locator('.transport').evaluate(el => getComputedStyle(el).getPropertyValue('--shell-panel').trim())).toBe('#fdfcfe');
});

test('LLLL 全屏游玩模式自动锁定控制栏，可解锁操作', async ({ page }) => {
  test.setTimeout(90_000);
  await openPreview(page, 'llll');
  const viewer = page.locator('.viewer');
  const viewport = page.viewportSize()!;
  await page.getByRole('button', { name: '全屏预览' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
  await page.locator('#play-mode').click();
  // 游玩模式自动锁定：控制栏收起，舞台仍是满幅。
  await expect(viewer).toHaveClass(/is-chrome-locked/);
  await expect(viewer).toHaveClass(/is-chrome-idle/);
  const stage = (await page.locator('#stage').boundingBox())!;
  expect(stage.height).toBeGreaterThan(viewport.height * 0.9);
  await expect(page.locator('.transport')).toBeHidden();
  const lock = page.locator('[data-chrome-lock]');
  await expect(lock).toBeVisible();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(lock).toHaveAttribute('aria-label', '解除锁定');
  // 判定输入不会唤出控制栏。
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(300);
  await expect(page.locator('.transport')).toBeHidden();
  // 锁定期间错误提示不跟着收起，游玩模式里出错也看得到。
  await page.evaluate(() => {
    const node = document.querySelector('#message')!;
    node.textContent = '播放失败：测试';
    node.classList.add('error');
  });
  await expect(page.locator('#message')).toBeVisible();
  await page.evaluate(() => {
    const node = document.querySelector('#message')!;
    node.textContent = '';
    node.classList.remove('error');
  });
  // 解锁后控制栏回来，可以继续操作。
  await lock.click();
  await expect(viewer).not.toHaveClass(/is-chrome-locked/);
  await expect(page.locator('#play-mode')).toBeVisible();
  // 退出游玩模式后恢复普通自动隐藏。
  await page.locator('#play-mode').click();
  await expect(viewer).not.toHaveClass(/is-chrome-locked/);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await expect(viewer).toHaveClass(/is-chrome-idle/, { timeout: 6000 });
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test('LLLL 窄屏全屏控制栏铺满并收紧边距', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview(page, 'llll');
  await page.getByRole('button', { name: '全屏预览' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('viewer'))).toBe(true);
  const transport = (await page.locator('.transport').boundingBox())!;
  const toolbar = (await page.locator('.stage-toolbar').boundingBox())!;
  const timeline = (await page.locator('#timeline').boundingBox())!;
  // 窄屏边距收到 8px，控制栏仍铺满宽度、贴住底边，曲目名行与走带条顶对齐。
  expect(transport.x).toBeLessThanOrEqual(1);
  expect(Math.abs(transport.width - 390)).toBeLessThanOrEqual(1);
  expect(transport.y + transport.height).toBeGreaterThan(844 - 20);
  expect(Math.abs(timeline.x - 8)).toBeLessThanOrEqual(2);
  expect(Math.abs(toolbar.y - transport.y)).toBeLessThanOrEqual(1);
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(timeline.y);
  // 锁定按钮在窄屏也常驻在左侧中部。
  const lock = (await page.locator('[data-chrome-lock]').boundingBox())!;
  expect(Math.abs(lock.y + lock.height / 2 - 844 / 2)).toBeLessThan(4);
  expect(lock.x).toBeLessThan(60);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test('曲目档案随独立谱导入更新，坏文件保留原名，重选仍生效', async ({ page }) => {
  await openChartFixture(page);
  await page.locator('#chart-file').setInputFiles({
    name: '布局验证.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', Flags: 80, holds: [] }], Bpms: [{ Bpm: 120, Time: 0 }] })),
  });
  await expect(page.locator('#chart-name')).toHaveText('布局验证.json');
  await page.locator('#chart-file').setInputFiles({ name: '错误.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#source-status')).toContainText('文件读取失败');
  await expect(page.locator('#chart-name')).toHaveText('布局验证.json');
  await openChartFixture(page);
  await expect(page.locator('#chart-name')).toHaveText('custom-chart.json');
});

test('PJSK 曲目档案显示长条数量，连续段合并为一条', async ({ page }) => {
  await openPreview(page, 'pjsk');
  const holds = page.locator('#chart-metrics > div').filter({ has: page.locator('dt', { hasText: /^长条数$/ }) });
  // 夹具有两个首尾相接的长条段，档案应显示一条完整长条。
  await expect(holds.locator('dd')).toHaveText('1');
  await expect(page.locator('#chart-metrics')).not.toContainText(/maxLane|最大轨道/i);
  await expect(page.locator('.mode-tab[data-view="llll"]')).toHaveText('LLLL');
});

test('比例按钮锁定舞台宽高比，刷新后保留', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openChartFixture(page);
  const group = page.getByRole('radiogroup', { name: '预览比例' });
  await expect(group).toBeVisible();
  await expect(group.locator('[data-aspect="free"]')).toHaveAttribute('aria-checked', 'true');
  const ratio = async () => {
    const b = (await page.locator('#stage').boundingBox())!;
    return b.width / b.height;
  };
  for (const [id, r] of [['4:3', 4 / 3], ['16:9', 16 / 9], ['19.5:9', 19.5 / 9], ['20:9', 20 / 9], ['16:10', 1.6]] as const) {
    await group.locator(`[data-aspect="${id}"]`).click();
    await expect(group.locator(`[data-aspect="${id}"]`)).toHaveAttribute('aria-checked', 'true');
    await expect.poll(ratio).toBeGreaterThan(r * 0.99);
    expect(await ratio()).toBeLessThan(r * 1.01);
    await expect.poll(async () => {
      const c = (await page.locator('#chart-canvas').boundingBox())!;
      return c.width / c.height;
    }).toBeGreaterThan(r * 0.99);
  }
  await group.locator('[data-aspect="4:3"]').click();
  await page.reload();
  await expect(page.locator('#chart-file')).toBeAttached();
  await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH);
  await expect(page.locator('#play')).toBeEnabled();
  await expect(group.locator('[data-aspect="4:3"]')).toHaveAttribute('aria-checked', 'true');
  await expect.poll(ratio).toBeCloseTo(4 / 3, 2);
  await group.locator('[data-aspect="free"]').click();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-aspect', /.+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
