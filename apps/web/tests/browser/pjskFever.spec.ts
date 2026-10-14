import { expect, test } from '@playwright/test';

test('PJSK Fever 原包动画、配置切换及回退 seek', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?view=pjsk&song=103103&difficulty=MASTER');
  await page.waitForFunction(() => Boolean((window as any).__LLL_PJSK__?.getChart?.()), null, { timeout: 90_000 });
  await page.locator('#tab-display').click();
  await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.pause();
    p.setExportMode(true);
    p.setFeverWindow(0, 20);
    p.setFeverDisplay(true);
  });
  // 对同一渲染帧读取 PNG 中央区域；不把场景其他区域的动画算进断言。
  const capture = async (time: number, enabled = true, superOn = false, region = 'center') => {
    await page.evaluate(({ time, enabled, superOn }) => {
      const p = (window as any).__LLL_PJSK__.player;
      p.setFeverDisplay(enabled);
      p.setSuperFeverEnabled(superOn);
      p.renderFrameAt(p.getStateSnapshot().effectiveLeadInSec + time, false);
    }, { time, enabled, superOn });
    const png = await page.locator('#chart-canvas').screenshot();
    return page.evaluate(async ({ data, region }) => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const roi = region === 'bottom' ? [0, .98, 1, .02]
        : region === 'top' ? [0, .02, 1, .03]
        : region === 'pointers' ? [.57, .04, .2, .23] : [.2, .4, .6, .2];
      const pixels = ctx.getImageData(Math.floor(bitmap.width * roi[0]), Math.floor(bitmap.height * roi[1]),
        Math.floor(bitmap.width * roi[2]), Math.floor(bitmap.height * roi[3])).data;
      return Array.from(pixels);
    }, { data: `data:image/png;base64,${png.toString('base64')}`, region });
  };
  const difference = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  for (const profile of ['0', '1']) {
    await page.locator('#effect-profile').selectOption(profile);
    for (const superOn of [false, true]) {
      const early = await capture(.125, true, superOn);
      const peak = await capture(.25, true, superOn);
      expect(difference(early, peak)).toBeGreaterThan(1000);
      const settled = await capture(2, true, superOn);
      const off = await capture(2, false, superOn);
      expect(difference(settled, off)).toBe(0);
      const rewind = await capture(.25, true, superOn);
      expect(difference(peak, rewind)).toBe(0);
    }
  }
  await page.locator('#effect-profile').selectOption('0');
  const standard = await capture(.25);
  await page.locator('#effect-profile').selectOption('1');
  const simplified = await capture(.25);
  expect(difference(standard, simplified)).toBeGreaterThan(1000);
  await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.setFeverWindow(10, 20);
    p.setFeverChargeTimes([1, 2, 3]);
  });
  const pointers = await capture(3.5, true, false, 'pointers');
  const noPointers = await capture(3.5, false, false, 'pointers');
  expect(difference(pointers, noPointers)).toBeGreaterThan(1000);
  // 十个独立时间点让 >=70% 与 >70% 分别发生在 7、8 秒。
  await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.setFeverWindow(20, 25);
    p.setFeverChargeTimes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  await page.locator('#effect-profile').selectOption('0');
  const thresholdNormal = await capture(7.25, true, false, 'pointers');
  const thresholdSuper = await capture(7.25, true, true, 'pointers');
  expect(difference(thresholdNormal, thresholdSuper)).toBe(0);
  const aboveThreshold = await capture(8.25, true, true, 'pointers');
  expect(difference(thresholdSuper, aboveThreshold)).toBeGreaterThan(1000);
  await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.setFeverWindow(10, 20);
    p.setFeverChargeTimes([1, 2, 3]);
  });
  await page.locator('#effect-profile').selectOption('1');
  const chance = await capture(3.25);
  await capture(5);
  expect(difference(chance, await capture(3.25))).toBe(0);
  await page.locator('#effect-profile').selectOption('0');
  const flash = await capture(3.25, true, true);
  await capture(5, true, true);
  expect(difference(flash, await capture(3.25, true, true))).toBe(0);
  await page.locator('#effect-profile').selectOption('1');
  expect(difference(flash, await capture(3.25, true, true))).toBeGreaterThan(1000);
  // 少量充能从画布底边出现；100% 对齐 SuperFever，不再铺满加高后的条。
  await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.setFeverWindow(200, 210);
    p.setFeverChargeTimes(Array.from({ length: 100 }, (_, i) => i + 1));
  });
  const lowCharge = await capture(1.5, true, false, 'bottom');
  const noCharge = await capture(1.5, false, false, 'bottom');
  expect(difference(lowCharge, noCharge)).toBeGreaterThan(100);
  const fullCharge = await capture(100.5, true, false, 'top');
  const noFullCharge = await capture(100.5, false, false, 'top');
  expect(difference(fullCharge, noFullCharge)).toBe(0);
  await page.evaluate(() => (window as any).__LLL_PJSK__.player.setExportMode(false));
});
