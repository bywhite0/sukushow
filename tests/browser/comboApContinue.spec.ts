import { test, expect } from '@playwright/test';

// AP 継続特效（ComboEffectOutLine_01/_02 + ComboEffectBG_01）的 DOM 契约。
// 依据：level56 ComboRoot > SpriteRoot / SpriteUpperRoot（HorizontalLayoutGroup spacing −13、槽 90×120）；
// 粒子 scalingMode = Local、SizeModule 关闭；描边面片 85×109（shader UV 表）；
// 同位 burst：下描边 4、上描边 5、底光 2。层级：上底光 1 → 数字 3/4 → 描边 9 → 下底光 10。
const chart = Buffer.from(JSON.stringify({
  Notes: Array.from({ length: 60 }, (_, i) => ({ Uid: i + 1, just: String(2 + i * 0.1), Flags: 80, holds: [] })),
  Bpms: [{ Bpm: 120, Time: 0 }],
}));

async function loadAndPlay(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.locator('#chart-file').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: chart });
  await page.locator('#timeline').evaluate((e: HTMLInputElement) => { e.value = '0'; e.dispatchEvent(new Event('input')); });
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => {
    const r = document.querySelector('.hud-combo-fx.is-lower-outline') as HTMLElement | null;
    const vis = Array.from(document.querySelectorAll('.hud-combo-digits > .hud-cdigit'))
      .filter((x) => !(x as HTMLElement).hidden);
    return r && !r.hidden && vis.length > 0;
  }, { timeout: 25_000 });
}

test('四层结构、层序与每槽粒子副本数', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadAndPlay(page);
  const info = await page.evaluate(() => {
    const q = (c: string) => document.querySelector(`.hud-combo-fx.${c}`) as HTMLElement;
    const row = document.querySelector('.hud-combo-digits') as HTMLElement;
    const kids = Array.from(row.parentElement!.children);
    const idx = (e: Element) => kids.indexOf(e);
    const parts = (c: string, p: string) => Array.from(q(c).querySelectorAll('.hud-combo-fx-slot'))
      .map((s) => s.querySelectorAll(p).length);
    return {
      order: {
        upperGlow: idx(q('is-upper-glow')), row: idx(row),
        lowerOutline: idx(q('is-lower-outline')), lowerGlow: idx(q('is-lower-glow')),
      },
      lowerOutline: parts('is-lower-outline', '.hud-combo-fx-outline'),
      upperOutline: parts('is-upper-outline', '.hud-combo-fx-outline'),
      lowerGlow: parts('is-lower-glow', '.hud-combo-fx-glow'),
      upperGlow: parts('is-upper-glow', '.hud-combo-fx-glow'),
      upperHidden: q('is-upper-outline').hidden && q('is-upper-glow').hidden,
      blend: getComputedStyle(q('is-lower-outline')).mixBlendMode,
      glowBlend: getComputedStyle(q('is-lower-glow')).mixBlendMode,
    };
  });
  expect(info.order.upperGlow).toBeLessThan(info.order.row);
  expect(info.order.lowerOutline).toBeGreaterThan(info.order.row);
  expect(info.order.lowerGlow).toBeGreaterThan(info.order.lowerOutline);
  expect(info.lowerOutline).toEqual([4, 4, 4, 4]);
  expect(info.upperOutline).toEqual([5, 5, 5, 5]);
  expect(info.lowerGlow).toEqual([2, 2, 2, 2]);
  expect(info.upperGlow).toEqual([2, 2, 2, 2]);
  // 谱面不到 100 combo ⇒ 没有 DoEffectCombo，上层不出现。
  expect(info.upperHidden).toBe(true);
  expect(info.blend).toBe('plus-lighter');
  expect(info.glowBlend).toBe('normal');
  expect(errors).toEqual([]);
});

