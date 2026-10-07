import { test, expect } from '@playwright/test';
import { hudInfo, introInfo } from './lpwHook';
const setTime = (page: import('@playwright/test').Page, v: number) =>
  page.locator('#timeline').evaluate((e: HTMLInputElement, v: number) => { e.value = String(v); e.dispatchEvent(new Event('input')); }, v);
const comboText = async (page: import('@playwright/test').Page) => (await hudInfo(page)).combo.sprites.join('|');
const scoreSprites = async (page: import('@playwright/test').Page) => (await hudInfo(page)).score.sprites.join('|');
const comboDigits = async (page: import('@playwright/test').Page) => (await hudInfo(page)).combo.sprites.length as number;

test('暂停中拖动进度条：HUD 按目标时刻重算，不清零；回拖同样一致', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#message')).toContainText('就绪');
  await setTime(page, 20);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '20.0000');
  await expect.poll(() => comboDigits(page)).toBeGreaterThan(0);
  const combo20 = await comboText(page), score20 = await scoreSprites(page);
  await setTime(page, 30);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '30.0000');
  await setTime(page, 20);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '20.0000');
  await expect.poll(() => comboText(page)).toBe(combo20);
  expect(await scoreSprites(page)).toBe(score20);
  await setTime(page, 0);
  await expect.poll(() => comboDigits(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('开场过场计入进度条：起点为负，拖到过场中显示对应帧，暂停时冻结', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#message')).toContainText('就绪');
  const min = Number(await page.locator('#timeline').getAttribute('min'));
  expect(min).toBeCloseTo(-3.667, 2);
  await expect(page.locator('#time')).toContainText('-00:03.66');
  await setTime(page, -1);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-intro', 'playing');
  const frame = (await introInfo(page)).clipTime;
  expect(frame).toBeCloseTo(3.667 - 1, 2);
  await page.waitForTimeout(300);
  expect((await introInfo(page)).clipTime).toBe(frame);
  await setTime(page, 0.5);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-intro', '');
  await page.locator('#opt-start-anim').evaluate((e: HTMLInputElement) => { e.checked = false; e.dispatchEvent(new Event('change')); });
  await expect(page.locator('#timeline')).toHaveAttribute('min', '0');
});
