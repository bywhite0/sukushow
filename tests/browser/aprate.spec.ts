import { test, expect } from '@playwright/test';

// APRateEffect 的爆发：主体是粉色四角星粒子，从 240×40 徽章中心向外飞散；
// 两层大面积贴图（#563 Root / #530 Bg_core）只是底光。依据 level56
// ComboRoot/APRateUpper/APRateEffect #227。这里用几何探针核对，不读截图。
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
    dCx: number; dCy: number; rootSrc: string; coreSrc: string;
    /** 两张图是否真的解码成功（与具体贴图文件名无关，换贴图不必改测试）。 */
    imgsLoaded: boolean;
  } | null;
  /** 第一段爆发（apRate 首次到 1）的 scale 序列，到平台期为止。 */
  firstScales: number[];
}

/** 在页面内录完「第一段爆发」：取平台期的几何 + 该段的 scale 序列。 */
async function captureBurst(page: import('@playwright/test').Page): Promise<Capture> {
  return page.evaluate((peak) => new Promise<Capture>((resolve) => {
    let firstScales: number[] = [];
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
          // 平台期很长（0.26s→1.0s，约 44 帧），在平台内取几何非常稳。
          // 阈值取 0.999×peak，确保量到的是曲线终值而不是上升段的某一点。
          if (!peakSample && s >= peak * 0.999) {
            const b = badge.getBoundingClientRect();
            const r = root.getBoundingClientRect();
            const core = document.querySelector('.hud-aprate-burst .burst-core') as HTMLElement | null;
            const rootImg = root.querySelector('img') as HTMLImageElement | null;
            const coreImg = core?.querySelector('img') as HTMLImageElement | null;
            peakSample = {
              badgeW: b.width, badgeH: b.height, rootW: r.width, rootH: r.height,
              dCx: Math.abs((r.left + r.width / 2) - (b.left + b.width / 2)),
              dCy: Math.abs((r.top + r.height / 2) - (b.top + b.height / 2)),
              rootSrc: rootImg?.getAttribute('src') ?? '',
              coreSrc: coreImg?.getAttribute('src') ?? '',
              imgsLoaded: !!rootImg?.complete && rootImg.naturalWidth > 0
                && !!coreImg?.complete && coreImg.naturalWidth > 0,
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
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#chart-file').setInputFiles({ name: 'aprate.json', mimeType: 'application/json', buffer: chart });
  await expect(page.locator('#message')).toContainText('已加载');
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await page.locator('#timeline').evaluate((e: HTMLInputElement) => { e.value = '1.9'; e.dispatchEvent(new Event('input')); });

  // 先启动录制，再播放 —— 否则会错过第一段爆发。
  const recording = captureBurst(page);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  const { peak, firstScales } = await recording;

  expect(peak).not.toBeNull();
  const p = peak!;
  // 贴图必须真的解码成功（不锁具体文件名 —— 贴图是可替换的表现层）。
  expect(p.imgsLoaded).toBe(true);
  expect(p.rootSrc).not.toBe('');
  expect(p.coreSrc).not.toBe('');

  // 与徽章同心（四个子发射器 Transform 全为单位变换 ⇒ 锚在徽章中心）。
  expect(p.dCx).toBeLessThan(1);
  expect(p.dCy).toBeLessThan(1);

  // 峰值比徽章大（Root 基准 254×63 vs 徽章 240×40，乘尺寸曲线后 322×80）。
  expect(p.rootW).toBeGreaterThan(p.badgeW);
  expect(p.rootH).toBeGreaterThan(p.badgeH);
  // 与序列化基准逐项对账。用 1% 相对误差而非定长小数位：
  // getBoundingClientRect 在非 1 的舞台缩放下有亚像素舍入。
  expect(Math.abs(p.rootW / p.badgeW - (254 / 240) * PEAK) / ((254 / 240) * PEAK)).toBeLessThan(0.01);
  expect(Math.abs(p.rootH / p.badgeH - (63 / 40) * PEAK) / ((63 / 40) * PEAK)).toBeLessThan(0.01);

  // 第一段爆发全程单调不减（尺寸曲线只上升）。帧数取决于无头浏览器的帧率，
  // 故只要求覆盖到曲线的多个采样点。
  expect(firstScales.length).toBeGreaterThanOrEqual(4);
  for (let i = 1; i < firstScales.length; i++) {
    expect(firstScales[i]).toBeGreaterThanOrEqual(firstScales[i - 1]);
  }
  // 首个被观测帧的相位取决于 rAF 何时捕获到节点，故只断言「从低处升起」。
  // （曲线在 age=0 处恰为 0 由 hudFxMath 单测确定性地覆盖。）
  expect(firstScales[0]).toBeLessThan(PEAK * 0.9);
  expect(Math.max(...firstScales)).toBeCloseTo(PEAK, 3);
  expect(errors).toEqual([]);
});

test('爆发结束后节点被清空，不残留', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#chart-file').setInputFiles({ name: 'aprate.json', mimeType: 'application/json', buffer: chart });
  await expect(page.locator('#message')).toContainText('已加载');
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await page.locator('#timeline').evaluate((e: HTMLInputElement) => { e.value = '1.9'; e.dispatchEvent(new Event('input')); });
  await page.getByRole('button', { name: '播放', exact: true }).click();

  // 爆发确实出现过……
  await expect.poll(async () => page.locator('.hud-aprate-burst > div').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  // ……且寿命（1s）过后被清空。apRate 封顶 5 后不再重启，故最终必然归零。
  await expect.poll(async () => page.locator('.hud-aprate-burst > div').count(), { timeout: 30_000 }).toBe(0);
  expect(errors).toEqual([]);
});

// 主体是粉色四角星粒子从徽章周围爆发。这条守住三件事：
// 用的是原包四角星贴图并染色、基准尺寸符合 startSize、确实飞散到徽章之外。
test('爆发主体是粉色四角星粒子，且确实飞散到徽章之外', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#chart-file').setInputFiles({ name: 'aprate.json', mimeType: 'application/json', buffer: chart });
  await expect(page.locator('#message')).toContainText('已加载');
  await expect.poll(async () => Number(await page.locator('canvas').getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await page.locator('#timeline').evaluate((e: HTMLInputElement) => { e.value = '1.9'; e.dispatchEvent(new Event('input')); });
  await page.getByRole('button', { name: '播放', exact: true }).click();

  // ① 星形粒子用原包四角星贴图，并且是染色呈现（贴图纯白，粉色来自 colorOverLifetime）。
  await expect.poll(async () => page.locator('.hud-aprate-burst .burst-glitter').count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const star = await page.evaluate(() => {
    const el = document.querySelector('.hud-aprate-burst .burst-glitter') as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      mask: cs.maskImage || cs.webkitMaskImage || '',
      bg: cs.backgroundImage || '',
      // 读 CSS 基准宽度，而不是 getBoundingClientRect —— 后者含尺寸曲线的实时缩放。
      baseW: parseFloat(el.style.width),
    };
  });
  expect(star.mask).toContain('sc2_outgameLvUp_glitter_lyric_01');
  // 染色：mask + 粉色渐变背景，而不是直接显示白色 <img>。
  expect(star.bg).toMatch(/gradient/i);
  // ② 基准尺寸按原包 startSize 0.3–0.6 世界单位 ⇒ 30–60 px。
  expect(star.baseW).toBeGreaterThanOrEqual(30);
  expect(star.baseW).toBeLessThanOrEqual(60);

  // ③ 确实飞散到徽章之外：采一段时间，星形节点的位移要明显超出徽章半宽。
  const maxTravel = await page.evaluate(() => new Promise<number>((resolve) => {
    const badge = document.querySelector('.hud-aprate') as HTMLElement;
    const halfW = badge.getBoundingClientRect().width / 2;
    let best = 0;
    const t0 = performance.now();
    const tick = () => {
      const b = badge.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      for (const el of document.querySelectorAll('.hud-aprate-burst .burst-glitter')) {
        const r = (el as HTMLElement).getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
        if (d / halfW > best) best = d / halfW;
      }
      if (performance.now() - t0 > 1500) resolve(best);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  // ③ 确实飞散到徽章之外。
  // 语义阈值：徽章半宽 = 1.0，故 >1 即「飞出徽章外」，取 1.2 留余量。
  // 不按理论最大行程断言（(108+101)/63 ≈ 3.3）：apRate 每升一级都会
  // `replaceChildren()` 重启爆发，粒子常在飞行途中被下一级清掉。
  expect(maxTravel).toBeGreaterThan(1.2);
  expect(errors).toEqual([]);
});
