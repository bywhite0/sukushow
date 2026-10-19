import { expect, test } from '@playwright/test';

test('手动开启 MV 时计入加载任务和资源大小，就绪后解锁', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('llll-pjsk-preview:settings:v1', JSON.stringify({ enableMusicVideo: false })));
  await page.goto('/?view=pjsk&song=103103&difficulty=MASTER');
  await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 90_000 });
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/assets/mv/103103**', async route => {
    // 只挡住媒体数据本身（HLS 分片或单文件 mp4）：播放列表和 HEAD 体积探测
    // 都要放行，否则加载进度的总量算不出来，加载层也不会显示大小。
    const request = route.request();
    const url = request.url();
    const isMedia = url.endsWith('.m4s') || url.endsWith('.mp4');
    if (request.method() === 'GET' && isMedia) await gate;
    await route.continue();
  });
  await page.locator('[data-inspector-toggle]').click();
  await page.locator('#tab-display').click();
  await page.locator('#opt-mv').check();
  try {
    await expect(page.locator('[data-resource-loading]')).toBeVisible();
    await expect(page.locator('[data-resource-loading-title]')).toContainText('MV');
    await expect(page.locator('[data-resource-loading-size]')).toContainText('MB');
    await expect(page.locator('#play')).toBeDisabled();
  } finally {
    release();
  }
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#play')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__LLL_PJSK__.musicVideo.useVideoBackground)).toBe(true);
});

test('开启 MV 下载失败后报告回退并解除加载锁', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('llll-pjsk-preview:settings:v1', JSON.stringify({ enableMusicVideo: false })));
  await page.goto('/?view=pjsk&song=103103&difficulty=MASTER');
  await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 90_000 });
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  // 两种产物形态都要挡：切过的是 mv/<id>/**，没切过的是 mv/<id>.mp4。
  await page.route('**/assets/mv/103103**', route => route.fulfill({ status: 404, body: '' }));
  await page.locator('[data-inspector-toggle]').click();
  await page.locator('#tab-display').click();
  await page.locator('#opt-mv').check();
  await expect(page.locator('#message')).toContainText('MV 加载失败');
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await expect(page.locator('#play')).toBeEnabled();
});
