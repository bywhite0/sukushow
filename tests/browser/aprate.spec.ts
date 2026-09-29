import { test, expect } from '@playwright/test';

// APRateEffect 的爆发（level56 ComboRoot/APRateUpper/APRateEffect）：#227 Root 自身带
// APRate_OutlineEffect 底光，子节点 #41 Bg_core（Premultiply 底光）、#229 Particle、
// #228 ClossParticle（粉色四角星）从 240×40 徽章中心向外飞散。
// Root 用几何探针核对；火花与 Bg_core 画在画布上，读画布像素核对。
//
// 注意：爆发寿命只有 1s，从 Node 侧用 expect.poll 采样（间隔约 1s）必然漏帧，
// 因此所有采样都在页面内用 rAF 完成，只做一次往返。
const chart = Buffer.from(JSON.stringify({
  Notes: Array.from({ length: 40 }, (_, i) => ({ Uid: i + 1, just: String(2 + i * 0.2), Flags: 80, holds: [] })),
  Bpms: [{ Bpm: 120, Time: 0 }],
}));

/** 尺寸曲线峰值 = 0.9384613037109375 × 1.35（序列化 SizeModule × curveMultiplier）。 */
const PEAK = 0.9384613037109375 * 1.35;

interface Capture {
  peak: {
    badgeW: number; badgeH: number; rootW: number; rootH: number;
    dCx: number; dCy: number; rootSrc: string;
    /** Root 贴图是否真的解码成功（与具体贴图文件名无关）。 */
    rootLoaded: boolean;
    /** Bg_core 两层画布是否都在。 */
    hasCore: boolean;
  } | null;
  /** 第一段爆发（apRate 首次到 1）的 scale 序列，到平台期为止。 */
  firstScales: number[];
}

