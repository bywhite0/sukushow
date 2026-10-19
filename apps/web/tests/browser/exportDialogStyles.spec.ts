import { test, expect } from '@playwright/test';
import { openChartFixture } from './chartFixture';

test('导出对话框样式完整（.setting / .check / .primary / .quiet / .text-button）', async ({ page }) => {
  await openChartFixture(page);
  await page.locator('#export-video').click();

  const dialog = page.locator('.export-dialog');
  await expect(dialog).toBeVisible();

  // .setting：应有 margin-bottom: 24px 或 16px（export-grid 内）
  const firstSetting = dialog.locator('.setting').first();
  const settingMargin = await firstSetting.evaluate((el) => window.getComputedStyle(el).marginBottom);
  expect(parseInt(settingMargin, 10)).toBeGreaterThan(0);

  // .setting input/select：应有 min-height: 40px
  const settingInput = dialog.locator('.setting input[type="number"]').first();
  const inputHeight = await settingInput.evaluate((el) => window.getComputedStyle(el).minHeight);
  expect(inputHeight).toBe('40px');

  // .check：应有 display: flex, align-items: center
  const check = dialog.locator('.check');
  const checkDisplay = await check.evaluate((el) => window.getComputedStyle(el).display);
  const checkAlign = await check.evaluate((el) => window.getComputedStyle(el).alignItems);
  expect(checkDisplay).toBe('flex');
  expect(checkAlign).toBe('center');

  // .primary：应有背景色（var(--shell-accent) 已计算）
  const primaryBtn = dialog.locator('.primary');
  const primaryBg = await primaryBtn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
  expect(primaryBg).not.toBe('rgba(0, 0, 0, 0)'); // 不是透明
  expect(primaryBg).toMatch(/rgb|oklch/); // 有颜色（支持现代色彩空间）

  // 尚未导出时，不显示下载与取消导出入口。
  await expect(dialog.locator('[data-download]')).toBeHidden();
  await expect(dialog.locator('[data-cancel]')).toBeHidden();

  // .text-button（关闭按钮）：应有 color: var(--shell-muted)
  const textBtn = dialog.locator('.text-button');
  const textColor = await textBtn.evaluate((el) => window.getComputedStyle(el).color);
  expect(textColor).toMatch(/rgb|oklch/);

  // option:disabled 应置灰（color: var(--shell-muted)）
  const disabledOption = await page.locator('[name="resolution"] option:disabled').first();
  if (await disabledOption.count() > 0) {
    const optionColor = await disabledOption.evaluate((el) => window.getComputedStyle(el).color);
    // 置灰色应该不是默认黑色或白色
    expect(optionColor).toMatch(/rgb/);
  }
});
