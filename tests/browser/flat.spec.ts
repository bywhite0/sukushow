import { expect, test } from '@playwright/test';

/** Flags 组装：l/r 为头端点轨道，l2/r2 为尾端点轨道。 */
const FLAGS = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

/** 采样谱面：两条同刻 Single、一条两节点 Hold 链、一条 Flick、一条 Trace。 */
const SAMPLE = {
  Offset: 0,
  Bpms: [{ Time: 0, Bpm: 120 }],
  Beats: [{ Numerator: 4, Denominator: 4, Time: 0 }],
  Notes: [
    { Uid: 1, just: '1.0', holds: [], Flags: FLAGS(0, 10, 12) },
    { Uid: 2, just: '1.0', holds: [], Flags: FLAGS(0, 40, 42) },
    { Uid: 3, just: '2.0', holds: ['3.0'], Flags: FLAGS(1, 6, 20, 20, 34) },
    { Uid: 4, just: '3.0', holds: ['4.0'], Flags: FLAGS(1, 20, 34, 40, 54) },
    { Uid: 5, just: '5.0', holds: [], Flags: FLAGS(2, 30, 32) },
    { Uid: 6, just: '6.0', holds: [], Flags: FLAGS(3, 50, 58) },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('初始为空态，画布已就位', async ({ page }) => {
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#canvas')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('未载入谱面');
  const size = await page.locator('#canvas').evaluate(el => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
  expect(size.w).toBeGreaterThan(0);
  expect(size.h).toBeGreaterThan(0);
});

test('导入 JSON 谱面后画出全部音符与同时押', async ({ page }) => {
  await importChart(page, SAMPLE);
  const canvas = page.locator('#canvas');
  await expect(canvas).toHaveAttribute('data-total', '6');
  await expect(canvas).toHaveAttribute('data-roots', '5');
  await expect(canvas).toHaveAttribute('data-instants', '4');
  await expect(canvas).toHaveAttribute('data-holds', '2');
  // 只有「链首」与「链尾」参与同时押分组（与原版 Prepare 同律），
  // 故 1.0 s 的两条 Single 成一组；链中节点 3.0 s 的接缝不算。
  await expect(canvas).toHaveAttribute('data-lines', '1');
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#status')).toContainText('6 个音符');
  await expect(page.locator('#meta')).toContainText('Hold 节点');
});

test('Hold 链首尾相接，节点数与链首数一致', async ({ page }) => {
  await importChart(page, SAMPLE);
  // 节点 3（尾 20–34）与节点 4（头 20–34）相接 ⇒ 6 个音符里只有 5 个链首。
  await expect(page.locator('#canvas')).toHaveAttribute('data-roots', '5');
});

test('轨道宽度改变几何', async ({ page }) => {
  await importChart(page, SAMPLE);
  const before = await drawnBox(page);
  await page.locator('#lane').fill('30');
  await page.locator('#lane').dispatchEvent('input');
  const after = await drawnBox(page);
  expect(after.w).toBeGreaterThan(before.w);
});

test('镜像开关左右翻转', async ({ page }) => {
  await importChart(page, SAMPLE);
  const before = await drawnBox(page);
  // Trace 音符占轨道 50–58，镜像后应移到左侧。
  const rightSideBefore = await pixelAt(page, 54, 6.0);
  await page.locator('#mirror').check();
  const after = await drawnBox(page);
  const rightSideAfter = await pixelAt(page, 54, 6.0);
  expect(rightSideAfter).not.toEqual(rightSideBefore);
  // 镜像把 x → 左界+右界−x，取整会让包围盒宽度相差至多半格。
  expect(Math.abs(after.w - before.w)).toBeLessThanOrEqual(14);
  expect(after.x).not.toBeCloseTo(before.x, 0);
});

test('小节线开关改变对应像素', async ({ page }) => {
  await importChart(page, SAMPLE);
  // 2.0 s 处有一条弱小节线；关掉后该处应回到底色。
  const withLine = await pixelAt(page, 30, 2.0);
  await page.locator('#measure').uncheck();
  const without = await pixelAt(page, 30, 2.0);
  expect(withLine).not.toEqual(without);
});

test('悬停探针读出音符信息', async ({ page }) => {
  await importChart(page, SAMPLE);
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('画布没有边界');
  const pos = await layoutOf(page);
  await page.mouse.move(box.x + pos.padX + 11 * pos.lanePx, box.y + pos.padY + 1.0 * pos.pxPerSec);
  await expect(page.locator('#probe')).toContainText('Single');
  await expect(page.locator('#probe')).toContainText('轨道 10–12');
});

test('损坏文件保留已有谱面并报错', async ({ page }) => {
  await importChart(page, SAMPLE);
  await page.setInputFiles('#file', { name: 'broken.bytes', mimeType: 'application/octet-stream', buffer: Buffer.from('not a chart') });
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#canvas')).toHaveAttribute('data-total', '6');
});

async function importChart(page: import('@playwright/test').Page, data: unknown) {
  await page.setInputFiles('#file', {
    name: 'sample.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.locator('#empty')).toBeHidden();
}

async function layoutOf(page: import('@playwright/test').Page) {
  return page.locator('#canvas').evaluate(el => ({
    lanePx: 14, padX: 16, padY: 16, pxPerSec: 90, scrollPx: 0,
    dpr: (el as HTMLCanvasElement).width / (el as HTMLCanvasElement).clientWidth,
  }));
}

/** 读画布上某个（轨道、时刻）处的像素。 */
async function pixelAt(page: import('@playwright/test').Page, lane: number, time: number) {
  const lay = await layoutOf(page);
  return page.locator('#canvas').evaluate((el, { lay, lane, time }) => {
    const c = el as HTMLCanvasElement;
    const x = Math.round((lay.padX + (lane + 0.5) * lay.lanePx) * lay.dpr);
    const y = Math.round((lay.padY + time * lay.pxPerSec - lay.scrollPx) * lay.dpr);
    const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]].join(',');
  }, { lay, lane, time });
}

/** 已绘制内容的包围盒（只读像素，不做截图比对）。 */
async function drawnBox(page: import('@playwright/test').Page) {
  return page.locator('#canvas').evaluate(el => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, n = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          n++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { x: minX, w: maxX - minX, y: minY, h: maxY - minY, n };
  });
}
