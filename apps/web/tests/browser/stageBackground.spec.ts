import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const COMPOSITOR_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/stageCompositor.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

const CANVAS_KIT_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/canvasKit.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

test('背景缓存保持旧背景的预览与导出尺寸像素', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__LPW__?.compositor))).toBe(true);
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  const differences = await page.evaluate(async (url) => {
    const { StageCompositor, LIVE_BG_URL, LIVE_BG_DOT_URL } = await import(url);
    const { image } = await import(url.replace('stageCompositor.ts', 'canvasKit.ts'));
    const a = new StageCompositor(document.createElement('canvas'));
    const b = new StageCompositor(document.createElement('canvas'));
    const emptyLayers = { gl: null, hud: null, startAnim: null, comboResult: null };
    const results: { size: string; changed: number; maxDelta: number }[] = [];
    for (const [width, height, dpr, dim] of [[320, 180, 1, 0], [320, 180, 2, 0], [1280, 720, 1, 0], [1920, 1080, 1, .35], [320, 180, 1, 0]]) {
      const view = { cssW: width, cssH: height, dpr };
      a.setBackgroundDim(dim);
      b.setBackgroundDim(dim);
      a.canvas.width = width * dpr; a.canvas.height = height * dpr;
      const ctx = a.canvas.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      (a as any).drawLiveBg(ctx, view, image(LIVE_BG_URL), image(LIVE_BG_DOT_URL));
      b.draw(view, emptyLayers);
      const oldPixels = ctx.getImageData(0, 0, a.canvas.width, a.canvas.height).data;
      const newPixels = b.canvas.getContext('2d')!.getImageData(0, 0, b.canvas.width, b.canvas.height).data;
      let changed = 0, maxDelta = 0;
      for (let i = 0; i < oldPixels.length; i++) {
        const delta = Math.abs(oldPixels[i] - newPixels[i]);
        if (delta) changed++;
        maxDelta = Math.max(maxDelta, delta);
      }
      results.push({ size: `${width}x${height}@${dpr}:${dim}`, changed, maxDelta });
    }
    return results;
  }, COMPOSITOR_URL);
  for (const row of differences) {
    expect(row.changed, row.size).toBe(0);
    expect(row.maxDelta, row.size).toBe(0);
  }
});

test('背景缓存与逐帧背景在完整预览及导出画面中一致', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__LPW__?.renderer))).toBe(true);
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  const differences = await page.evaluate(async (url) => {
    const { StageCompositor, LIVE_BG_URL, LIVE_BG_DOT_URL } = await import(url);
    const { image } = await import(url.replace('stageCompositor.ts', 'canvasKit.ts'));
    const { demoChart } = await import(url.replace('stageCompositor.ts', 'demo.ts'));
    const { renderer, hud, startAnim, comboResult } = (window as any).__LPW__;
    const gl = document.querySelector<HTMLCanvasElement>('#chart-canvas')!;
    const chart = demoChart();
    const cached = new StageCompositor(document.createElement('canvas'));
    const reference = new StageCompositor(document.createElement('canvas'));
    const results: { size: string; changed: number; maxDelta: number }[] = [];
    for (const [width, height] of [[960, 540], [1280, 720], [1920, 1080], [960, 540]]) {
      const view = { cssW: width, cssH: height, dpr: 1 };
      renderer.setFixedSize({ w: width, h: height, dpr: 1 });
      renderer.setPlaying(false);
      renderer.render(chart, 5, 5, false, true);
      hud.sync(chart, 5, false);
      startAnim.show(null);
      comboResult.hide();
      const layers = { gl, hud, startAnim, comboResult };
      const ctx = reference.canvas.getContext('2d')!;
      reference.canvas.width = width; reference.canvas.height = height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      (reference as any).drawLiveBg(ctx, view, image(LIVE_BG_URL), image(LIVE_BG_DOT_URL));
      ctx.drawImage(gl, 0, 0, width, height);
      hud.draw(ctx, view);
      startAnim.draw(ctx, view);
      comboResult.draw(ctx, view);
      cached.draw(view, layers);
      const oldPixels = ctx.getImageData(0, 0, width, height).data;
      const newPixels = cached.canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
      let changed = 0, maxDelta = 0;
      for (let i = 0; i < oldPixels.length; i++) {
        const delta = Math.abs(oldPixels[i] - newPixels[i]);
        if (delta) changed++;
        maxDelta = Math.max(maxDelta, delta);
      }
      results.push({ size: `${width}x${height}`, changed, maxDelta });
    }
    renderer.setFixedSize(null);
    return results;
  }, COMPOSITOR_URL);
  for (const row of differences) {
    expect(row.changed, row.size).toBe(0);
    expect(row.maxDelta, row.size).toBe(0);
  }
});

test('缓存背景复用时每帧仍更新 WebGL 与 HUD', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__LPW__?.compositor))).toBe(true);
  const counts = await page.evaluate(async (url) => {
    const { StageCompositor } = await import(url);
    const canvas = document.createElement('canvas');
    const compositor = new StageCompositor(canvas);
    const gl = document.createElement('canvas');
    gl.width = 320; gl.height = 180;
    const frames = { hud: 0, gl: 0 };
    const hud = { draw: () => { frames.hud++; } };
    const ctx = canvas.getContext('2d')!;
    const original = ctx.drawImage.bind(ctx);
    ctx.drawImage = ((...args: unknown[]) => {
      if (args[0] === gl) frames.gl++;
      (original as (...values: unknown[]) => void)(...args);
    }) as CanvasRenderingContext2D['drawImage'];
    for (let i = 0; i < 2; i++) {
      compositor.draw({ cssW: 320, cssH: 180, dpr: 1 }, { gl, hud, startAnim: null, comboResult: null });
    }
    return frames;
  }, COMPOSITOR_URL);
  expect(counts).toEqual({ hud: 2, gl: 2 });
});

test('贴图解码后缓存重新生成，未改变上层绘制顺序', async ({ page }) => {
  let resolveBg!: () => void, resolveDot!: () => void;
  const bg = new Promise<void>(resolve => { resolveBg = resolve; });
  const dot = new Promise<void>(resolve => { resolveDot = resolve; });
  await page.route('**/in_game_difficulty_bg_101.png', async route => { await bg; await route.continue(); });
  await page.route('**/sc2_ingame_bg_pattern_dot.png', async route => { await dot; await route.continue(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__LPW__?.compositor))).toBe(true);
  const read = () => page.evaluate(() => {
    const background = (window as any).__LPW__.compositor.backgroundCanvas as HTMLCanvasElement | null;
    if (!background) return 0;
    const data = background.getContext('2d')!.getImageData(0, 0, background.width, background.height).data;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619);
    return hash >>> 0;
  });
  const initial = await read();
  resolveBg();
  await expect.poll(async () => page.evaluate(async (url) => (await import(url)).image('/in_game_difficulty_bg_101.png') !== null, CANVAS_KIT_URL)).toBe(true);
  await expect.poll(read, { timeout: 15_000 }).not.toBe(initial);
  const afterBg = await read();
  resolveDot();
  await expect.poll(async () => page.evaluate(async (url) => (await import(url)).image('/sc2_ingame_bg_pattern_dot.png') !== null, CANVAS_KIT_URL)).toBe(true);
  await expect.poll(read, { timeout: 15_000 }).not.toBe(afterBg);
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
});
