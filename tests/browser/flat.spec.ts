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
  // 两个链节点 × 每条宽带两个半边 = 4。
  await expect(canvas).toHaveAttribute('data-holds', '4');
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
  const lay = await layoutOf(page);
  // 时间向上：1.0 s 的 y 由 duration 与 scrollPx 决定，用页面里的真实布局。
  await page.mouse.move(box.x + lay.padX + 11 * lay.lanePx, box.y + yOf(1.0, lay));
  await expect(page.locator('#probe')).toContainText('Single');
  await expect(page.locator('#probe')).toContainText('轨道 10–12');
});

test('损坏文件保留已有谱面并报错', async ({ page }) => {
  await importChart(page, SAMPLE);
  await page.setInputFiles('#file', { name: 'broken.bytes', mimeType: 'application/octet-stream', buffer: Buffer.from('not a chart') });
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#canvas')).toHaveAttribute('data-total', '6');
});

test('音符贴图载入后就位', async ({ page }) => {
  await importChart(page, SAMPLE);
  // 四张音符贴图与九宫格边距来自 /rg/，载入成功后画布标记 textured。
  await expect(page.locator('#canvas')).toHaveAttribute('data-textured', '1');
  const missing = await page.evaluate(async () => {
    const names = ['tap', 'hold', 'flick', 'trace'];
    const out: string[] = [];
    for (const n of names) {
      const res = await fetch(`/rg/sprites/ui_sc2_ingame_notes_${n}.png`, { method: 'HEAD' });
      if (!res.ok) out.push(n);
    }
    // Flick 附加元素（箭头 / Symbol / Sign）也要在盘上。
    const extra = ['ui_sc2_ingame_notes_texture_arrow', 'ui_sc2_ingame_notes_icon_flick', 'ui_sc2_ingame_flick_sign'];
    for (const n of extra) {
      const res = await fetch(`/rg/sprites/${n}.png`, { method: 'HEAD' });
      if (!res.ok) out.push(n);
    }
    const meta = await (await fetch('/rg/sprite_meta.json')).json();
    const missingMeta = [...names.map(n => `ui_sc2_ingame_notes_${n}`), ...extra]
      .filter(k => !meta[k]);
    return { bad: out, keys: Object.keys(meta).length, missingMeta };
  });
  expect(missing.bad).toEqual([]);
  // 四类音符 + 箭头 + Symbol + Sign。
  expect(missing.keys).toBe(7);
  expect(missing.missingMeta).toEqual([]);
});

test('音符端头是圆角，中段不拉伸端头', async ({ page }) => {
  await importChart(page, SAMPLE);
  // 1.0 s 处的 Single（轨道 10–12，3 格宽）。端头贴图单侧就宽于该音符，
  // 因此整条由两个端头拼成，剖面应呈「亮边—平台—平台—亮边」。
  const lay = await layoutOf(page);
  const prof = await page.locator('#canvas').evaluate((el, { y0 }) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / c.clientWidth;
    const y = Math.round(y0 * dpr);
    const { data, width } = ctx.getImageData(0, y, c.width, 1);
    // 背景 #0f1622 = (15,22,34)：明显偏离即内容（音符是品红系，不能用青色滤镜）。
    // 轨道边框也是内容，故按连通段取最长的那一段 = 音符本体。
    const groups: number[][] = [];
    let cur: number[] = [];
    let lastX = -10;
    for (let x = 0; x < width; x++) {
      const r = data[x * 4], g = data[x * 4 + 1], b = data[x * 4 + 2];
      const content = Math.abs(r - 15) + Math.abs(g - 22) + Math.abs(b - 34) > 60;
      if (content) {
        if (x - lastX > 2) { if (cur.length) groups.push(cur); cur = []; }
        cur.push(g); lastX = x;
      }
    }
    if (cur.length) groups.push(cur);
    return groups.sort((a, b) => b.length - a.length)[0] ?? [];
  }, { y0: yOf(1.0, lay) });
  expect(prof.length).toBeGreaterThan(20);
  const peak = Math.max(...prof);
  // 圆角端头贴图在两端是渐入的（实测剖面 46 74 122 148 204 235 … 243 平台），
  // 直角实心块则会一上来就是满亮度。这就是「端头没被中段拉伸」的判据。
  expect(peak).toBeGreaterThan(200);
  expect(prof[0]).toBeLessThan(peak - 80);
  expect(prof[prof.length - 1]).toBeLessThan(peak - 80);
});

