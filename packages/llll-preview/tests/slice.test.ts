import { describe, expect, it } from 'vitest';
import {
  pushSlicedNote,
  pushTrailSegment,
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

describe('拖尾线段几何', () => {
  it.each([[0, 0, 0, 4, 0, 0], [1, 2, 3, -2, 5, 7]])('两端截面中心对应真实轨迹端点 %s', (...coords) => {
    const b = buffers();
    const a = coords.slice(0, 3), end = coords.slice(3);
    expect(pushTrailSegment(b.pos, b.uv, b.col, 0, b.cap, a, end, 0.2, [1, 1, 1, 1])).toBe(6);
    for (let axis = 0; axis < 3; axis++) {
      const sign = axis === 2 ? -1 : 1;
      expect((b.pos[axis] + b.pos[3 + axis]) / 2).toBeCloseTo(a[axis] * sign);
      expect((b.pos[6 + axis] + b.pos[15 + axis]) / 2).toBeCloseTo(end[axis] * sign);
    }
  });
  it('两端可独立变宽和着色，零宽末端收束为尖端', () => {
    const b = buffers();
    const n = pushTrailSegment(b.pos, b.uv, b.col, 0, b.cap,
      [0, 0, 0], [0, 2, 0], 2, [1, 0, 0, 1], 0, [0, 0, 1, 0]);
    expect(n).toBe(6);
    expect(Math.abs(b.pos[3] - b.pos[0])).toBeCloseTo(2);
    for (let axis = 0; axis < 3; axis++) expect(b.pos[6 + axis]).toBeCloseTo(b.pos[15 + axis]);
    expect(Array.from(b.col.slice(0, 4))).toEqual([1, 0, 0, 1]);
    expect(Array.from(b.col.slice(8, 12))).toEqual([0, 0, 1, 0]);
  });
  it('终点颜色缺少分量时保留起点颜色的对应分量', () => {
    const b = buffers(6);
    pushTrailSegment(b.pos, b.uv, b.col, 0, b.cap,
      { x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, 1, [1, .5, .25, .75], 1, [0, .2]);
    for (const index of [2, 4, 5]) {
      expect(Array.from(b.col.slice(index * 4, index * 4 + 4))).toEqual([0, Math.fround(.2), .25, .75]);
    }
  });
  it('零长度不产生几何，容量不足不写入', () => {
    const b = buffers(5);
    expect(pushTrailSegment(b.pos, b.uv, b.col, 0, 5, [0, 0, 0], [1, 0, 0], 1, [1, 1, 1, 1])).toBe(0);
    expect(pushTrailSegment(b.pos, b.uv, b.col, 0, 5, [0, 0, 0], [0, 0, 0], 1, [1, 1, 1, 1])).toBe(0);
    expect(b.pos.every(v => v === 0)).toBe(true);
  });
  it('直接使用轨迹点对象，斜向段的顶点、UV 与渐变颜色逐项保持原值', () => {
    const b = buffers(12);
    const n = pushTrailSegment(b.pos, b.uv, b.col, 3, b.cap,
      { x: 1, y: 2, z: 3 }, { x: -2, y: 5, z: 7 }, .8,
      [.1, .2, .3, .4], .15, [.9, .8, .7, .6]);
    expect(n).toBe(9);
    expect(Array.from(b.pos.slice(9, 27))).toEqual([
      0.6628198027610779, 1.8199312686920166, -2.8821663856506348,
      1.337180256843567, 2.1800687313079834, -3.1178336143493652,
      -1.9367786645889282, 5.0337629318237305, -7.022093772888184,
      0.6628198027610779, 1.8199312686920166, -2.8821663856506348,
      -1.9367786645889282, 5.0337629318237305, -7.022093772888184,
      -2.0632212162017822, 4.9662370681762695, -6.977906227111816,
    ]);
    expect(Array.from(b.uv.slice(6, 18))).toEqual([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    const start = Array.from(new Float32Array([.1, .2, .3, .4]));
    const end = Array.from(new Float32Array([.9, .8, .7, .6]));
    expect(Array.from(b.col.slice(12, 36))).toEqual([...start, ...start, ...end, ...start, ...end, ...end]);
    expect(b.pos.slice(0, 9).every(v => v === 0)).toBe(true);
  });
  it('对象端点的尖端、零长度和容量边界不产生额外写入', () => {
    const b = buffers(6);
    const start = { x: 0, y: 0, z: 0 }, tip = { x: 0, y: 2, z: 0 };
    expect(pushTrailSegment(b.pos, b.uv, b.col, 0, b.cap, start, tip, 2, [1, 0, 0, 1], 0, [0, 0, 1, 0])).toBe(6);
    expect(Array.from(b.pos)).toEqual([-1, 0, -0, 1, 0, 0, 0, 2, 0, -1, 0, -0, 0, 2, 0, 0, 2, -0]);
    const original = Array.from(b.pos);
    expect(pushTrailSegment(b.pos, b.uv, b.col, 0, b.cap, start, start, 2, [1, 0, 0, 1])).toBe(0);
    expect(pushTrailSegment(b.pos, b.uv, b.col, 1, b.cap, start, tip, 2, [1, 0, 0, 1])).toBe(1);
    expect(Array.from(b.pos)).toEqual(original);
  });
});

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

  it('音符宽度按轨宽比例缩放', () => {
    expect(worldWidthOf(6, 80)).toBeCloseTo(worldWidthOf(6) * 0.8);
    expect(worldWidthOf(12, 120)).toBeCloseTo(worldWidthOf(12) * 1.2);
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

  it('9-slice cap 与音符主体同步缩放', () => {
    const scale = 0.8;
    const caps = sliceCaps(tapLine, worldWidthOf(12, 80), 0.75 * scale);
    expect(caps.left).toBeCloseTo((81 / 100) * 0.75 * scale);
    expect(caps.right).toBeCloseTo((81 / 100) * 0.75 * scale);
  });
});