test('下层与数字行同槽位、同 ComboRectTween 展开', async ({ page }) => {
  await loadAndPlay(page);
  const snap = await page.evaluate(() => {
    const digits = Array.from(document.querySelectorAll('.hud-combo-digits > .hud-cdigit'))
      .filter((x) => !(x as HTMLElement).hidden) as HTMLElement[];
    const layer = document.querySelector('.hud-combo-fx.is-lower-outline') as HTMLElement;
    const glow = document.querySelector('.hud-combo-fx.is-lower-glow') as HTMLElement;
    const slots = Array.from(layer.querySelectorAll('.hud-combo-fx-slot'))
      .filter((x) => !(x as HTMLElement).hidden) as HTMLElement[];
    const row = document.querySelector('.hud-combo-digits') as HTMLElement;
    const c = (e: HTMLElement) => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; };
    return {
      d: digits.map(c), s: slots.map(c),
      rowT: row.style.transform, layerT: layer.style.transform, glowT: glow.style.transform,
    };
  });
  expect(snap.s).toHaveLength(snap.d.length);
  for (let i = 0; i < snap.d.length; i++) expect(snap.s[i]).toBeCloseTo(snap.d[i], 1);
  expect(snap.layerT).toBe(snap.rowT);
  expect(snap.glowT).toBe(snap.rowT);
});

test('描边面片 85×109 居中、按 shader 列表取 mask；尺寸与不透明度落在原包值', async ({ page }) => {
  await loadAndPlay(page);
  const rec = await page.evaluate(() => new Promise<any[]>((resolve) => {
    const out: any[] = [];
    const t0 = performance.now();
    const tick = () => {
      const lo = document.querySelector('.hud-combo-fx.is-lower-outline') as HTMLElement;
      const lg = document.querySelector('.hud-combo-fx.is-lower-glow') as HTMLElement;
      const slots = Array.from(lo.querySelectorAll('.hud-combo-fx-slot'))
        .filter((x) => !(x as HTMLElement).hidden) as HTMLElement[];
      const g = Array.from(lg.querySelectorAll('.hud-combo-fx-slot'))
        .filter((x) => !(x as HTMLElement).hidden)
        .map((s) => s.querySelector('.hud-combo-fx-glow') as HTMLElement);
      out.push({
        parts: slots.flatMap((s) => Array.from(s.querySelectorAll('.hud-combo-fx-outline')).map((p) => {
          const e = p as HTMLElement;
          return {
            w: parseFloat(e.style.width), h: parseFloat(e.style.height),
            l: parseFloat(e.style.left), t: parseFloat(e.style.top),
            mx: parseFloat(e.style.maskPosition || (e.style as any).webkitMaskPosition), op: Number(e.style.opacity),
            img: e.style.maskImage || (e.style as any).webkitMaskImage || '',
          };
        })),
        glowW: g.map((e) => parseFloat(getComputedStyle(e).width)),
        glowOp: g.map((e) => Number(e.style.opacity)),
      });
      if (performance.now() - t0 > 3000) resolve(out);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const k = 85 / 90;
  const starts = [0, 90, 160, 250, 340, 430, 520, 610, 700, 790].map((x) => -x * k);
  const parts = rec.flatMap((r) => r.parts);
  expect(parts.length).toBeGreaterThan(0);
  for (const p of parts) {
    expect(p.h).toBeCloseTo(109, 3);
    expect(p.t).toBeCloseTo(5.5, 3);
    expect(2 * p.l + p.w).toBeCloseTo(90, 3);
    expect(p.w).toBeCloseTo(85, 3);
    if (p.img.includes('_Effect_1.png')) expect(p.mx).toBe(0);
    else expect(starts.some((s, d) => d !== 1 && Math.abs(s - p.mx) < 1e-2)).toBe(true);
    // 单颗 = alpha 曲线 × startColor.a（0.7294），峰值 0.3529。
    expect(p.op).toBeLessThanOrEqual(0.3529411852359772 * 0.729411780834198 + 1e-6);
  }
  // 下层底光：SizeModule 关闭 ⇒ 恒 230 宽；每颗不透明度 = 曲线 × startColor.a，由浏览器逐像素叠 2 颗。
  const a = 0.3529411852359772 * 0.5882353186607361;
  for (const r of rec) {
    for (const w of r.glowW) expect(w).toBeCloseTo(230, 1);
    for (const o of r.glowOp) expect(o).toBeLessThanOrEqual(a + 1e-6);
  }
});
