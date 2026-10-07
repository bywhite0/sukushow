/** 平面布局与音符几何单测。 */

import { describe, expect, it } from 'vitest';
import { parseChart } from '@sukushow/chart/chart';
import {
  LANE_WORLD, SPRITE_SCALE_X, HOLD_CENTER, HOLD_SIDE, HOLD_CENTER_ALPHA, HOLD_SIDE_ALPHA,
  FLICK_SIGN_OFFSET_Y, ARROW_WIDTH, bandHalves, flickOverlays, laneX, noteDepthWorld,
  noteSpriteSize, noteWidthWorld, pxPerWorld, sliceCaps,
} from '../src/geometry';
import {
  LANES, chainQuads, contentHeight, canvasWidth, defaultLayout, edgeX, holdQuad,
  measures, noteSpan, timeY, trackWidth, yTime,
} from '../src/layout';

const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const chart = (notes: unknown[], bpms: unknown[] = [{ Time: 0, Bpm: 120 }]) =>
  parseChart({ Notes: notes, Bpms: bpms });

const lay = (over: Partial<ReturnType<typeof defaultLayout>> = {}) => ({
  ...defaultLayout(), duration: 10, ...over,
});

describe('布局', () => {
  it('时间向上：0 秒在内容底部、duration 在顶部', () => {
    const l = lay({ pxPerSec: 100 });
    expect(timeY(0, l)).toBeCloseTo(l.padY + 10 * 100, 6);
    expect(timeY(10, l)).toBeCloseTo(l.padY, 6);
    expect(timeY(10, l)).toBeLessThan(timeY(0, l));
    // 越晚的时刻 y 越小。
    expect(timeY(8, l)).toBeLessThan(timeY(2, l));
  });

  it('yTime 与 timeY 互逆', () => {
    const l = lay({ pxPerSec: 137.5 });
    for (const t of [0, 0.5, 3.25, 9.99]) expect(yTime(timeY(t, l), l)).toBeCloseTo(t, 9);
  });

  it('画布尺寸覆盖 60 轨与整段时长', () => {
    const l = lay({ lanePx: 16, pxPerSec: 220, padX: 16, padY: 16 });
    expect(trackWidth(l)).toBe(60 * 16);
    expect(canvasWidth(l)).toBe(60 * 16 + 32);
    const c = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]);
    expect(contentHeight(c, l)).toBeCloseTo(16 * 2 + c.duration * 220, 6);
  });

  it('格线边界：0 在左缘、60 在右缘', () => {
    const l = lay();
    expect(edgeX(0, l)).toBe(l.padX);
    expect(edgeX(LANES, l)).toBe(l.padX + trackWidth(l));
  });

  it('镜像把左右翻转', () => {
    const a = lay(), b = lay({ mirror: true });
    expect(edgeX(0, a)).toBe(lay().padX);
    expect(edgeX(0, b)).toBe(lay().padX + trackWidth(lay()));
    // 轨道 0 在镜像下跑到右侧。
    expect(laneX(0, b)).toBeGreaterThan(laneX(0, a));
    expect(laneX(59, b)).toBeLessThan(laneX(59, a));
  });

  it('Hold 四边形：头的 y 大于尾的 y（时间向上）', () => {
    const l = lay({ pxPerSec: 100 });
    const n = chart([{ Uid: 1, just: '1.0', holds: ['3.0'], Flags: flags(1, 10, 20, 10, 20) }]).notes[0];
    const q = holdQuad(n, l);
    expect(q.p[0][1]).toBeCloseTo(timeY(1.0, l), 6);
    expect(q.p[3][1]).toBeCloseTo(timeY(3.0, l), 6);
    expect(q.p[0][1]).toBeGreaterThan(q.p[3][1]);
    // 四角顺序：头左、头右、尾右、尾左。
    expect(q.p[0][0]).toBeLessThan(q.p[1][0]);
    expect(q.p[2][0]).toBeGreaterThan(q.p[3][0]);
  });

  it('链四边形按源数组顺序，零长度节点不进', () => {
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 2, just: '2.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) },
      { Uid: 3, just: '2.0', holds: ['3.0'], Flags: flags(1, 10, 20, 10, 20) },
    ]);
    const q = chainQuads(c.roots[0], lay());
    expect(q).toHaveLength(2);
    expect(q[0].p[0][1]).toBeGreaterThan(q[1].p[0][1]);
  });

  it('音符横向范围随轨道与镜像变化', () => {
    const n = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }]).notes[0];
    const [x0, x1] = noteSpan(n, lay(), false);
    expect(x1 - x0).toBeCloseTo(3 * lay().lanePx, 6);
  });

  it('小节线按 BPM 与拍号推进', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }], [{ Time: 0, Bpm: 120 }]);
    const m = measures(c);
    // 120 BPM 4/4 ⇒ 每小节 2 秒；谱面时长 3 秒（末音符 +2 秒余量）故只有两条。
    expect(m[0].time).toBeCloseTo(0, 6);
    expect(m[1].time).toBeCloseTo(2, 6);
    expect(m).toHaveLength(2);
    expect(m[0].strong).toBe(true);
  });

  it('拍号变化后小节长度随之改变', () => {
    const c = chart(
      [{ Uid: 1, just: '1.0', holds: [], Flags: flags(0, 10, 12) }],
      [{ Time: 0, Bpm: 120 }],
    );
    c.beats = [
      { numerator: 4, denominator: 4, time: 0 },
      { numerator: 3, denominator: 4, time: 4 },
    ];
    c.duration = 12;
    const m = measures(c);
    // 0–4 秒：4/4 每小节 2 秒 ⇒ 0、2；4 秒起 3/4 ⇒ 每小节 1.5 秒 ⇒ 4、5.5、7、8.5、10、11.5。
    expect(m.map(x => x.time)).toEqual([0, 2, 4, 5.5, 7, 8.5, 10, 11.5]);
  });
});

