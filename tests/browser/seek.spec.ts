import { test, expect } from '@playwright/test';
const setTime = (page: import('@playwright/test').Page, v: number) =>
  page.locator('#timeline').evaluate((e: HTMLInputElement, v: number) => { e.value = String(v); e.dispatchEvent(new Event('input')); }, v);
const comboText = (page: import('@playwright/test').Page) =>
  page.locator('.hud-combo-digits .hud-cdigit:not([hidden])').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.sprite ?? '').join('|'));
const scoreSprites = (page: import('@playwright/test').Page) =>
  page.locator('.hud-sdigit').evaluateAll(els => els.map(e => (e as HTMLElement).dataset.sprite ?? '').join('|'));

test('暂停中拖动进度条：HUD 按目标时刻重算，不清零；回拖同样一致', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#message')).toContainText('就绪');
  await setTime(page, 20);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '20.0000');
  await expect.poll(() => page.locator('.hud-combo-digits .hud-cdigit:not([hidden])').count()).toBeGreaterThan(0);
  const combo20 = await comboText(page), score20 = await scoreSprites(page);
  await setTime(page, 30);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '30.0000');
  await setTime(page, 20);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '20.0000');
  await expect.poll(() => comboText(page)).toBe(combo20);
  expect(await scoreSprites(page)).toBe(score20);
  await setTime(page, 0);
  await expect.poll(() => page.locator('.hud-combo-digits .hud-cdigit:not([hidden])').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('开场过场计入进度条：起点为负，拖到过场中显示对应帧，暂停时冻结', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#message')).toContainText('就绪');
  const min = Number(await page.locator('#timeline').getAttribute('min'));
  expect(min).toBeCloseTo(-3.667, 2);
  await expect(page.locator('#time')).toContainText('-00:03.66');
  await setTime(page, -1);
  await expect(page.locator('.start-anim')).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('.start-anim')).toBeVisible();
  const frame = await page.locator('.sa-title').evaluate(e => getComputedStyle(e).color);
  await page.waitForTimeout(300);
  expect(await page.locator('.sa-title').evaluate(e => getComputedStyle(e).color)).toBe(frame);
  await setTime(page, 0.5);
  await expect(page.locator('.start-anim')).toBeHidden();
  await page.locator('#opt-start-anim').evaluate((e: HTMLInputElement) => { e.checked = false; e.dispatchEvent(new Event('change')); });
  await expect(page.locator('#timeline')).toHaveAttribute('min', '0');
});
