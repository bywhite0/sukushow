import { describe, expect, it } from 'vitest';
import {
  pushArcBand,
  pushArcNote,
  pushArcQuad,
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

/** SIF 弧形几何：把 three 坐标（z 已取反）折回极坐标，便于断言「贴着弧」。 */
function arcPolar(pos: Float32Array, i: number, centerZ: number) {
  const x = pos[i * 3], z = -pos[i * 3 + 2];
  return { a: Math.atan2(x, centerZ - z), r: Math.hypot(x, centerZ - z) };
}

describe('SIF 弧形音符（弯开的 9-slice）', () => {
  const R = 9 / Math.PI;
  const centerZ = 5;
  const u = 0.8, r = u * R, h = 0.45 * u, w = worldWidthOf(13, 100) * u;

  it('所有顶点都落在 [r − h/2, r + h/2]，角宽 = 世界宽 / r（不是直弦）', () => {
    const b = buffers(256);
    const n = pushArcNote(b.pos, b.uv, b.col, 0, b.cap, 4.5, 0.3, u, R, centerZ, w, h, tapLine, [1, 1, 1, 1], 0.75);
    expect(n).toBeGreaterThan(12);
    let rMin = Infinity, rMax = 0, aMin = Infinity, aMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = arcPolar(b.pos, i, centerZ);
      rMin = Math.min(rMin, p.r); rMax = Math.max(rMax, p.r);
      aMin = Math.min(aMin, p.a); aMax = Math.max(aMax, p.a);
    }
    expect(rMin).toBeGreaterThanOrEqual(r - h / 2 - 1e-6);
    expect(rMax).toBeLessThanOrEqual(r + h / 2 + 1e-6);
    // 直弦的话角点半径会比外缘大 (半宽)²/(2r)；弯开后角宽严格 = 弧长 / 半径。
    expect(aMax - aMin).toBeCloseTo(w / r, 6);
  });

  it('uv 横轴铺满整张贴图（左帽 / 中段 / 右帽），v 轴 0→1', () => {
    const b = buffers(256);
    const n = pushArcNote(b.pos, b.uv, b.col, 0, b.cap, 4.5, 0, u, R, centerZ, w, h, tapLine, [1, 1, 1, 1], 0.75);
    let uMin = 1, uMax = 0, vMin = 1, vMax = 0;
    for (let i = 0; i < n; i++) {
      uMin = Math.min(uMin, b.uv[i * 2]); uMax = Math.max(uMax, b.uv[i * 2]);
      vMin = Math.min(vMin, b.uv[i * 2 + 1]); vMax = Math.max(vMax, b.uv[i * 2 + 1]);
    }
    expect(uMin).toBeCloseTo(0, 6);
    expect(uMax).toBeCloseTo(1, 6);
    expect(vMin).toBeCloseTo(0, 6);
    expect(vMax).toBeCloseTo(1, 6);
  });

  it('pushArcQuad 按给定 uvRect 铺一段', () => {
    const b = buffers(256);
    const n = pushArcQuad(b.pos, b.uv, b.col, 0, b.cap, 4.5, 0, u, R, centerZ, w, h, [0.375, 0, 0.625, 0.25]);
    let uMin = 1, uMax = 0, vMax = 0;
    for (let i = 0; i < n; i++) {
      uMin = Math.min(uMin, b.uv[i * 2]); uMax = Math.max(uMax, b.uv[i * 2]);
      vMax = Math.max(vMax, b.uv[i * 2 + 1]);
    }
    expect(uMin).toBeCloseTo(0.375, 6);
    expect(uMax).toBeCloseTo(0.625, 6);
    expect(vMax).toBeCloseTo(0.25, 6);
  });
});

describe('SIF 弧形带（击中光条 / flick 箭头）', () => {
  const R = 9 / Math.PI;
  const centerZ = 5;

  it('底对齐：顶点落在 [r − h, r]，角宽 = w / r，v0 在外缘', () => {
    const b = buffers(512);
    const w = 1.2, h = 0.6;
    const n = pushArcBand(b.pos, b.uv, b.col, 0, b.cap, 4.5, 0, R, centerZ, w, h, [0.375, 0, 0.625, 0.25], [1, 1, 1, 1]);
    expect(n).toBe(6 * Math.ceil(w / 0.2));
    let rMin = Infinity, rMax = 0, aMin = Infinity, aMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = arcPolar(b.pos, i, centerZ);
      rMin = Math.min(rMin, p.r); rMax = Math.max(rMax, p.r);
      aMin = Math.min(aMin, p.a); aMax = Math.max(aMax, p.a);
    }
    // 平铺 billboard 的 up 方向 = 朝圆心 ⇒ 带子从锚点向内伸 h。
    expect(rMax).toBeCloseTo(R, 6);
    expect(rMin).toBeCloseTo(R - h, 6);
    expect(aMax - aMin).toBeCloseTo(w / R, 6);
    // 外缘（锚点）那一圈取 uvRect 的 v0。
    for (let i = 0; i < n; i++) {
      if (Math.abs(arcPolar(b.pos, i, centerZ).r - R) < 1e-6) expect(b.uv[i * 2 + 1]).toBeCloseTo(0, 6);
      else expect(b.uv[i * 2 + 1]).toBeCloseTo(0.25, 6);
    }
  });
});