describe('几何', () => {
  it('音符世界宽与厚度照原版公式', () => {
    expect(noteWidthWorld(3)).toBeCloseTo((3 - 6) * 0.2 + 1.15, 9);
    expect(noteWidthWorld(8)).toBeCloseTo((8 - 6) * 0.2 + 1.15, 9);
    expect(noteDepthWorld(3)).toBe(0.35);
    expect(noteDepthWorld(0)).toBe(0.45);
  });

  it('pxPerWorld 由轨宽决定', () => {
    expect(pxPerWorld(lay({ lanePx: 15 }))).toBeCloseTo(100, 6);
    expect(pxPerWorld(lay({ lanePx: 30 }))).toBeCloseTo(200, 6);
    expect(LANE_WORLD).toBe(0.15);
  });

  it('贴图目标尺寸 = 世界尺寸 × scale.x × pxPerWorld', () => {
    const l = lay({ lanePx: 15 });
    const s = noteSpriteSize(3, 0, l);
    expect(s.w).toBeCloseTo(noteWidthWorld(3) * SPRITE_SCALE_X * 100, 6);
    expect(s.h).toBeCloseTo(0.45 * SPRITE_SCALE_X * 100, 6);
  });

  it('九宫格：端头保持原生宽，中段吃掉剩余', () => {
    const meta = { name: 'x', border: [60, 0, 60, 0], rect: [0, 0, 128, 68], ppu: 100 };
    const caps = sliceCaps(meta, 4);
    expect(caps.left).toBeCloseTo(0.6 * SPRITE_SCALE_X, 9);
    expect(caps.right).toBeCloseTo(0.6 * SPRITE_SCALE_X, 9);
    expect(caps.mid).toBeCloseTo(4 - caps.left - caps.right, 9);
    expect(caps.uL).toBeCloseTo(60 / 128, 9);
  });

  it('九宫格：目标比两端头之和还窄时等比缩到铺满、中段为 0', () => {
    const meta = { name: 'x', border: [60, 0, 60, 0], rect: [0, 0, 128, 68], ppu: 100 };
    const narrow = 0.5;
    const caps = sliceCaps(meta, narrow);
    expect(caps.left + caps.right).toBeCloseTo(narrow, 9);
    expect(caps.mid).toBeCloseTo(0, 9);
    expect(caps.left).toBeCloseTo(caps.right, 9);
  });

  it('Hold 宽带比本体左右各内缩一格', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) }]).notes[0];
    const halves = bandHalves(n, l);
    expect(halves).toHaveLength(2);
    // 左半边的头排近列 = laneX(l+1)。
    expect(halves[0].corners[0][0]).toBeCloseTo(laneX(11, l), 6);
    // 右半边的头排远列 = laneX(r)。
    expect(halves[1].corners[1][0]).toBeCloseTo(laneX(20, l), 6);
  });

  it('Hold 宽带颜色照原版常量', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 10, 20) }]).notes[0];
    const [left, right] = bandHalves(n, l);
    expect(left.fromColor.slice(0, 3)).toEqual([...HOLD_SIDE]);
    expect(left.toColor.slice(0, 3)).toEqual([...HOLD_CENTER]);
    expect(right.fromColor.slice(0, 3)).toEqual([...HOLD_CENTER]);
    expect(right.toColor.slice(0, 3)).toEqual([...HOLD_SIDE]);
    expect(left.fromColor[3]).toBe(HOLD_SIDE_ALPHA);
    expect(left.toColor[3]).toBe(HOLD_CENTER_ALPHA);
  });

  it('斜置 Hold 的渐变轴垂直于带轴（不沿长度漂色）', () => {
    const l = lay({ lanePx: 10 });
    // 头在轨道 10–20，尾平移到 30–40：带轴斜置。
    const n = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20, 30, 40) }]).notes[0];
    const half = bandHalves(n, l)[0];
    const [ha, hb, tb, ta] = half.corners;
    const axis: [number, number] = [(ta[0] + tb[0]) / 2 - (ha[0] + hb[0]) / 2, (ta[1] + tb[1]) / 2 - (ha[1] + hb[1]) / 2];
    const grad: [number, number] = [half.gradTo[0] - half.gradFrom[0], half.gradTo[1] - half.gradFrom[1]];
    const dot = axis[0] * grad[0] + axis[1] * grad[1];
    const denom = Math.hypot(...axis) * Math.hypot(...grad);
    expect(Math.abs(dot / denom)).toBeLessThan(1e-9);
  });

  it('宽带退化（Width ≤ 2）时该半边被跳过', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 11, 10, 11) }]).notes[0];
    // l+1 = 11 > r = 11? 相等 ⇒ 半边宽度为 0，两条都退化。
    expect(bandHalves(n, l)).toHaveLength(0);
  });

  it('Flick 三层附加元素齐备且顺序固定', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]).notes[0];
    const metas = {
      arrow: { name: 'a', border: [0, 0, 0, 0], rect: [0, 0, 52, 50], ppu: 100 },
      icon: { name: 'i', border: [0, 0, 0, 0], rect: [0, 0, 120, 90], ppu: 100 },
      sign: { name: 's', border: [0, 0, 0, 0], rect: [0, 0, 323, 250], ppu: 100 },
    };
    const o = flickOverlays(n, l, metas);
    expect(o.map(x => x.kind)).toEqual(['arrow', 'arrow', 'icon', 'sign']);
    // 箭头左右各一，右侧翻转（未镜像时）。
    expect(o[0].flip).toBe(false);
    expect(o[1].flip).toBe(true);
    expect(o[0].cx).toBeLessThan(o[1].cx);
  });

  it('Flick 箭头宽 = ISx×0.45×scale.x×pxPerWorld', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]).notes[0];
    const k = pxPerWorld(l);
    const o = flickOverlays(n, l, { arrow: { name: 'a', border: [0, 0, 0, 0], rect: [0, 0, 52, 50], ppu: 100 } });
    expect(o[0].w).toBeCloseTo(ARROW_WIDTH * noteWidthWorld(3) * SPRITE_SCALE_X * k, 6);
  });

  it('Sign 抬到音符上方 1 世界单位', () => {
    const l = lay({ lanePx: 10 });
    const n = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]).notes[0];
    const o = flickOverlays(n, l, { sign: { name: 's', border: [0, 0, 0, 0], rect: [0, 0, 323, 250], ppu: 100 } });
    const k = pxPerWorld(l);
    expect(o[0].cy).toBeCloseTo(timeY(1.0, l) - FLICK_SIGN_OFFSET_Y * k, 6);
    expect(o[0].cy).toBeLessThan(timeY(1.0, l));
  });

  it('缺元数据的层不产出元素', () => {
    const l = lay();
    const n = chart([{ Uid: 1, just: '1.0', holds: [], Flags: flags(2, 30, 32) }]).notes[0];
    expect(flickOverlays(n, l, {})).toHaveLength(0);
  });
});

