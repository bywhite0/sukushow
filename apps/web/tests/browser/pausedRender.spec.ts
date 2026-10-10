import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const CANVAS_KIT_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/canvasKit.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;
const DEMO_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/demo.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

type Counts = { render: number; hud: number; compose: number };

async function watch(page: Page) {
  await page.goto('/?view=llll');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__LPW__?.renderer))).toBe(true);
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  await page.evaluate(() => {
    const { renderer, hud, compositor } = (window as any).__LPW__;
    const counts: Counts = { render: 0, hud: 0, compose: 0 };
    (window as any).__pausedRenderCounts = counts;
    for (const [object, method, key] of [
      [renderer, 'render', 'render'], [hud, 'draw', 'hud'], [compositor, 'draw', 'compose'],
    ] as const) {
      const original = object[method].bind(object);
      object[method] = (...args: unknown[]) => {
        counts[key]++;
        return original(...args);
      };
    }
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => Object.assign((window as any).__pausedRenderCounts, { render: 0, hud: 0, compose: 0 }));
}

const counts = (page: Page): Promise<Counts> => page.evaluate(() => ({ ...(window as any).__pausedRenderCounts }));

async function expectOneRefresh(page: Page) {
  await expect.poll(async () => (await counts(page)).render).toBeGreaterThan(0);
  await expect.poll(async () => (await counts(page)).compose).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  const current = await counts(page);
  expect(current.render).toBeLessThanOrEqual(2);
  expect(current.compose).toBeLessThanOrEqual(2);
  await page.evaluate(() => Object.assign((window as any).__pausedRenderCounts, { render: 0, hud: 0, compose: 0 }));
}

test('暂停帧静止时跳过 WebGL、HUD 与舞台合成，继续播放时逐帧更新', async ({ page }) => {
  await watch(page);
  await page.waitForTimeout(300);
  expect(await counts(page)).toEqual({ render: 0, hud: 0, compose: 0 });
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
    el.value = '2.2'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectOneRefresh(page);
  await page.locator('#play').click();
  await expect.poll(async () => (await counts(page)).render).toBeGreaterThan(3);
  await page.evaluate(() => Object.assign((window as any).__pausedRenderCounts, { render: 0, hud: 0, compose: 0 }));
  await page.locator('#play').click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await page.waitForTimeout(100);
  await page.evaluate(() => Object.assign((window as any).__pausedRenderCounts, { render: 0, hud: 0, compose: 0 }));
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual({ render: 0, hud: 0, compose: 0 });
});

test('暂停时仅改变音量不重绘舞台', async ({ page }) => {
  await watch(page);
  await page.getByRole('tab', { name: '音量' }).click();
  await page.locator('#volume').fill('0.5');
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual({ render: 0, hud: 0, compose: 0 });
});

test('暂停时拖动、显示设置、相机与尺寸变化刷新一次画面', async ({ page }) => {
  await watch(page);
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
    el.value = '2.2'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectOneRefresh(page);
  await page.locator('#speed').fill('7');
  await expectOneRefresh(page);
  await page.getByRole('tab', { name: '显示与特效' }).click();
  await page.locator('#opt-bg-dark').fill('35');
  await expectOneRefresh(page);
  await page.locator('#opt-ap-continue').uncheck();
  await expectOneRefresh(page);
  await page.locator('#opt-fever-start').fill('1');
  await page.locator('#opt-fever-end').fill('3');
  await expectOneRefresh(page);
  await page.locator('#fever-reset').click();
  await expectOneRefresh(page);
  await page.locator('.stage-mode-switch button[data-stage-mode="2d"]').click();
  await expectOneRefresh(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expectOneRefresh(page);
  await page.locator('#chart-file').setInputFiles({
    name: '暂停换谱.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '2.2', Flags: 80, holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  });
  await expect(page.locator('#message')).toContainText('已加载 暂停换谱.json');
  await expectOneRefresh(page);
});

test('暂停预览导出后恢复原尺寸并只重绘一次', async ({ page }) => {
  test.setTimeout(120_000);
  await watch(page);
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
    el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectOneRefresh(page);
  const liveSize = await page.locator('#stage-canvas').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height]);
  await page.locator('#export-video').click();
  await page.locator('[name="resolution"]').selectOption('720p');
  await page.locator('[name="fps"]').selectOption('30');
  await page.locator('[name="opening"]').uncheck();
  await page.locator('[name="start"]').fill('2');
  await page.locator('[name="end"]').fill('2.2');
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => page.locator('#stage-canvas').evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual(liveSize);
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '5.0000');
  expect((await counts(page)).render).toBeGreaterThanOrEqual(7);
  await page.locator('[data-close]').click();
  await page.evaluate(() => Object.assign((window as any).__pausedRenderCounts, { render: 0, hud: 0, compose: 0 }));
  await page.waitForTimeout(250);
  expect(await counts(page)).toEqual({ render: 0, hud: 0, compose: 0 });
});

test('暂停时独立加载的 APRate 贴图就绪后刷新画面', async ({ page }) => {
  await watch(page);
  await page.evaluate(() => (window as any).__LPW__.hud.loadApRateTextures());
  await expectOneRefresh(page);
});

test('暂停时跳过的帧与显式重画同一时刻画面一致', async ({ page }) => {
  await watch(page);
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
    el.value = '2.2'; el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expectOneRefresh(page);
  const result = await page.evaluate(async (url) => {
    const { demoChart } = await import(url);
    const { hud, renderer, compositor, startAnim, comboResult, player } = (window as any).__LPW__;
    const stage = document.querySelector<HTMLCanvasElement>('#stage-canvas')!;
    const gl = document.querySelector<HTMLCanvasElement>('#chart-canvas')!;
    const view = { cssW: stage.clientWidth, cssH: stage.clientHeight, dpr: Math.min(2, devicePixelRatio) };
    const image = async () => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', stage.getContext('2d')!.getImageData(0, 0, stage.width, stage.height).data)));
    const before = await image();
    const t = player.transport.time;
    const chart = demoChart();
    hud.sync(chart, t, false);
    renderer.setPlaying(false);
    renderer.setFeverState(hud.feverVisible, hud.feverWindowStart);
    renderer.render(chart, t, Number((document.querySelector('#speed') as HTMLInputElement).value),
      (document.querySelector('#mirror') as HTMLInputElement).checked, (document.querySelector('#lines') as HTMLInputElement).checked);
    startAnim.show(null);
    compositor.draw(view, { gl, hud, startAnim, comboResult });
    return { before, after: await image() };
  }, DEMO_URL);
  expect(result.after).toEqual(result.before);
});

test('暂停时贴图就绪后刷新画面', async ({ page }) => {
  await watch(page);
  await page.evaluate(async (url) => {
    const { preloadImages } = await import(url);
    await preloadImages(['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/T9sAAAAASUVORK5CYII=']);
  }, CANVAS_KIT_URL);
  await expectOneRefresh(page);
});
