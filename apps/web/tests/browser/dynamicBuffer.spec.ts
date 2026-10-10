import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const CHART_MODULE_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/chart/src/chart.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

const OLD_UPLOAD = `export function flushDynamicGeometry(geometry, vertices) {
  geometry.setDrawRange(0, vertices);
  for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;
}`;

async function preparePage(page: Page, oldUpload = false): Promise<number> {
  let replaced = 0;
  if (oldUpload) await page.route('**/packages/llll-preview/src/dynamicBuffer.ts*', (route) => {
    replaced++;
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: OLD_UPLOAD });
  });
  await page.goto('/?view=llll');
  await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(25);
  await page.evaluate(async () => {
    await (window as any).__LPW__.renderer.whenReady();
    await document.fonts.ready;
  });
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  return replaced;
}

const CHART = {
  Notes: Array.from({ length: 2000 }, (_, i) => ({
    Uid: i + 1,
    just: String(Number((2 + i * .012).toFixed(4))),
    Flags: (i % 48) * 65536 + (i % 48 + 3) * 16,
    holds: [],
  })),
  Bpms: [{ Time: 0, Bpm: 120 }],
};

test('局部上传在密集谱和 2D/3D 相机下保留 WebGL 谱面像素', async ({ browser }) => {
  test.setTimeout(120_000);
  const baseline = await browser.newPage();
  const optimized = await browser.newPage();
  try {
    const hits = await preparePage(baseline, true);
    await preparePage(optimized);
    expect(hits).toBeGreaterThan(0);
    for (const page of [baseline, optimized]) {
      await page.locator('#chart-file').setInputFiles({ name: 'dense.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(CHART)) });
      await expect(page.locator('#message')).toContainText('已加载 dense.json');
      await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
        el.value = '12'; el.dispatchEvent(new Event('input'));
      });
      await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-visible-notes'))).toBeGreaterThan(100);
    }
    for (const mode of ['3d', '2d'] as const) {
      const pixels = async (page: Page, time: number) => page.evaluate(async ({ chart, url, mode, time }) => {
        const { parseChart } = await import(url);
        const renderer = (window as any).__LPW__.renderer;
        renderer.setCameraMode(mode);
        renderer.setHitEffectMode('off');
        renderer.setPlaying(false);
        renderer.render(parseChart(chart), time, 5, false, true);
        const gl = renderer.gl.getContext() as WebGLRenderingContext;
        const canvas = renderer.domElement as HTMLCanvasElement;
        const rgba = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const hash = await crypto.subtle.digest('SHA-256', rgba);
        return { hash: Array.from(new Uint8Array(hash)), visible: canvas.dataset.visibleNotes, size: [canvas.width, canvas.height] };
      }, { chart: CHART, url: CHART_MODULE_URL, mode, time });
      for (const time of [0, 12, 30, 12]) {
        const a = await pixels(baseline, time);
        const b = await pixels(optimized, time);
        expect(b.size).toEqual(a.size);
        expect(b.visible).toBe(a.visible);
        expect(b.hash, `${mode} @${time}s WebGL 帧`).toEqual(a.hash);
      }
    }
  } finally {
    await baseline.close();
    await optimized.close();
  }
});

test('导出每帧在局部上传与整数组上传下逐像素一致', async ({ browser }) => {
  test.setTimeout(150_000);
  const frames = async (oldUpload: boolean) => {
    const page = await browser.newPage();
    try {
      const hits = await preparePage(page, oldUpload);
      if (oldUpload) expect(hits).toBeGreaterThan(0);
      await page.locator('#export-video').click();
      await page.locator('[name="resolution"]').selectOption('720p');
      await page.locator('[name="fps"]').selectOption('30');
      await page.locator('[name="opening"]').uncheck();
      await page.locator('[name="start"]').fill('2');
      await page.locator('[name="end"]').fill('2.2');
      await page.evaluate(() => {
        const hashes: Promise<number[]>[] = [];
        (window as any).__frameHashes = hashes;
        const original = VideoEncoder.prototype.encode;
        VideoEncoder.prototype.encode = function(frame, options) {
          original.call(this, frame, options);
          const canvas = document.querySelector<HTMLCanvasElement>('#stage-canvas')!;
          const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          hashes.push(crypto.subtle.digest('SHA-256', rgba).then(hash => Array.from(new Uint8Array(hash))));
        };
      });
      await page.locator('[data-start]').click();
      await expect(page.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
      return await page.evaluate(async () => Promise.all((window as any).__frameHashes as Promise<number[]>[]));
    } finally {
      await page.close();
    }
  };
  await frames(true);
  const baseline = await frames(true);
  const optimized = await frames(false);
  expect(baseline).toHaveLength(6);
  expect(optimized).toEqual(baseline);
});

test('空画面不提交动态缓冲，密集谱仅提交活跃顶点', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = (window as any).__webglUpload = { active: false, uploads: [] as number[] };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = proto.bufferSubData;
      proto.bufferSubData = function(...args: Parameters<typeof original>) {
        if (probe.active) {
          const data = args[2] as ArrayBufferView;
          probe.uploads.push(args.length > 4 ? Number(args[4]) * (data as any).BYTES_PER_ELEMENT : data.byteLength);
        }
        return original.apply(this, args);
      } as typeof original;
    }
  });
  await page.goto('/');
  await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(25);
  await page.evaluate(() => (window as any).__LPW__.renderer.whenReady());
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-visible-notes', '0');
  const empty = await page.evaluate(async () => {
    const probe = (window as any).__webglUpload;
    probe.uploads = [];
    probe.active = true;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    probe.active = false;
    return probe.uploads.reduce((a: number, b: number) => a + b, 0);
  });
  expect(empty).toBe(0);

  await page.locator('#chart-file').setInputFiles({ name: 'dense.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(CHART)) });
  await expect(page.locator('#message')).toContainText('已加载 dense.json');
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => {
    el.value = '12'; el.dispatchEvent(new Event('input'));
  });
  await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-visible-notes'))).toBeGreaterThan(100);
  const dense = await page.evaluate(async () => {
    const probe = (window as any).__webglUpload;
    probe.uploads = [];
    probe.active = true;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    probe.active = false;
    return probe.uploads.reduce((a: number, b: number) => a + b, 0);
  });
  expect(dense).toBeGreaterThan(0);
  expect(dense).toBeLessThan(1024 * 1024);
});
