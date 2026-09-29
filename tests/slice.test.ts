import { describe, expect, it } from 'vitest';
import { parseChart } from '../src/chart';
import { defaultLayout } from '../src/view';
import {
  HOLD_CENTER, HOLD_CENTER_ALPHA, HOLD_SIDE, HOLD_SIDE_ALPHA, LANE_WORLD, SPRITE_SCALE_X,
  bandHalves, chainBandHalves, laneX, noteDepthWorld, noteSpriteSize, noteWidthWorld, pxPerWorld,
  sliceCaps,
} from '../src/slice';
import { deflateRawSync } from 'node:zlib';

const flags = (type: number, l: number, r: number, l2 = l, r2 = r) =>
  (type & 15) | ((r & 63) << 4) | ((r2 & 63) << 10) | ((l & 63) << 16) | ((l2 & 63) << 22);

const chart = (notes: Record<string, unknown>[]) =>
  parseChart({ Notes: notes, Bpms: [{ Time: '0.0', Bpm: '120.0' }], Beats: [] });

const lay = (over = {}) => ({ ...defaultLayout(), ...over });

describe('原版尺寸换算', () => {
  it('一格轨宽 = 0.15 世界单位', () => {
    expect(LANE_WORLD).toBe(0.15);
  });

  it('GetNoteSize(width).x = (width − 6) × 0.2 + 1.15', () => {
    expect(noteWidthWorld(1)).toBeCloseTo(0.15, 6);
    expect(noteWidthWorld(2)).toBeCloseTo(0.35, 6);
    expect(noteWidthWorld(3)).toBeCloseTo(0.55, 6);
    expect(noteWidthWorld(6)).toBeCloseTo(1.15, 6);
    expect(noteWidthWorld(12)).toBeCloseTo(2.35, 6);
  });

  it('单格音符视觉宽度恰等于一格逻辑宽度', () => {
    expect(noteWidthWorld(1)).toBeCloseTo(LANE_WORLD, 6);
  });

  it('音符纵向厚度：Trace 比其他三类薄', () => {
    expect(noteDepthWorld(0)).toBe(0.45);
    expect(noteDepthWorld(1)).toBe(0.45);
    expect(noteDepthWorld(2)).toBe(0.45);
    expect(noteDepthWorld(3)).toBe(0.35);
  });

  it('像素比例 = 格宽 / 0.15', () => {
    expect(pxPerWorld(lay({ lanePx: 14 }))).toBeCloseTo(14 / 0.15, 9);
  });

  it('贴图尺寸按 scale.x = 0.75 缩放', () => {
    const l = lay({ lanePx: 14 });
    const s = noteSpriteSize(1, 0, l);
    expect(s.w).toBeCloseTo(0.15 * SPRITE_SCALE_X * pxPerWorld(l), 6);
    expect(s.h).toBeCloseTo(0.45 * SPRITE_SCALE_X * pxPerWorld(l), 6);
  });
});

describe('九宫格边距', () => {
  const meta = { name: 'x', border: [60, 0, 60, 0], rect: [0, 0, 128, 68], ppu: 100 };

  it('端头宽 = border / ppu × scale', () => {
    const c = sliceCaps(meta, 100);
    expect(c.left).toBeCloseTo(0.6 * SPRITE_SCALE_X, 9);
    expect(c.right).toBeCloseTo(0.6 * SPRITE_SCALE_X, 9);
    expect(c.mid).toBeCloseTo(100 - c.left - c.right, 9);
  });

  it('端头之和超过目标宽度时等比缩到铺满，中段为 0', () => {
    const c = sliceCaps(meta, 0.5);
    expect(c.left + c.right).toBeCloseTo(0.5, 9);
    expect(c.mid).toBeCloseTo(0, 9);
    expect(c.left).toBeCloseTo(c.right, 9);
  });

  it('归一化 u 来自 border / 贴图宽', () => {
    const c = sliceCaps(meta, 100);
    expect(c.uL).toBeCloseTo(60 / 128, 9);
    expect(c.uR).toBeCloseTo(60 / 128, 9);
  });

  it('缺元数据时不抛错', () => {
    const c = sliceCaps(undefined, 10);
    expect(c.mid).toBeCloseTo(10, 9);
    expect(c.uL).toBe(0);
  });
});

