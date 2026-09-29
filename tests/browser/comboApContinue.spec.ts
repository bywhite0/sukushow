import { test, expect } from '@playwright/test';

// AP 継続特效（ComboEffectOutLine_01/_02 + ComboEffectBG_01）的绘制契约（读 window.__LPW__.hud.inspect()）。
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
    const i = (window as any).__LPW__?.hud?.inspect();
    return !!i && i.fx.lowerOutline.visible && i.combo.sprites.length > 0;
  }, { timeout: 25_000 });
}

test('四层结构、层序与每槽粒子副本数', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await loadAndPlay(page);
  const info = await page.evaluate(() => {
    const i = (window as any).__LPW__.hud.inspect();
    const order: string[] = i.fx.order;
    const idx = (n: string) => order.indexOf(n);
    const per = (n: string) => Array.from({ length: 4 }, () => i.fx[n].partsPerSlot as number);
    return {
      order: { upperGlow: idx('upperGlow'), row: idx('row'), lowerOutline: idx('lowerOutline'), lowerGlow: idx('lowerGlow') },
      lowerOutline: per('lowerOutline'), upperOutline: per('upperOutline'),
      lowerGlow: per('lowerGlow'), upperGlow: per('upperGlow'),
      upperHidden: !i.fx.upperOutline.visible && !i.fx.upperGlow.visible,
      blend: i.fx.lowerOutline.composite === 'lighter' ? 'plus-lighter' : i.fx.lowerOutline.composite,
      glowBlend: i.fx.lowerGlow.composite === 'source-over' ? 'normal' : i.fx.lowerGlow.composite,
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
    const i = (window as any).__LPW__.hud.inspect();
    return {
      d: i.combo.slotCenters as number[], s: i.fx.lowerOutline.slotCenters as number[],
      rowT: i.combo.rowScale, layerT: i.fx.lowerOutline.layerScale, glowT: i.fx.lowerGlow.layerScale,
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
      const i = (window as any).__LPW__.hud.inspect();
      out.push({
        parts: i.fx.lowerOutline.parts.flatMap((p: any) => Array.from({ length: i.fx.lowerOutline.partsPerSlot }, () => p)),
        glowW: i.fx.lowerGlow.glow.map((g: any) => g.w),
        glowOp: i.fx.lowerGlow.glow.map((g: any) => g.op),
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