const zeroChain = () => parseChart({
  Notes: [
    { Uid: 1, just: '0', holds: ['1'], Flags: flags(1, 0, 14, 15, 29) },
    { Uid: 2, just: '1', holds: ['1'], Flags: flags(1, 15, 29, 45, 59) }, // 零长
    { Uid: 3, just: '1', holds: ['1.5'], Flags: flags(1, 0, 14, 0, 14) },
    { Uid: 4, just: '1', holds: ['2'], Flags: flags(1, 45, 59, 30, 44) },
  ],
  Bpms: [{ Time: 0, Bpm: 120 }],
});

describe('零长 hold 段出图', () => {
  it('出图：前一段停在它自己的尾端 lane，下一段从瞬移后的 lane 起画，零长段不出面', () => {
    const c = zeroChain();
    const [a, , , b] = c.notes;
    const l = lay();
    const q = chainQuads(c.roots[0], l);
    expect(q).toHaveLength(2);
    const [tl, tr] = noteSpan(a, l, true);
    expect(q[0].p[3][0]).toBeCloseTo(tl, 6);
    expect(q[0].p[2][0]).toBeCloseTo(tr, 6);
    const [hl, hr] = noteSpan(b, l, false);
    expect(q[1].p[0][0]).toBeCloseTo(hl, 6);
    expect(q[1].p[1][0]).toBeCloseTo(hr, 6);
    // 瞬移前后两排同一时刻、横向不同：前一段没有被拉向 45-59。
    expect(q[0].p[3][1]).toBeCloseTo(q[1].p[0][1], 6);
    expect(Math.abs(q[1].p[0][0] - q[0].p[3][0])).toBeGreaterThan(l.lanePx);
  });
});
