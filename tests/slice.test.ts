import { describe, expect, it } from 'vitest';
import {
  pushSlicedNote,
  sliceCaps,
  worldDepth,
  worldWidthOf,
  type SpriteMeta,
} from '../src/slice';

function buffers(cap = 64) {
  return {
    pos: new Float32Array(cap * 3),
    uv: new Float32Array(cap * 2),
    col: new Float32Array(cap * 4),
    cap,
  };
}

const tapLine: SpriteMeta = {
  border: [81, 0, 81, 0],
  rect: [0, 0, 256, 32],
  ppu: 100,
};

describe('音符轮廓尺寸', () => {
  it('WorldWidthOf 与 NoteSilhouette 一致', () => {
    expect(worldWidthOf(6)).toBeCloseTo(1.15 * 0.75);
    expect(worldWidthOf(12)).toBeCloseTo(((12 - 6) * 0.2 + 1.15) * 0.75);
  });

  it('深度：普通 0.45，Trace 0.35', () => {
    expect(worldDepth(0)).toBe(0.45);
    expect(worldDepth(1)).toBe(0.45);
    expect(worldDepth(2)).toBe(0.45);
    expect(worldDepth(3)).toBe(0.35);
  });
});

describe('水平 9-slice', () => {
  it('有左右 border 时输出 3 片 × 6 顶点 = 18', () => {
    const b = buffers();
    const n = pushSlicedNote(b.pos, b.uv, b.col, 0, b.cap, 0, 4.5, 0, 2, 0.45, tapLine);
    expect(n).toBe(18);
  });

  it('零 border 时只保留中间片（6 顶点）', () => {
    const b = buffers();
    const meta: SpriteMeta = { border: [0, 0, 0, 0], rect: [0, 0, 100, 40], ppu: 100 };
    const n = pushSlicedNote(b.pos, b.uv, b.col, 0, b.cap, 0, 4.5, 0, 2, 0.45, meta);
    expect(n).toBe(6);
  });

  it('无 meta 时等同零 border（单片 6 顶点）', () => {
    const b = buffers();
    const n = pushSlicedNote(b.pos, b.uv, b.col, 0, b.cap, 0, 4.5, 0, 2, 0.45, undefined);
    expect(n).toBe(6);
  });

  it('左右 cap 过宽时按比例压入 worldW，mid 为 0', () => {
    // (81/100)*0.75 * 2 = 1.215 > 0.5
    const caps = sliceCaps(tapLine, 0.5);
    expect(caps.left + caps.right).toBeCloseTo(0.5);
    expect(caps.mid).toBe(0);
    expect(caps.uL).toBeCloseTo(81 / 256);
    expect(caps.uR).toBeCloseTo(81 / 256);
  });

  it('宽音符保留左右 cap 与可拉伸中段', () => {
    const caps = sliceCaps(tapLine, 3);
    expect(caps.left).toBeCloseTo((81 / 100) * 0.75);
    expect(caps.right).toBeCloseTo((81 / 100) * 0.75);
    expect(caps.mid).toBeGreaterThan(0);
    expect(caps.left + caps.mid + caps.right).toBeCloseTo(3);
  });
});
