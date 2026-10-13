import { expect, test } from '@playwright/test';

test('曲终时序覆盖主数据、无 BGM、未知曲目与 MV 尾段', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?view=pjsk');
  await page.waitForFunction(() => Boolean((window as any).__LLL_PJSK__?.getChart?.()), null, { timeout: 90_000 });
  const cases = await page.evaluate(() => {
    const p = (window as any).__LLL_PJSK__.player;
    p.setSongTiming(100, 120);
    const known = p.getStateSnapshot();
    p.setSongTiming(null, 120);
    const unknown = p.getStateSnapshot();
    p.setSongTiming(100, 36);
    const result = p.getStateSnapshot();
    return { known, unknown, result };
  });
  expect(cases.known.apStartSec).toBe(109);
  expect(cases.known.durationSec).toBe(129);
  expect(cases.unknown.apStartSec).toBe(Infinity);
  expect(cases.unknown.durationSec).toBe(129);
  expect(cases.result.durationSec).toBeCloseTo(119.3, 5);
});

test('MV 缺失不阻断预览，清除媒体后不沿用上一首音视频', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/assets/mv/*.mp4', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?view=pjsk&song=103103&difficulty=MASTER');
  await expect(page.locator('#message')).toContainText('フォーチュン', { timeout: 90_000 });
  expect(await page.evaluate(() => (window as any).__LLL_PJSK__.musicVideo.useVideoBackground)).toBe(false);
  await page.getByRole('button', { name: '媒体', exact: true }).click();
  await page.locator('[data-media-kind="audio"] [data-media-clear]').click();
  await page.locator('[data-media-kind="mv"] [data-media-clear]').click();
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await expect(page.locator('#chart-name')).toContainText('フォーチュン');
  const state = await page.evaluate(() => {
    const { player, musicVideo } = (window as any).__LLL_PJSK__;
    return { ...player.getStateSnapshot(), video: musicVideo.useVideoBackground };
  });
  expect(state.hasAudio).toBe(false);
  expect(state.video).toBe(false);
  expect(state.apStartSec).toBeCloseTo(87.545, 3);
});
