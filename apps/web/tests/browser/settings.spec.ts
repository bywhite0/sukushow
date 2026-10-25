import { test, expect } from '@playwright/test';

const historyRecord = (id: string, over: Record<string, unknown> = {}) => ({
  id, technical: 980000, level: 27, maxCombo: 10000, technicalPercent: 98,
  score: 123456789, judgements: [1, 2, 3, 4, 5, 674], userCombo: 321,
  judgementConditions: [[0, 0, 0], [0, 1, 0], [0, 0, 2], [1, 3, 0], [2, 3, 0], [0, 0, 0]],
  recordedAt: 1760000000000, cleared: true, ...over,
});

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

test('成绩页显示并管理本地成绩', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.evaluate(history => localStorage.setItem('sukushow:result-records:v1', JSON.stringify({
    version: 1,
    history,
  })), {
    '105101:MASTER': [historyRecord('high'), historyRecord('low', { technical: 900000, technicalPercent: 90, recordedAt: 1760000010000 })],
    '103114:EXPERT': [historyRecord('legato', { technical: 900000, technicalPercent: 90, score: 123456, judgements: [1, 2, 3, 4, 5, 6], userCombo: 21 })],
  });
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  await dialog.getByRole('button', { name: '成绩' }).click();
  await expect(dialog.getByRole('heading', { name: '成绩', level: 2 })).toBeVisible();
  await expect(dialog.locator('[data-record-count]')).toHaveText('2');
  await expect(dialog.locator('[data-record-history-count]')).toHaveText('3');
  await expect(dialog.locator('[data-record-player-rate]')).toHaveText('405');
  const dream = dialog.locator('[data-record-key="105101:MASTER"]');
  const legato = dialog.locator('[data-record-key="103114:EXPERT"]');
  await expect(dream.locator('[data-record-title]')).toHaveText('Dream Believers（105期Ver.）');
  await expect(dream.locator('img')).toHaveAttribute('src', '/assets/jacket/105101.png');
  await expect(dream.locator(':scope > .records-performance [data-record-rate]')).toHaveText('270');
  await expect(dream.locator(':scope > .records-performance [data-record-technical]')).toHaveText('98.0000%');
  await expect(legato.locator('[data-record-title]')).toHaveText('Legato');
  await expect(legato.locator(':scope > .records-performance [data-record-technical]')).toHaveText('90.0000%');
  await expect(legato.locator(':scope > .records-performance [data-record-score]')).toHaveText('123,456');
  await expect(legato.locator('[data-record-time]')).toHaveAttribute('datetime', new Date(1760000000000).toISOString());
  await expect(legato.locator(':scope > .records-performance .records-judgements dd')).toHaveText(['6', '5', '4', '3', '2', '1']);

  await dream.locator('.records-history > summary').click();
  await expect(dream.locator('[data-history-id]')).toHaveCount(2);
  expect(await dream.locator('[data-history-id]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.historyId)))
    .toEqual(['low', 'high']);
  const high = dream.locator('[data-history-id="high"]');
  await high.locator('.records-conditions > summary').click();
  await expect(high.locator('[data-judgement="2"] td')).toHaveText(['0', '0', '2']);
  await expect(high.locator('[data-judgement="4"] td')).toHaveText(['2', '3', '0']);
  await high.locator('[data-history-remove]').click();
  await expect(dialog.locator('[data-record-history-count]')).toHaveText('2');
  await expect(dialog.locator('[data-record-player-rate]')).toHaveText('270');
  await expect(dream.locator(':scope > .records-performance [data-record-rate]')).toHaveText('135');

  await dialog.locator('[data-record-key="105101:MASTER"] [data-record-remove]').click();
  await expect(dialog.locator('[data-record-count]')).toHaveText('1');
  await expect(dialog.locator('[data-record-status]')).toContainText('已删除该谱面的成绩');
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('sukushow:result-records:v1')!).history)))
    .toEqual(['103114:EXPERT']);

  page.once('dialog', dialog => dialog.dismiss());
  await dialog.getByRole('button', { name: '清空全部' }).click();
  await expect(dialog.locator('[data-record-count]')).toHaveText('1');
  page.once('dialog', dialog => dialog.accept());
  await dialog.getByRole('button', { name: '清空全部' }).click();
  await expect(dialog.locator('[data-record-count]')).toHaveText('0');
  await expect(dialog.locator('[data-record-player-rate]')).toHaveText('0');
  await expect(dialog.locator('[data-records-empty]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '清空全部' })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sukushow:result-records:v1')!).history)).toEqual({});
});

