import { drawGroup, drawSprite, drawText, image, placeRect, type Ctx } from './canvasKit';

const SPRITE_BASE = '/rg/sprites/';
const spriteUrl = (name: string) => `${SPRITE_BASE}${name}.png`;

export type RankBadge = 'none' | 'D' | 'C' | 'B' | 'A' | 'S';

/** 结算与 HUD 共用的 ScoreRankIcon 内容（不含 HUD 专用 rank_base）。 */
export function drawRankBadge(ctx: Ctx, rank: RankBadge, ix: number, iy: number): void {
  const mask = image(spriteUrl('ui_sc2_button_rank'));
  if (!mask) return;
  const masked = (host: Ctx, x: number, y: number, w: number, h: number, draw: (g: Ctx) => void) =>
    drawGroup(host, { bounds: { x, y, w, h }, mask: (m) => m.drawImage(mask, x, y, w, h) }, draw);
  const fillBox = (x: number, y: number, w: number, h: number, bg: string | CanvasGradient) => (g: Ctx) => {
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(mask, x, y, w, h);
    g.globalCompositeOperation = 'source-over';
  };
  masked(ctx, ix, iy, 156, 181, (g) => {
    // rim：底色 + 贴图 multiply（与 HUD 的按钮徽章一致）。
    masked(g, ix, iy, 156, 181, (h) => {
      h.fillStyle = 'rgb(155,145,174)';
      h.fillRect(ix, iy, 156, 181);
      h.globalAlpha = 0.8;
      h.globalCompositeOperation = 'multiply';
      h.drawImage(mask, ix, iy, 156, 181);
      h.globalAlpha = 1;
      h.globalCompositeOperation = 'source-over';
    });
    // White：inset 3（150×175），贴图自身作遮罩。
    const wx = ix + 3, wy = iy + 3;
    masked(g, wx, wy, 150, 175, (h) => {
      h.drawImage(mask, wx, wy, 150, 175);
      const cx = wx + 3, cy = wy + 3;
      masked(h, cx, cy, 144, 169, fillBox(cx, cy, 144, 169, 'rgb(176,172,184)'));
      if (rank === 'none') return;
      masked(h, cx, cy, 144, 169, (c) => {
        let bg: string | CanvasGradient;
        if (rank === 'S') {
          const grad = c.createLinearGradient(cx, 0, cx + 144, 0);
          grad.addColorStop(0, 'rgb(177,147,203)');
          grad.addColorStop(1, 'rgb(96,228,222)');
          bg = grad;
        } else {
          bg = ({ D: 'rgb(133,150,208)', C: 'rgb(54,215,225)', B: 'rgb(30,196,167)', A: 'rgb(253,91,145)' } as const)[rank];
        }
        fillBox(cx, cy, 144, 169, bg)(c);
        const sh = placeRect(144, 169, 1, 0, 1, 0, 1, 1, 145, 126);
        const shine = image(spriteUrl('ui_sc2_button_rank_shine'));
        if (shine) { c.globalAlpha = 0.2; c.drawImage(shine, cx + sh.x, cy + sh.y, sh.w, sh.h); }
        c.globalAlpha = 0.8;
        const d1 = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, -21.5, 51, 103, 69);
        const d2 = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, 52, -36, 41, 57);
        drawSprite(c, spriteUrl('ui_sc2_button_rank_deco_01'), cx + d1.x, cy + d1.y, d1.w, d1.h, 'fill');
        drawSprite(c, spriteUrl('ui_sc2_button_rank_deco_02'), cx + d2.x, cy + d2.y, d2.w, d2.h, 'fill');
        c.globalAlpha = 1;
        const nm = placeRect(144, 169, 0.5, 0.5, 0.5, 0.5, 0, 2, 120, 120);
        drawText(c, rank, { size: 80, weight: 800, color: '#fff', shadow: { dy: 2, color: 'rgba(0,0,0,.302)' } },
          cx + nm.x, cy + nm.y, nm.w, nm.h);
      });
    });
  });
}
