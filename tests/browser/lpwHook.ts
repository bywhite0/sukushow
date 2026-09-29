import type { Page } from '@playwright/test';

/**
 * 舞台改为单张合成画布后，HUD / 过场 / 曲终横幅不再有 DOM 节点，
 * 浏览器测试通过 window.__LPW__ 读取各层的绘制状态（与画到画布上的是同一份状态）。
 */
export type HudInfo = any;

export const hudInfo = (page: Page): Promise<HudInfo> => page.evaluate(() => {
  const i = (window as any).__LPW__.hud.inspect();
  return { ...i, sparksCanvas: undefined, coreLightCanvas: undefined };
});

export const introInfo = (page: Page): Promise<{ state: string | null; title: string; difficulty: string; jacketUrl: string | null; clipTime: number | null }> =>
  page.evaluate(() => {
    const s = (window as any).__LPW__.startAnim;
    return { state: s.state, clipTime: s.clipTime, ...s.current };
  });

export const resultInfo = (page: Page): Promise<{ visible: boolean; kind: number }> =>
  page.evaluate(() => {
    const r = (window as any).__LPW__.comboResult;
    return { visible: r.visible, kind: r.resultKind };
  });
