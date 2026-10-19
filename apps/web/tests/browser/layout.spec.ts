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
    await expect(page.getByRole('button', { name: '全屏预览' })).toBeFocused();
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
}

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
