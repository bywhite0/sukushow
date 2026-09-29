import { test, expect } from '@playwright/test';

for (const width of [1440, 900, 390]) {
  test(`${width}px 工作台布局和设置切换`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('#message')).toContainText('就绪');
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width > 1000) {
      const play = await page.locator('#play').boundingBox();
      expect(play!.y + play!.height).toBeLessThanOrEqual(900);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    }
  });
}

test('全屏保留画布和播放控制，退出后恢复工作台', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '全屏预览' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('viewer');
  await expect(page.locator('#play')).toBeVisible();
  const stage = await page.locator('#stage').boundingBox();
  expect(stage!.height).toBeGreaterThan(200);
  await page.getByRole('button', { name: '全屏预览' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.getByRole('tablist', { name: '设置分类' })).toBeVisible();
});

test('顶部文件名随成功导入更新，坏文件保留原名，演示可恢复', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#chart-name')).toHaveText('演示谱面');
  await page.locator('#chart-file').setInputFiles({
    name: '布局验证.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', Flags: 80, holds: [] }], Bpms: [{ Bpm: 120, Time: 0 }] })),
  });
  await expect(page.locator('#chart-name')).toHaveText('布局验证.json');
  await page.locator('#chart-file').setInputFiles({ name: '错误.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#message')).toContainText('原谱面已保留');
  await expect(page.locator('#chart-name')).toHaveText('布局验证.json');
  await page.getByRole('button', { name: '重新打开演示谱', exact: true }).click();
  await expect(page.locator('#chart-name')).toHaveText('演示谱面');
});

test('顶栏比例按钮锁定舞台宽高比，刷新后保留', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
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
    // 画布（渲染器）跟着舞台走。
    await expect.poll(async () => {
      const c = (await page.locator('#chart-canvas').boundingBox())!;
      return c.width / c.height;
    }).toBeGreaterThan(r * 0.99);
  }
  await group.locator('[data-aspect="4:3"]').click();
  await page.reload();
  await expect(page.locator('#message')).toContainText('就绪');
  await expect(group.locator('[data-aspect="4:3"]')).toHaveAttribute('aria-checked', 'true');
  expect(Math.abs(await ratio() - 4 / 3)).toBeLessThan(0.02);
  // 回到自由：清掉内联尺寸，舞台重新撑满预览区。
  await group.locator('[data-aspect="free"]').click();
  await expect(page.locator('#stage')).not.toHaveAttribute('data-aspect', /.+/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
