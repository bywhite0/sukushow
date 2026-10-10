import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const CANVAS_KIT_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/canvasKit.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

test('局部离屏分组在预览和导出尺寸下保留 Alpha 与 1 色阶内的 RGB', async ({ page }) => {
  await page.goto('/');
  const comparisons = await page.evaluate(async (url) => {
    const { drawGroup } = await import(url);
    type Context = CanvasRenderingContext2D;
    type Bounds = { x: number; y: number; w: number; h: number };
    type Options = { bounds?: Bounds; alpha?: number; filter?: string; composite?: GlobalCompositeOperation; mask?: (ctx: Context) => void; pad?: number };
    type Group = (ctx: Context, options: Options, draw: (ctx: Context) => void) => void;
    const reference: Group = (ctx, options, draw) => {
      if ((options.alpha ?? 1) <= 0) return;
      const { width, height } = ctx.canvas;
      const matrix = ctx.getTransform();
      const corners = options.bounds ? [
        [options.bounds.x, options.bounds.y],
        [options.bounds.x + options.bounds.w, options.bounds.y],
        [options.bounds.x, options.bounds.y + options.bounds.h],
        [options.bounds.x + options.bounds.w, options.bounds.y + options.bounds.h],
      ].map(([x, y]) => [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f]) : null;
      const pad = options.pad ?? 2;
      const box = corners ? {
        x: Math.max(0, Math.floor(Math.min(...corners.map(p => p[0])) - pad)),
        y: Math.max(0, Math.floor(Math.min(...corners.map(p => p[1])) - pad)),
        right: Math.min(width, Math.ceil(Math.max(...corners.map(p => p[0])) + pad)),
        bottom: Math.min(height, Math.ceil(Math.max(...corners.map(p => p[1])) + pad)),
      } : { x: 0, y: 0, right: width, bottom: height };
      const w = box.right - box.x, h = box.bottom - box.y;
      if (w <= 0 || h <= 0) return;
      const scratch = document.createElement('canvas');
      scratch.width = width; scratch.height = height;
      const g = scratch.getContext('2d')!;
      g.save();
      g.beginPath(); g.rect(box.x, box.y, w, h); g.clip();
      g.setTransform(matrix);
      g.imageSmoothingEnabled = ctx.imageSmoothingEnabled;
      g.imageSmoothingQuality = ctx.imageSmoothingQuality;
      draw(g);
      if (options.mask) {
        g.setTransform(matrix);
        g.globalAlpha = 1;
        g.filter = 'none';
        g.globalCompositeOperation = 'destination-in';
        options.mask(g);
      }
      g.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, options.alpha ?? 1);
      ctx.globalCompositeOperation = options.composite ?? 'source-over';
      if (options.filter) ctx.filter = options.filter;
      if (options.filter) ctx.drawImage(scratch, 0, 0);
      else ctx.drawImage(scratch, box.x, box.y, w, h, box.x, box.y, w, h);
      ctx.restore();
    };
    const testGroup = drawGroup as Group;
    const cases = ['nested-mask', 'rotated-mask', 'additive', 'filtered', 'clipped'] as const;
    const results: { size: number; scenario: string; maxRgbDelta: number; alphaDifferences: number }[] = [];
    for (const size of [320, 1280, 1920]) {
      for (const scenario of cases) {
        const render = (group: Group) => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size * 9 / 16;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          ctx.fillStyle = '#253049'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.scale(size / 320, size / 320);
          if (scenario === 'rotated-mask') ctx.transform(1, .15, -.2, 1, 4, 3);
          const masked: Options = { bounds: { x: 50, y: 20, w: 130, h: 100 }, alpha: .7,
            mask: g => { g.fillStyle = '#fff'; g.fillRect(60, 28, 105, 76); } };
          if (scenario === 'filtered') masked.filter = 'drop-shadow(0 0 5px #ff4388)';
          if (scenario === 'additive') masked.composite = 'lighter';
          if (scenario === 'clipped') masked.bounds = { x: -30, y: -22, w: 130, h: 100 };
          group(ctx, masked, g => {
            g.fillStyle = '#ff4388'; g.fillRect(-15, -10, 205, 150);
            if (scenario === 'nested-mask') group(g, { bounds: { x: 68, y: 35, w: 75, h: 50 }, alpha: .8,
              mask: m => { m.fillStyle = '#fff'; m.fillRect(76, 42, 60, 34); } }, n => {
              n.fillStyle = '#12ddec'; n.fillRect(68, 35, 75, 50);
            });
          });
          return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        };
        const a = render(reference), b = render(testGroup);
        let maxRgbDelta = 0, alphaDifferences = 0;
        for (let i = 0; i < a.length; i++) {
          const delta = Math.abs(a[i] - b[i]);
          if (i % 4 === 3) {
            if (delta) alphaDifferences++;
          } else maxRgbDelta = Math.max(maxRgbDelta, delta);
        }
        results.push({ size, scenario, maxRgbDelta, alphaDifferences });
      }
    }
    return results;
  }, CANVAS_KIT_URL);
  for (const result of comparisons) {
    expect(result.alphaDifferences, `${result.size}px ${result.scenario} alpha`).toBe(0);
    expect(result.maxRgbDelta, `${result.size}px ${result.scenario} RGB`).toBeLessThanOrEqual(1);
  }
});