test('斜置 Hold 沿带长不漂色', async ({ page }) => {
  // 头 10–20 → 尾 40–50 的斜带；若渐变轴是水平的，颜色会沿带长漂移。
  const SLANT = {
    Offset: 0,
    Bpms: [{ Time: 0, Bpm: 120 }],
    Beats: [{ Numerator: 4, Denominator: 4, Time: 0 }],
    Notes: [{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: FLAGS(1, 10, 20, 40, 50) }],
  };
  await importChart(page, SLANT);
  const lay = await layoutOf(page);
  const profs = await page.locator('#canvas').evaluate((el, { lay }) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / c.clientWidth;
    const sample = (t: number) => {
      const y = Math.round((lay.padY + (lay.duration - t) * lay.pxPerSec - lay.scrollPx) * dpr);
      const { data, width } = ctx.getImageData(0, y, c.width, 1);
      const g: number[] = [];
      for (let x = 0; x < width; x++) {
        const r = data[x * 4], gg = data[x * 4 + 1], b = data[x * 4 + 2];
        if (gg > 60 && b > 60 && gg > r + 18) g.push(gg);
      }
      if (g.length < 10) return null;
      // 归一化到 9 个采样点，便于跨行比较。
      return Array.from({ length: 9 }, (_, i) => g[Math.round((g.length - 1) * i / 8)]);
    };
    return [1.2, 1.4, 1.6, 1.8].map(sample);
  }, { lay });
  const rows = profs.filter(Boolean) as number[][];
  expect(rows.length).toBe(4);
  // 中列应显著暗于两侧，且各行的中列值一致（不漂色）。
  const mids = rows.map(r => r[4]);
  expect(Math.max(...mids) - Math.min(...mids)).toBeLessThan(20);
  for (const r of rows) {
    expect(r[1]).toBeGreaterThan(r[4] + 30);
    expect(r[7]).toBeGreaterThan(r[4] + 30);
  }
});
test('Hold 宽带横截面呈现 Center 暗、两侧亮', async ({ page }) => {
  await importChart(page, SAMPLE);
  // 在 2.5 s 处整行扫描，先定位宽带实际跨度（节点斜置时跨度随时间平移），
  // 再比较左右边缘与中列的绿通道。两侧列 alpha 0.6 > 中列 0.2。
  const lay = await layoutOf(page);
  const prof = await page.locator('#canvas').evaluate((el, { y0 }) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const dpr = c.width / c.clientWidth;
    const y = Math.round(y0 * dpr);
    const row = ctx.getImageData(0, y, c.width, 1).data;
    const cyan: number[] = [];
    for (let x = 0; x < c.width; x++) {
      const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
      if (g > 90 && b > 90 && g > r + 25) cyan.push(x);
    }
    if (cyan.length < 10) return { width: 0, left: 0, mid: 0, right: 0 };
    const at = (f: number) => {
      const x = cyan[Math.round((cyan.length - 1) * f)];
      return row[x * 4 + 1];
    };
    return { width: cyan.length, left: at(0.02), mid: at(0.5), right: at(0.98) };
  }, { y0: yOf(2.5, lay) });
  expect(prof.width).toBeGreaterThan(50);
  expect(prof.left).toBeGreaterThan(prof.mid + 40);
  expect(prof.right).toBeGreaterThan(prof.mid + 40);
  // 左右对称。
  expect(Math.abs(prof.left - prof.right)).toBeLessThan(30);
});

