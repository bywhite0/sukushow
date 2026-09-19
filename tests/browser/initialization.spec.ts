import { test, expect } from '@playwright/test';

for (const missingSe of [false, true]) {
  test(`SE ${missingSe ? '缺失' : '可用'}时初始化完成并支持播放暂停`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    if (missingSe) await page.route('**/se/*.wav', route => route.fulfill({ status: 404, body: '' }));
    await page.goto('/');
    await expect(page.locator('#message')).toContainText('就绪');
    await expect(page.locator('.hud')).toBeAttached();
    const play = page.getByRole('button', { name: '播放', exact: true });
    await expect(play).toBeEnabled();
    await play.click();
    await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-time'))).toBeGreaterThan(0.1);
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await expect(play).toBeVisible();
    expect(errors).toEqual([]);
  });
}
