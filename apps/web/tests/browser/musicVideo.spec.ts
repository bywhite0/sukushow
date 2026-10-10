import { expect, test } from '@playwright/test';

const SONG = '103103';

async function openMv(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  const chart = await request.get('/assets/chart/rhythmgame_chart_103103_04.bytes');
  const mv = await request.get(`/assets/mv/${SONG}.mp4`, { method: 'HEAD' });
  test.skip(!chart.ok() || !mv.ok(), '本地曲目谱面 / MV 尚未解包');
  await page.goto(`/?song=${SONG}&difficulty=MASTER`);
  await expect(page.locator('#message')).toContainText('已加载', { timeout: 30_000 });
  await expect(page.locator('#message')).toContainText('MV ✓');
  await expect(page.locator('[data-resource-loading]')).toBeHidden();
  await page.getByRole('tab', { name: '显示与特效' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__?.musicVideo?.frame(0)?.readyState ?? 0), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
}

test('MV 关/开、拖动、暂停、倍率、切换演示谱，画面与走带保持一致', async ({ page, request }) => {
  test.setTimeout(90_000);
  await openMv(page, request);
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '3'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.musicVideo.frame(3)?.currentTime ?? -1)).toBeCloseTo(3, 1);
  await page.locator('#opt-mv').uncheck();
  await expect(page.locator('#stage-canvas')).not.toHaveAttribute('data-mv', SONG);
  await page.locator('#opt-mv').check();
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
  await page.locator('#rate').selectOption('1.5');
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.musicVideo.frame((window as any).__LPW__.player.transport.time)?.playbackRate ?? 0)).toBe(1.5);
  await page.locator('#play').click();
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.musicVideo.frame((window as any).__LPW__.player.transport.time)?.paused ?? false)).toBe(true);
  await page.locator('#demo').click();
  await expect(page.locator('#stage-canvas')).not.toHaveAttribute('data-mv', SONG);
});

test('切歌谱面下载失败时保留原曲和原 MV', async ({ page, request }) => {
  test.setTimeout(90_000);
  await openMv(page, request);
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '3'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
  await page.route('**/assets/chart/rhythmgame_chart_203102_04.bytes', (route) => route.fulfill({ status: 404, body: '' }));
  await page.locator('#song-search').fill('203102');
  await page.locator('.song-option').first().click();
  await expect(page.locator('#message')).toContainText('曲目加载失败');
  await expect(page.locator('#chart-name')).toContainText('フォーチュンムービー');
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
});

test('原包电影轨道非零起点：开始前保持普通背景，之后按片段起点定位', async ({ page, request }) => {
  test.setTimeout(90_000);
  const chart = await request.get('/assets/chart/rhythmgame_chart_203102_04.bytes');
  const mv = await request.get('/assets/mv/203102.mp4', { method: 'HEAD' });
  test.skip(!chart.ok() || !mv.ok(), '本地 203102 谱面 / MV 尚未解包');
  await page.goto('/?song=203102&difficulty=MASTER');
  await expect(page.locator('#message')).toContainText('已加载', { timeout: 30_000 });
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '1.5'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', '203102');
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '4'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', '203102');
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.musicVideo.frame(4)?.currentTime ?? -1)).toBeCloseTo(4 - 1.9666666666666668, 1);
});

 test('曲终横幅等待 304109 的实际 BGM 结束，而不是只按 PlayTime 触发', async ({ page, request }) => {
  const song = '304109';
  const list = await (await request.get('/song-list.json')).json();
  const entry = list.songs.find((item: any) => item.id === song);
  const chart = await request.get(`/assets/chart/${entry.charts.MASTER}`);
  const audio = await request.get(`/assets/audio/bgm_${entry.soundId}.ogg`, { method: 'HEAD' });
  test.skip(!chart.ok() || !audio.ok(), '本地 304109 谱面 / BGM 尚未准备');
  await page.goto(`/?song=${song}&difficulty=MASTER`);
  await expect(page.locator('#message')).toContainText('已加载', { timeout: 30_000 });
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '104.4'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-result', '');
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '106.9'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-result', '0');
});


test('MV 播放到音频结束后仍继续显示到电影自身结尾', async ({ page, request }) => {
  test.setTimeout(90_000);
  await openMv(page, request);
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.player.transport.duration)).toBeGreaterThan(83);
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', '103103');
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '80'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.musicVideo.frame(80)?.currentTime ?? -1)).toBeCloseTo(80, 1);
});


test('导出含 MV 的片段时编码帧采集当前视频时刻，返回后恢复预览', async ({ page, request }) => {
  test.setTimeout(120_000);
  await openMv(page, request);
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '2'; node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
  await page.evaluate(() => {
    const samples: { requested: number; actual: number; onStage: boolean }[] = [];
    (window as any).__mvExportSamples = samples;
    const mv = (window as any).__LPW__.musicVideo;
    const seekFrame = mv.seekFrame.bind(mv);
    let requested = -1;
    let decoded: HTMLVideoElement | null = null;
    mv.seekFrame = async (time: number) => {
      requested = time;
      decoded = await seekFrame(time);
      return decoded;
    };
    const encode = VideoEncoder.prototype.encode;
    VideoEncoder.prototype.encode = function(frame, options) {
      samples.push({
        requested,
        actual: decoded?.currentTime ?? -1,
        onStage: document.querySelector<HTMLCanvasElement>('#stage-canvas')!.dataset.mv === '103103',
      });
      return encode.call(this, frame, options);
    };
  });
  await page.locator('#export-video').click();
  await page.locator('[name="resolution"]').selectOption('720p');
  await page.locator('[name="fps"]').selectOption('30');
  await page.locator('[name="opening"]').uncheck();
  await page.locator('[name="start"]').fill('2');
  await page.locator('[name="end"]').fill('2.1');
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
  const samples = await page.evaluate(() => (window as any).__mvExportSamples as { requested: number; actual: number; onStage: boolean }[]);
  expect(samples).toHaveLength(3);
  samples.forEach((sample, index) => {
    expect(sample.requested).toBeCloseTo(2 + index / 30, 3);
    expect(sample.actual).toBeCloseTo(sample.requested, 2);
    expect(sample.onStage).toBe(true);
  });
  await page.locator('[data-close]').click();
  await expect(page.locator('#stage-canvas')).toHaveAttribute('data-mv', SONG);
});
