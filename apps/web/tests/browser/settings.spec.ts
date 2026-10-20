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

test('缓存页显示两个默认状态不同的开关，并按分类清理缓存', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  await dialog.getByRole('button', { name: '缓存' }).click();
  await expect(dialog.getByRole('heading', { name: '缓存', level: 2 })).toBeVisible();

  const total = dialog.locator('[data-cache-total]');
  const renderer = dialog.locator('[data-cache-group="renderer"]');
  const audio = dialog.locator('[data-cache-group="audio"]');
  const mv = dialog.locator('[data-cache-group="mv"]');
  const chart = dialog.locator('[data-cache-group="chart"]');
  const jacket = dialog.locator('[data-cache-group="jacket"]');
  const offlineToggle = dialog.locator('[data-cache-offline]');
  const songToggle = dialog.locator('[data-cache-song]');
  // 开发服务器不注册 Service Worker，两个开关都只展示当前持久化状态。
  await expect(offlineToggle).toBeDisabled();
  await expect(songToggle).toBeDisabled();
  // 歌曲资源缓存默认关闭。
  await expect(songToggle).not.toBeChecked();
  await expect(dialog.locator('[data-cache-support]')).toBeVisible();
  await expect(dialog.locator('[data-cache-song-support]')).toBeVisible();
  // 歌曲资源被拆成音频 / MV / 谱面 / 曲绘四类，各带一个清理按钮。
  await expect(dialog.locator('.cache-groups-heading')).toHaveText('歌曲资源');
  await expect.poll(async () => total.textContent()).toBe('0 B · 0 项');
  await expect(renderer).toHaveText('0 B · 0 项');
  for (const group of [audio, mv, chart, jacket]) await expect(group).toHaveText('0 B · 0 项');
  const clearRenderer = dialog.locator('[data-cache-clear-group="renderer"]');
  const clearAudio = dialog.locator('[data-cache-clear-group="audio"]');
  const clearChart = dialog.locator('[data-cache-clear-group="chart"]');
  const clearAll = dialog.getByRole('button', { name: '清理全部缓存' });
  await expect(clearRenderer).toBeDisabled();
  await expect(clearAudio).toBeDisabled();
  await expect(clearChart).toBeDisabled();
  await expect(clearAll).toBeDisabled();

  // 直接写入三条不同分类的缓存，验证统计与分类清理走的是真实的 Cache Storage。
  await page.evaluate(async () => {
    const rendererCache = await caches.open('sukushow-renderer-assets-v1');
    await rendererCache.put('/rg/cache-test.png', new Response(new Uint8Array(2048), { headers: { 'content-length': '2048' } }));
    const audioCache = await caches.open('sukushow-song-audio-v1');
    await audioCache.put('/assets/audio/cache-test.ogg', new Response(new Uint8Array(512), { headers: { 'content-length': '512' } }));
    const chartCache = await caches.open('sukushow-song-chart-v1');
    await chartCache.put('/assets/chart/cache-test.bytes', new Response(new Uint8Array(1024), { headers: { 'content-length': '1024' } }));
  });
  await dialog.getByRole('button', { name: '重新统计' }).click();
  await expect.poll(async () => total.textContent()).toBe('3.58 KB · 3 项');
  await expect(renderer).toHaveText('2.05 KB · 1 项');
  await expect(audio).toHaveText('512 B · 1 项');
  await expect(chart).toHaveText('1.02 KB · 1 项');
  await expect(mv).toHaveText('0 B · 0 项');
  await expect(jacket).toHaveText('0 B · 0 项');
  await expect(clearRenderer).toBeEnabled();
  await expect(clearAudio).toBeEnabled();
  await expect(clearChart).toBeEnabled();
  await expect(clearAll).toBeEnabled();

  // 只清理歌曲音频：渲染资源与谱面不受影响。
  await clearAudio.click();
  await expect(dialog.locator('[data-cache-status]')).toContainText('已清理歌曲音频缓存（1 项 · 512 B）');
  await expect.poll(async () => total.textContent()).toBe('3.07 KB · 2 项');
  await expect(clearAudio).toBeDisabled();
  await expect(clearChart).toBeEnabled();
  expect(await page.evaluate(async () => (await caches.keys()).includes('sukushow-song-audio-v1'))).toBe(false);

  await clearRenderer.click();
  await expect(dialog.locator('[data-cache-status]')).toContainText('已清理渲染资源缓存（1 项 · 2.05 KB）');
  await expect.poll(async () => total.textContent()).toBe('1.02 KB · 1 项');
  expect(await page.evaluate(async () => (await caches.keys()).includes('sukushow-renderer-assets-v1'))).toBe(false);

  await clearChart.click();
  await expect(dialog.locator('[data-cache-status]')).toContainText('已清理歌曲谱面缓存（1 项 · 1.02 KB）');
  await expect.poll(async () => total.textContent()).toBe('0 B · 0 项');
  expect(await page.evaluate(async () => (await caches.keys()).includes('sukushow-song-chart-v1'))).toBe(false);
});

test('窄屏缓存页入口可见且内容不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  const cacheNav = dialog.getByRole('button', { name: '缓存' });
  await expect(cacheNav).toBeVisible();
  await cacheNav.click();
  await expect(dialog.getByRole('heading', { name: '缓存', level: 2 })).toBeVisible();
  await expect(dialog.locator('[data-cache-total]')).toBeVisible();
  await expect(dialog.locator('[data-cache-song]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '重新统计' })).toBeVisible();
  // 每个分类都带「清理」按钮，窄屏下不能横向溢出。
  const groupsOverflow = await dialog.locator('.cache-groups').evaluateAll((nodes) =>
    Math.max(...nodes.map((node) => node.scrollWidth - node.clientWidth)));
  expect(groupsOverflow).toBeLessThanOrEqual(1);
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
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