test('成绩文件可下载并恢复，重复导入有提示', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  await dialog.getByRole('button', { name: '成绩', exact: true }).click();
  const fileInput = dialog.locator('[data-record-import-file]');
  await expect(dialog.getByRole('button', { name: '导出成绩' })).toBeDisabled();
  const payload = { version: 1, history: { '105101:MASTER': [historyRecord('backup')] } };
  const upload = (text: string) => fileInput.setInputFiles({ name: 'results.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await upload(JSON.stringify(payload));
  await expect(dialog.locator('[data-record-status]')).toContainText('已导入 1 局成绩');
  await expect(dialog.locator('[data-record-history-count]')).toHaveText('1');
  const [download] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', { name: '导出成绩' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^sukushow-results-\d{4}-\d{2}-\d{2}\.json$/);
  const stream = await download.createReadStream();
  let backup = '';
  for await (const chunk of stream!) backup += chunk.toString();
  expect(JSON.parse(backup)).toEqual(payload);
  await upload(backup);
  await expect(dialog.locator('[data-record-status]')).toContainText('已导入 0 局成绩，跳过 1 局重复记录');
  page.once('dialog', prompt => prompt.accept());
  await dialog.getByRole('button', { name: '清空全部' }).click();
  await upload(backup);
  await expect(dialog.locator('[data-record-status]')).toContainText('已导入 1 局成绩');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sukushow:result-records:v1')!))).toEqual(JSON.parse(backup));
});

test('成绩导入失败或保存失败时显示错误并保留原记录', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  const payload = { version: 1, history: { '105101:MASTER': [historyRecord('existing')] } };
  const original = JSON.stringify(payload);
  await page.evaluate(text => localStorage.setItem('sukushow:result-records:v1', text), original);
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  await dialog.getByRole('button', { name: '成绩', exact: true }).click();
  await expect(dialog.locator('[data-record-history-count]')).toHaveText('1');
  await dialog.locator('[data-record-import-file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(dialog.locator('[data-record-status]')).toContainText('导入失败');
  expect(await page.evaluate(() => localStorage.getItem('sukushow:result-records:v1'))).toBe(original);
  await page.evaluate(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'sukushow:result-records:v1') throw new DOMException('full', 'QuotaExceededError');
      originalSetItem.call(this, key, value);
    };
  });
  await dialog.locator('[data-record-import-file]').setInputFiles({ name: 'valid.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, history: { '105101:MASTER': [historyRecord('new')] } })) });
  await expect(dialog.locator('[data-record-status]')).toContainText('浏览器无法保存成绩');
  await expect(dialog.locator('[data-record-history-count]')).toHaveText('1');
  expect(await page.evaluate(() => localStorage.getItem('sukushow:result-records:v1'))).toBe(original);
});

test('窄屏成绩明细和全局导航完整可见', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?chart=/fixture-missing.json', { waitUntil: 'domcontentloaded' });
  await page.evaluate(record => localStorage.setItem('sukushow:result-records:v1', JSON.stringify({ version: 1, history: {
    '105101:MASTER': [record],
  } })), historyRecord('narrow', { technical: 100828, level: 28, maxCombo: 1000, technicalPercent: 100.828 }));
  await page.getByRole('button', { name: '全局设置' }).click();
  const dialog = page.locator('#global-settings');
  await dialog.getByRole('button', { name: '成绩', exact: true }).click();
  await expect(dialog.locator('.records-row > .records-performance [data-record-technical]')).toHaveText('100.8280%');
  await dialog.locator('.records-row > .records-performance .records-conditions > summary').click();
  for (const target of ['.preferences-nav', '[data-page-panel="records"]', '.records-row']) {
    expect(await dialog.locator(target).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  for (const label of ['外观', '成绩', '缓存', '关于 sukushow', '关闭全局设置']) {
    await expect(dialog.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
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