test('Flick 叠加绿色箭头与 Sign，且不画到别的音符上', async ({ page }) => {
  await importChart(page, SAMPLE);
  const lay = await layoutOf(page);
  // 采样谱面的 Flick 在 5.0 s、轨道 30–32。
  const [x0, x1] = [lay.padX + 30 * lay.lanePx, lay.padX + 33 * lay.lanePx];
  const y = yOf(5.0, lay);
  // 附加元素比本体高出若干，取一个包住上下各 40px 的窗口。
  const box = { x: x0 - 30, y: y - 40, w: x1 - x0 + 60, h: 80 };
  const flick = await greenIn(page, box);
  expect(flick.n).toBeGreaterThan(200);

  // 同一时刻的 Trace（轨道 50–58）不该出现绿色。
  const tX0 = lay.padX + 50 * lay.lanePx, tX1 = lay.padX + 59 * lay.lanePx;
  const trace = await greenIn(page, { x: tX0 - 20, y: yOf(6.0, lay) - 40, w: tX1 - tX0 + 40, h: 80 });
  expect(trace.n).toBe(0);

  // 1.0 s 的两条 Single 也不该有绿色。
  const single = await greenIn(page, { x: lay.padX + 8 * lay.lanePx, y: yOf(1.0, lay) - 40, w: 10 * lay.lanePx, h: 80 });
  expect(single.n).toBe(0);
});

test('Flick 附加元素的纵向跨度大于音符本体厚度', async ({ page }) => {
  await importChart(page, SAMPLE);
  const lay = await layoutOf(page);
  // 本体厚度 = 0.45 世界单位 × scale.x。Sign 高 2.5×0.8 = 2.0 世界单位，远高于它。
  const bodyPx = 0.45 * 0.75 * (lay.lanePx / 0.15);
  const y = yOf(5.0, lay);
  const box = { x: lay.padX + 28 * lay.lanePx, y: y - 120, w: 9 * lay.lanePx, h: 240 };
  const g = await greenIn(page, box);
  expect(g.n).toBeGreaterThan(200);
  // 绿色像素在纵向铺开得比本体厚。
  expect(g.maxY - g.minY).toBeGreaterThan(bodyPx * 2);
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
  return page.locator('#canvas').evaluate(el => {
    const c = el as HTMLCanvasElement;
    const lay = JSON.parse(c.dataset.layout ?? '{}');
    return { ...lay, dpr: c.width / c.clientWidth, clientH: c.clientHeight };
  });
}

/** 时间 → 画布 y（CSS 像素）。时间向上：0 秒在内容底端。 */
function yOf(time: number, lay: { padY: number; pxPerSec: number; scrollPx: number; duration: number }) {
  return lay.padY + (lay.duration - time) * lay.pxPerSec - lay.scrollPx;
}

/** 读画布上某个（轨道、时刻）处的像素。 */
async function pixelAt(page: import('@playwright/test').Page, lane: number, time: number) {
  const lay = await layoutOf(page);
  return page.locator('#canvas').evaluate((el, { lay, lane, time }) => {
    const c = el as HTMLCanvasElement;
    const x = Math.round((lay.padX + (lane + 0.5) * lay.lanePx) * lay.dpr);
    const y = Math.round((lay.padY + (lay.duration - time) * lay.pxPerSec - lay.scrollPx) * lay.dpr);
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

/** 某个矩形区域内「绿色系」像素的计数与包围盒。Flick 附加元素是绿色。 */
async function greenIn(page: import('@playwright/test').Page, box: { x: number; y: number; w: number; h: number }) {
  const lay = await layoutOf(page);
  return page.locator('#canvas').evaluate((el, { lay, box }) => {
    const c = el as HTMLCanvasElement;
    const dpr = lay.dpr as number;
    const x0 = Math.max(0, Math.round(box.x * dpr)), y0 = Math.max(0, Math.round(box.y * dpr));
    const w = Math.round(box.w * dpr), h = Math.round(box.h * dpr);
    const { data, width } = c.getContext('2d')!.getImageData(x0, y0, w, h);
    let n = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        // 绿色系：G 明显高于 R/B，且不透明。
        if (a > 60 && g > 70 && g > r + 25 && g > b + 25) {
          n++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    return n ? { n, minX, maxX, minY, maxY } : { n: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }, { lay, box });
}
