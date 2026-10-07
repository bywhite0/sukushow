/**
 * 舞台合成：原先叠在 .stage 里的各层 DOM（#live-bg / #live-bg-dim / 3D canvas / .hud / .start-anim /
 * .combo-result）改为按同一层序画进一张 2D 画布，实时预览与视频导出共用这一条路径。
 *
 * 层序与混合（对应原 CSS 层叠）：
 *  0. live-bg：白底 + in_game_difficulty_bg_101（边长 = 舞台宽的正方形，居中，拉伸铺满）
 *     + sc2_ingame_bg_pattern_dot（10 CSS px 平铺，从左上角起）+ Dim（黑，alpha = BackgroundDarkness/100）；
 *  1. 3D 画布（WebGL，render() 之后立即取，preserveDrawingBuffer 关闭也能拿到当帧）；
 *  2. HUD：.hud 自成层叠上下文；HUD 里的加色 / multiply 全在各自的隔离组内（ComboRoot、段位图标遮罩），
 *     组外只有普通 alpha 混合，而 source-over 满足结合律，所以直接画进舞台画布与先画独立图层再合成结果相同；
 *  4. 开场过场；5. 曲终横幅（glow / fx 加色直接加到画面上，UI 普通混合）。
 */
import { image, preloadImages } from './canvasKit';
import type { LiveHud } from './hud';
import type { StartAnimation } from './startAnim';
import type { ComboResult } from './comboResult';

export const LIVE_BG_URL = '/in_game_difficulty_bg_101.png';
export const LIVE_BG_DOT_URL = '/sc2_ingame_bg_pattern_dot.png';
/** 点阵平铺单元（CSS px）。 */
const DOT_TILE = 10;

export type StageView = { cssW: number; cssH: number; dpr: number };

export type StageLayers = {
  gl: HTMLCanvasElement | null;
  hud: Pick<LiveHud, 'draw'> | null;
  startAnim: Pick<StartAnimation, 'draw'> | null;
  comboResult: Pick<ComboResult, 'draw'> | null;
};

export class StageCompositor {
  private readonly ctx: CanvasRenderingContext2D;
  private dim = 0;
  private dotPattern: { pattern: CanvasPattern; dpr: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    // alpha: true —— 不透明画布会让 Chrome 用 LCD 亚像素抗锯齿画字（彩边）；原 DOM 过场在合成层里是灰度抗锯齿。
    // 每帧先铺满白底，画面本身仍然不透明。
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('无法创建 2D 画布');
    this.ctx = ctx;
    void preloadImages([LIVE_BG_URL, LIVE_BG_DOT_URL]);
  }

  /** ChangeBackgroundAlpha：Dim _Color.a = BackgroundDarkness / 100（只盖舞台背景，不盖 3D / HUD）。 */
  setBackgroundDim(alpha: number): void {
    this.dim = Math.max(0, Math.min(1, alpha));
  }

  get backgroundDim(): number {
    return this.dim;
  }

  /** 画布像素尺寸 = round(css × dpr)（与原各层 canvas 相同的取整）。 */
  private ensureSize(c: HTMLCanvasElement, view: StageView): void {
    const pw = Math.max(1, Math.round(view.cssW * view.dpr)), ph = Math.max(1, Math.round(view.cssH * view.dpr));
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  }

  draw(view: StageView, layers: StageLayers): void {
    const c = this.canvas, ctx = this.ctx;
    if (!(view.cssW > 0) || !(view.cssH > 0)) return;
    this.ensureSize(c, view);
    const pw = c.width, ph = c.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    this.drawLiveBg(view);
    if (layers.gl && layers.gl.width > 0 && layers.gl.height > 0) ctx.drawImage(layers.gl, 0, 0, pw, ph);
    layers.hud?.draw(ctx, view);
    layers.startAnim?.draw(ctx, view);
    layers.comboResult?.draw(ctx, view);
  }

  private drawLiveBg(view: StageView): void {
    const ctx = this.ctx, d = view.dpr;
    const pw = this.canvas.width, ph = this.canvas.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pw, ph);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const bg = image(LIVE_BG_URL);
    if (bg) {
      // 宽 100%、aspect-ratio 1:1、translate(−50%, −50%) 居中
      const side = view.cssW * d;
      ctx.drawImage(bg, (pw - side) / 2, (ph - side) / 2, side, side);
    }
    const dot = image(LIVE_BG_DOT_URL);
    if (dot && dot.naturalWidth > 0) {
      if (!this.dotPattern || this.dotPattern.dpr !== d) {
        const p = ctx.createPattern(dot, 'repeat');
        if (p) {
          p.setTransform(new DOMMatrix().scale((DOT_TILE * d) / dot.naturalWidth, (DOT_TILE * d) / dot.naturalHeight));
          this.dotPattern = { pattern: p, dpr: d };
        }
      }
      if (this.dotPattern) {
        ctx.fillStyle = this.dotPattern.pattern;
        ctx.fillRect(0, 0, pw, ph);
      }
    }
    if (this.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${this.dim})`;
      ctx.fillRect(0, 0, pw, ph);
    }
  }
}