async function loadAndSeek(page: import('@playwright/test').Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#chart-file').setInputFiles({ name: 'aprate.json', mimeType: 'application/json', buffer: chart });
  await expect(page.locator('#message')).toContainText('已加载');
  await expect.poll(async () => Number(await page.locator('#chart-canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await page.locator('#timeline').evaluate((e: HTMLInputElement) => { e.value = '1.9'; e.dispatchEvent(new Event('input')); });
}

/** 在页面内录完「第一段爆发」：取平台期的几何 + 该段的 scale 序列。 */
async function captureBurst(page: import('@playwright/test').Page): Promise<Capture> {
  return page.evaluate((peak) => new Promise<Capture>((resolve) => {
    const firstScales: number[] = [];
    let prev = -1;
    let inFirst = true;
    let peakSample: Capture['peak'] = null;
    const t0 = performance.now();
    const tick = () => {
      const root = document.querySelector('.hud-aprate-burst .burst-root') as HTMLElement | null;
      const badge = document.querySelector('.hud-aprate') as HTMLElement | null;
      if (root && badge) {
        const m = /scale\(([-\d.e]+)\)/.exec(root.style.transform);
        if (m) {
          const s = Number(m[1]);
          if (inFirst) {
            // scale 回落 ⇒ apRate 升级触发了下一段爆发，第一段到此为止。
            if (s < prev - 1e-6) inFirst = false;
            else { firstScales.push(s); prev = s; }
          }
          // 平台期很长（0.26s→1.0s），阈值取 0.999×peak，确保量到的是曲线终值。
          if (!peakSample && s >= peak * 0.999) {
            const b = badge.getBoundingClientRect();
            const r = root.getBoundingClientRect();
            const rootImg = root.querySelector('img') as HTMLImageElement | null;
            peakSample = {
              badgeW: b.width, badgeH: b.height, rootW: r.width, rootH: r.height,
              dCx: Math.abs((r.left + r.width / 2) - (b.left + b.width / 2)),
              dCy: Math.abs((r.top + r.height / 2) - (b.top + b.height / 2)),
              rootSrc: rootImg?.getAttribute('src') ?? '',
              rootLoaded: !!rootImg?.complete && rootImg.naturalWidth > 0,
              hasCore: !!document.querySelector('.hud-aprate-burst canvas.burst-core-shade')
                && !!document.querySelector('.hud-aprate-burst canvas.burst-core-light'),
            };
          }
          if (peakSample && firstScales.length >= 4) {
            return resolve({ peak: peakSample, firstScales });
          }
        }
      }
      if (performance.now() - t0 > 15_000) return resolve({ peak: peakSample, firstScales });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), PEAK);
}

test('APRateEffect 贴图爆发：与徽章同心、峰值大于徽章、尺寸单调放大', async ({ page }) => {
  const errors: string[] = [];
  await loadAndSeek(page, errors);

  // 先启动录制，再播放 —— 否则会错过第一段爆发。
  const recording = captureBurst(page);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const { peak, firstScales } = await recording;

  expect(peak).not.toBeNull();
  const p = peak!;
  expect(p.rootLoaded).toBe(true);
  expect(p.rootSrc).not.toBe('');
  expect(p.hasCore).toBe(true);

  // 与徽章同心（子发射器 Transform 全为单位变换 ⇒ 锚在徽章中心）。
  expect(p.dCx).toBeLessThan(1);
  expect(p.dCy).toBeLessThan(1);

  // 峰值比徽章大（Root 基准 254×63 vs 徽章 240×40，乘尺寸曲线后 322×80）。
  expect(p.rootW).toBeGreaterThan(p.badgeW);
  expect(p.rootH).toBeGreaterThan(p.badgeH);
  // 1% 相对误差：getBoundingClientRect 在非 1 的舞台缩放下有亚像素舍入。
  expect(Math.abs(p.rootW / p.badgeW - (254 / 240) * PEAK) / ((254 / 240) * PEAK)).toBeLessThan(0.01);
  expect(Math.abs(p.rootH / p.badgeH - (63 / 40) * PEAK) / ((63 / 40) * PEAK)).toBeLessThan(0.01);

  // 第一段爆发全程单调不减（尺寸曲线只上升）。
  expect(firstScales.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < firstScales.length; i++) {
    expect(firstScales[i]).toBeGreaterThanOrEqual(firstScales[i - 1]);
  }
  expect(firstScales[0]).toBeLessThan(PEAK * 0.9);
  expect(Math.max(...firstScales)).toBeCloseTo(PEAK, 3);
  expect(errors).toEqual([]);
});

test('爆发结束后节点被清空，不残留', async ({ page }) => {
  const errors: string[] = [];
  await loadAndSeek(page, errors);
  await page.getByRole('button', { name: '播放', exact: true }).click();

  // 爆发确实出现过……
  await expect.poll(async () => page.locator('.hud-aprate-burst > *').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  // ……且寿命（1s）过后被清空。apRate 封顶 5 后不再重启，故最终必然归零。
  await expect.poll(async () => page.locator('.hud-aprate-burst > *').count(), { timeout: 30_000 }).toBe(0);
  expect(errors).toEqual([]);
});

// 火花层（#229 + #228，Additive）画在 burst-sparks 画布上，画布中心 = 徽章中心。
// 守住三件事：确实画出了东西、颜色偏粉（贴图纯白/灰，粉色来自 TwoGradients）、
// 确实飞散到徽章之外；另核对 Bg_core 加亮层有像素。
test('火花粒子呈粉色且飞散到徽章之外，Bg_core 有底光', async ({ page }) => {
  const errors: string[] = [];
  await loadAndSeek(page, errors);

  const probe = page.evaluate(() => new Promise<{
    lit: number; pinkRatio: number; maxTravel: number; coreLit: number; cssW: number; halfBadge: number;
  }>((resolve) => {
    let lit = 0, pink = 0, maxTravel = 0, coreLit = 0, cssW = 0, halfBadge = 0;
    const t0 = performance.now();
    let n = 0;
    const tick = () => {
      const c = document.querySelector('.hud-aprate-burst canvas.burst-sparks') as HTMLCanvasElement | null;
      const badge = document.querySelector('.hud-aprate') as HTMLElement | null;
      if (c && badge && (n++ % 3 === 0)) {
        cssW = parseFloat(c.style.width);
        // 徽章半宽换算到画布 CSS 坐标（两者同处 HUD 坐标系，不受舞台缩放影响）。
        halfBadge = badge.offsetWidth / 2;
        const k = c.width / cssW;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const cx = c.width / 2, cy = c.height / 2;
        for (let y = 0; y < c.height; y += 2) {
          for (let x = 0; x < c.width; x += 2) {
            const i = (y * c.width + x) * 4;
            if (d[i + 3] < 24) continue;
            lit++;
            if (d[i] > d[i + 1] + 16) pink++;
            const dist = Math.hypot(x - cx, y - cy) / k;
            if (dist > maxTravel) maxTravel = dist;
          }
        }
        const light = document.querySelector('.hud-aprate-burst canvas.burst-core-light') as HTMLCanvasElement | null;
        if (light) {
          const ld = light.getContext('2d')!.getImageData(0, 0, light.width, light.height).data;
          for (let i = 3; i < ld.length; i += 4) if (ld[i] > 0) coreLit++;
        }
      }
      if (performance.now() - t0 > 4000) resolve({ lit, pinkRatio: lit ? pink / lit : 0, maxTravel, coreLit, cssW, halfBadge });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const r = await probe;

  expect(r.lit).toBeGreaterThan(0);
  // 两条渐变的 R 通道都是 ~1，G 在 0.07–0.81：亮像素绝大多数应 R 明显高于 G。
  expect(r.pinkRatio).toBeGreaterThan(0.8);
  // 飞出徽章：语义阈值为徽章半宽的 1.2 倍。
  // 不按理论最大行程断言：apRate 每升一级都会重启爆发，粒子常在飞行途中被清掉。
  expect(r.maxTravel).toBeGreaterThan(r.halfBadge * 1.2);
  expect(r.coreLit).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
