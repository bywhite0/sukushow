import { test, expect } from '@playwright/test';

test('设置侧栏的项目名打开关于页，显示构建信息与源码入口', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  const settings = page.getByRole('button', { name: '全局设置' });
  await settings.click();
  const dialog = page.locator('#global-settings');
  await expect(dialog.getByRole('heading', { name: '外观', level: 2 })).toBeVisible();

  await dialog.getByRole('button', { name: '关于 sukushow' }).click();
  await expect(dialog.getByRole('heading', { name: '关于', level: 2 })).toBeVisible();
  await expect(dialog.locator('.about-hero p')).toContainText('LLLL 原格式谱面');
  await expect(dialog.locator('.about-hero p')).toContainText('PJSK 渲染');
  await expect(dialog.locator('[data-build-version]')).toHaveText(/^v\d+\.\d+\.\d+ · [0-9a-f]{7}(?:-dirty)?$/);
  await expect(dialog.locator('[data-build-time]')).not.toBeEmpty();
  await expect(dialog.getByText(/© \d{4} 白影White/)).toBeVisible();
  const source = dialog.getByRole('link', { name: /GitHub/ });
  await expect(source).toHaveAttribute('href', 'https://github.com/bywhite0/sukushow');
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(page.locator('.workspace-footer')).not.toContainText('源码');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(settings).toBeFocused();
});

test('窄屏保留关于入口且不遮挡关闭按钮', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  const about = dialog.getByRole('button', { name: '关于 sukushow' });
  await expect(about).toBeVisible();
  await expect(dialog.locator('.preferences-brand-copy')).toBeVisible();
  await expect(dialog.locator('.preferences-brand-copy > span')).toBeHidden();
  await about.click();
  await expect(dialog.getByRole('heading', { name: '关于', level: 2 })).toBeVisible();

  const aboutBox = (await about.boundingBox())!;
  const closeBox = (await dialog.getByRole('button', { name: '关闭全局设置' }).boundingBox())!;
  expect(aboutBox.x + aboutBox.width).toBeLessThanOrEqual(closeBox.x);
});