describe('Hold 宽带三列', () => {
  it('三列轨道坐标 = l+1 / (l+r)/2+0.5 / r', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const n = c.roots[0];
    const l = lay({ lanePx: 10 });
    const halves = bandHalves(n, l);
    expect(halves).toHaveLength(2);
    // 左半边左列 = 轨道 11，右半边右列 = 轨道 20
    expect(halves[0].corners[0][0]).toBeCloseTo(laneX(11, l), 9);
    expect(halves[1].corners[1][0]).toBeCloseTo(laneX(20, l), 9);
    // 中列两半边共享
    expect(halves[0].corners[1][0]).toBeCloseTo(laneX(15.5, l), 9);
    expect(halves[1].corners[0][0]).toBeCloseTo(laneX(15.5, l), 9);
  });

  it('宽带比音符本体左右各内缩整一格', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const l = lay({ lanePx: 10 });
    const halves = bandHalves(c.roots[0], l);
    const bandW = halves[1].corners[1][0] - halves[0].corners[0][0];
    const noteW = laneX(21, l) - laneX(10, l);
    expect(bandW).toBeCloseTo(noteW - 2 * l.lanePx, 9);
  });

  it('宽度 2 格时宽带恰为 0，不产生半边', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 11) }]);
    expect(bandHalves(c.roots[0], lay({ lanePx: 10 }))).toHaveLength(0);
  });

  it('宽度 1 格时保留原版的反向窄带，不自行补最小宽度', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 10) }]);
    const h = bandHalves(c.roots[0], lay({ lanePx: 10 }));
    expect(h).toHaveLength(2);
    // 左列(l+1=11) 落在右列(r=10) 右侧 ⇒ 绕序翻转，与原版一致。
    expect(h[0].corners[0][0]).toBeGreaterThan(h[1].corners[1][0]);
  });

  it('左半边 Side→Center、右半边 Center→Side', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const h = bandHalves(c.roots[0], lay({ lanePx: 10 }));
    expect(h[0].fromColor.slice(0, 3)).toEqual([...HOLD_SIDE]);
    expect(h[0].toColor.slice(0, 3)).toEqual([...HOLD_CENTER]);
    expect(h[1].fromColor.slice(0, 3)).toEqual([...HOLD_CENTER]);
    expect(h[1].toColor.slice(0, 3)).toEqual([...HOLD_SIDE]);
  });

  it('未按住时 alpha = 出厂值', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const h = bandHalves(c.roots[0], lay({ lanePx: 10 }));
    expect(h[0].fromColor[3]).toBe(HOLD_SIDE_ALPHA);
    expect(h[0].toColor[3]).toBe(HOLD_CENTER_ALPHA);
  });

  it('按住时两列 alpha 都提高，RGB 不变', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const off = bandHalves(c.roots[0], lay({ lanePx: 10 }), false);
    const on = bandHalves(c.roots[0], lay({ lanePx: 10 }), true);
    expect(on[0].fromColor[3]).toBeGreaterThan(off[0].fromColor[3]);
    expect(on[0].toColor[3]).toBeGreaterThan(off[0].toColor[3]);
    expect(on[0].fromColor.slice(0, 3)).toEqual(off[0].fromColor.slice(0, 3));
  });

  it('头尾排分别落在音符起止时刻', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const l = lay({ lanePx: 10, pxPerSec: 100 });
    const h = bandHalves(c.roots[0], l)[0];
    expect(h.corners[0][1]).toBeCloseTo(h.corners[1][1], 9);
    expect(h.corners[0][1]).toBeCloseTo(l.padY + 1.0 * 100, 9);
    expect(h.corners[2][1]).toBeCloseTo(l.padY + 2.0 * 100, 9);
  });

  it('镜像时左右翻转', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }]);
    const plain = bandHalves(c.roots[0], lay({ lanePx: 10, mirror: false }));
    const mir = bandHalves(c.roots[0], lay({ lanePx: 10, mirror: true }));
    expect(mir[0].corners[0][0]).toBeGreaterThan(plain[0].corners[0][0]);
  });

  it('链按源数组顺序逐节点产出半边', () => {
    // 串链谓词：首段 (l2,r2) 必须等于次段 (l,r)，故次段沿用 [10,20]。
    const c = chart([
      { Uid: 1, just: '1.0', holds: ['1.5'], Flags: flags(1, 10, 20) },
      { Uid: 2, just: '1.5', holds: ['2.0'], Flags: flags(1, 10, 20) },
    ]);
    const l = lay({ lanePx: 10 });
    expect(c.roots).toHaveLength(1);
    const h = chainBandHalves(c.roots[0], l);
    expect(h).toHaveLength(4);
    // 第一节点尾排右列 = 轨道 20；第二节点（同轨）头排左列 = 轨道 11。
    expect(h[1].corners[2][0]).toBeCloseTo(laneX(20, l), 9);
    expect(h[2].corners[0][0]).toBeCloseTo(laneX(11, l), 9);
    // 第二节点尾排落在 2.0 s。
    expect(h[3].corners[2][1]).toBeCloseTo(l.padY + 2.0 * l.pxPerSec, 9);
  });

  it('零时长节点不产出', () => {
    const c = chart([{ Uid: 1, just: '1.0', holds: ['1.0'], Flags: flags(1, 10, 20) }]);
    expect(chainBandHalves(c.roots[0], lay())).toHaveLength(0);
  });

  it('deflate 输入同样适用（解析路径一致）', () => {
    const json = JSON.stringify({ Notes: [{ Uid: 1, just: '1.0', holds: ['2.0'], Flags: flags(1, 10, 20) }], Bpms: [] });
    expect(deflateRawSync(Buffer.from(json)).length).toBeGreaterThan(0);
  });
});
