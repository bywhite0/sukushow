import { describe, it, expect, afterEach } from 'vitest';
import { BORDER, PLANE_Y, Y, createSlope } from '../src/geometry';
import {
  FLAT_JUDGE_DEFAULT, FLAT_JUDGE_MAX, FLAT_JUDGE_MIN, FLAT_PITCH, FLAT_TRACK_DEFAULT,
  FLAT_TRACK_FRACTION, FLAT_TRACK_MAX, FLAT_TRACK_MIN, LANE_HALF_WIDTH, LINE_OVERHANG,
  PLANE_HALF_WIDTH, RAIL_HALF_WIDTH, TAP_LINE_WIDTH, createFlatSlope, designScale, flatFrame,
  flatJudgeFraction, flatRailPoint, flatTrackFraction,
} from '../src/flatView';
import { PLANE_UV, flatParticlePoint } from '../src/fx';
import { PITCH, billboard, pushBillboard, pushSlicedNote, pushTrailSegment, setBillboardPitch } from '../src/slice';

afterEach(() => setBillboardPitch(PITCH));

describe('2D 俯视取景', () => {
  it('判定点落在判定线贴图中心，轨道宽度按比例定死', () => {
    for (const [w, h] of [[1920, 1080], [1296, 616], [1440, 1080], [3440, 1440]] as const) {
      const f = flatFrame(w, h);
      // 「2D 轨道宽度」= 轨道（两侧边线的跨度 = 平面的投影宽度）占舞台宽的比例。
      expect(f.trackPx).toBeCloseTo(FLAT_TRACK_FRACTION * w, 6);
      expect(f.trackPx).toBeCloseTo(2 * f.railX * f.scale, 6);
      expect(f.judgeY).toBeCloseTo((h * FLAT_JUDGE_DEFAULT) / 100, 6);
      expect(f.field).toBeCloseTo(f.judgeY / f.scale, 6);
      expect(f.below).toBeCloseTo((h - f.judgeY) / f.scale, 6);
      // 判定线贴图（UI 设计坐标）的中心 y：屏幕 y = h/2 − worldY
      expect(f.lineUiY).toBeCloseTo((h / 2 - f.judgeY) / designScale(w, h), 6);
    }
  });

  it('相机位置反解后：判定点投影到 judgeY，音符面投影比例 = scale', () => {
    const fov = 60, tan = Math.tan((fov * Math.PI) / 360);
    for (const [w, h] of [[1920, 1080], [1296, 616]] as const) {
      const f = flatFrame(w, h, fov);
      // 透视：音符面（y = Y）上的垂直比例
      expect((h / 2) / ((f.camY - Y) * tan)).toBeCloseTo(f.scale, 6);
      // 判定点（Three z = −BORDER）的屏幕 y（自上而下）
      expect(h / 2 + (-BORDER - f.camZ) * f.scale).toBeCloseTo(f.judgeY, 6);
      // 轨道平面比音符面低 0.54，投影比例按距离折算（比音符面小）
      const planeScale = (f.scale * (f.camY - Y)) / (f.camY - PLANE_Y);
      expect(planeScale).toBeLessThan(f.scale);
      expect(f.planeFitX).toBeCloseTo(f.scale / planeScale, 9);
      // 轨道 = 60 个 lane 的跨度 ⇒ 两侧边线压在音符外沿上（音符横向撑满轨道）。
      expect(f.railX).toBeCloseTo(LANE_HALF_WIDTH, 9);
      expect(2 * f.railX * f.scale).toBeCloseTo(f.trackPx, 6);
      // 平面横向缩到 planeScaleX：投影宽度 = 轨道宽度（平面边缘 = 边线 = 音符外沿）。
      const planePx = 2 * PLANE_HALF_WIDTH * planeScale * f.planeScaleX;
      expect(planePx).toBeCloseTo(f.trackPx, 6);
      expect(f.planeScaleX).toBeLessThan(1);
      expect(f.planeScaleX).toBeCloseTo((f.railX * f.planeFitX) / PLANE_HALF_WIDTH, 9);
      // 判定线贴图缩放后宽度 = 轨道宽度 × LINE_OVERHANG（两端伸出轨道）。
      const linePx = TAP_LINE_WIDTH * f.lineScale * designScale(w, h);
      expect(linePx).toBeCloseTo(f.trackPx * LINE_OVERHANG, 6);
      expect(linePx).toBeCloseTo(f.linePx, 6);
    }
  });

  it('判定线两端在轨道外：比轨道平面与两侧边线都宽', () => {
    for (const [w, h] of [[1920, 1080], [1296, 616], [3440, 1440], [3200, 900]] as const) {
      const f = flatFrame(w, h);
      const railPx = 2 * f.railX * f.scale;
      expect(f.linePx).toBeGreaterThan(railPx);
      // 两端各伸出 (LINE_OVERHANG−1)/2 ≈ 6%（相对轨道宽度，即两侧边线）
      expect((f.linePx - railPx) / 2).toBeCloseTo(railPx * (LINE_OVERHANG - 1) / 2, 6);
    }
  });

  it('任何画布比例下：音符撑满轨道，平面投影边缘压在两侧边线上', () => {
    for (const [w, h] of [[1920, 1080], [1296, 616], [1440, 1080], [3200, 900], [800, 1200]] as const) {
      const f = flatFrame(w, h);
      const planeScale = (f.scale * (f.camY - Y)) / (f.camY - PLANE_Y);
      const planePx = 2 * PLANE_HALF_WIDTH * planeScale * f.planeScaleX;
      expect(planePx).toBeCloseTo(f.trackPx, 6);
      expect(f.trackPx).toBeCloseTo(2 * LANE_HALF_WIDTH * f.scale, 6);
      // 平面在音符面下方 0.54 ⇒ 投影比例更小，所以平面要横向缩/放 `planeScaleX` 才贴住边线。
      // 16:9 附近略收（0.96），超宽画布相机更近、要略放（1.03），都是几个百分点量级。
      expect(f.planeFitX).toBeGreaterThan(1);
      expect(f.planeScaleX).toBeGreaterThan(0.9);
      expect(f.planeScaleX).toBeLessThan(1.1);
      expect(f.planeScaleX).toBeCloseTo((LANE_HALF_WIDTH * f.planeFitX) / PLANE_HALF_WIDTH, 9);
    }
  });

  it('轨道宽度可配置：百分比越大相机越近、轨道越宽，判定点仍对齐', () => {
    for (const [w, h] of [[1920, 1080], [1296, 616]] as const) {
      const base = flatFrame(w, h);
      const narrow = flatFrame(w, h, 60, 40);
      const wide = flatFrame(w, h, 60, 80);
      // 轨道宽度 ∝ 百分比（轨道 = 60 个 lane 的跨度，音符面量，所以 scale 严格线性）
      expect(narrow.trackPx / base.trackPx).toBeCloseTo(40 / FLAT_TRACK_DEFAULT, 6);
      expect(wide.trackPx / base.trackPx).toBeCloseTo(80 / FLAT_TRACK_DEFAULT, 6);
      expect(narrow.scale / base.scale).toBeCloseTo(40 / FLAT_TRACK_DEFAULT, 6);
      expect(wide.scale / base.scale).toBeCloseTo(80 / FLAT_TRACK_DEFAULT, 6);
      // 相机距离随轨道变宽而变近（scale 反解自 camY）
      expect(wide.camY).toBeLessThan(base.camY);
      expect(narrow.camY).toBeGreaterThan(base.camY);
      // 判定点对齐不受影响
      for (const f of [narrow, base, wide]) {
        expect(f.judgeY).toBeCloseTo((h * FLAT_JUDGE_DEFAULT) / 100, 6);
        expect(h / 2 + (-BORDER - f.camZ) * f.scale).toBeCloseTo(f.judgeY, 6);
      }
    }
    expect(flatTrackFraction(FLAT_TRACK_DEFAULT)).toBeCloseTo(0.6, 9);
    expect(flatTrackFraction(1)).toBeCloseTo(FLAT_TRACK_MIN / 100, 9);
    expect(flatTrackFraction(500)).toBeCloseTo(FLAT_TRACK_MAX / 100, 9);
    expect(flatTrackFraction(Number.NaN)).toBeCloseTo(FLAT_TRACK_DEFAULT / 100, 9);
  });

  it('轨道宽度只由画布宽度决定，窄画布靠放大 fov 保持等比', () => {
    const wide = flatFrame(1920, 1080);
    const narrow = flatFrame(1440, 1080);
    expect(narrow.trackPx).toBeCloseTo((1440 / 1920) * wide.trackPx, 6);
    // 4:3 时 fov 被放大（保持 16:9 水平视角），相机更近但仍等比
    expect(flatFrame(1440, 1080, 74.9).camY).toBeLessThan(flatFrame(1440, 1080, 60).camY);
  });

  it('判定线位置可配置：上下移动时判定点、下落窗口、下边距与平面底边一起跟随', () => {
    for (const [w, h] of [[1920, 1080], [1296, 616], [1440, 1080]] as const) {
      const uiScale = designScale(w, h);
      for (const p of [FLAT_JUDGE_MIN, 62, FLAT_JUDGE_DEFAULT, 82, FLAT_JUDGE_MAX]) {
        const f = flatFrame(w, h, 60, FLAT_TRACK_DEFAULT, p);
        expect(f.judgeY).toBeCloseTo((h * p) / 100, 6);
        // 判定点（BORDER）仍然投影在 judgeY 上
        expect(h / 2 + (-BORDER - f.camZ) * f.scale).toBeCloseTo(f.judgeY, 6);
        // 判定线贴图中心跟着走
        expect(f.lineUiY).toBeCloseTo((h / 2 - f.judgeY) / uiScale, 6);
        // 判定线端（边线近端 / 贴图底边）仍然收在画布底边
        expect(h / 2 + (f.bottomZ - f.camZ) * f.scale).toBeCloseTo(h, 6);
        // 轨道平面底边被推到画布外：看不到轨道区域的下界
        const planeScale = (f.scale * (f.camY - Y)) / (f.camY - PLANE_Y);
        expect(h / 2 + (f.planeNearZ - f.camZ) * planeScale).toBeGreaterThanOrEqual(h);
      }
      // 往下移：判定线下移、下落窗口变长、下边距变短、平面近端更靠近相机
      const up = flatFrame(w, h, 60, FLAT_TRACK_DEFAULT, 60);
      const down = flatFrame(w, h, 60, FLAT_TRACK_DEFAULT, 85);
      expect(down.judgeY).toBeGreaterThan(up.judgeY);
      expect(down.field).toBeGreaterThan(up.field);
      expect(down.below).toBeLessThan(up.below);
      // 相机 z 反解：判定线下移 ⇒ 相机往远端退
      expect(down.camZ).toBeLessThan(up.camZ);
    }
    expect(flatJudgeFraction(FLAT_JUDGE_DEFAULT)).toBeCloseTo(FLAT_JUDGE_DEFAULT / 100, 9);
    expect(flatJudgeFraction(1)).toBeCloseTo(FLAT_JUDGE_MIN / 100, 9);
    expect(flatJudgeFraction(500)).toBeCloseTo(FLAT_JUDGE_MAX / 100, 9);
    expect(flatJudgeFraction(Number.NaN)).toBeCloseTo(FLAT_JUDGE_DEFAULT / 100, 9);
  });
});

describe('2D fever 边线层贴边（LineCoreMove / LineParticle）', () => {
  const rail = { railX: RAIL_HALF_WIDTH, zNear: -9, zFar: 4 };

  it('彗星沿轨道边跑：x 钉在 ±railX，z 随进度从判定线端走到远端', () => {
    for (const side of ['left', 'right'] as const) {
      const dir = side === 'left' ? -1 : 1;
      expect(flatRailPoint(side, rail, 0).x).toBeCloseTo(dir * RAIL_HALF_WIDTH, 9);
      expect(flatRailPoint(side, rail, 0).z).toBeCloseTo(rail.zNear, 9);
      expect(flatRailPoint(side, rail, 0.5).z).toBeCloseTo((rail.zNear + rail.zFar) / 2, 9);
      expect(flatRailPoint(side, rail, 1).z).toBeCloseTo(rail.zFar, 9);
      // 高度一律压在音符平面上，不再有竖直位移
      expect(flatRailPoint(side, rail, 0.3).y).toBe(Y);
    }
  });

  it('进度越界会被夹住（补发 / 超时都不会跑到轨道外）', () => {
    expect(flatRailPoint('left', rail, -2).z).toBeCloseTo(rail.zNear, 9);
    expect(flatRailPoint('left', rail, 3).z).toBeCloseTo(rail.zFar, 9);
  });

  it('粒子自身漂移叠加在边线上：横向仍贴边、竖直漂移折成「沿边推进」', () => {
    const p = flatRailPoint('right', rail, 0.25, { x: 0.2, y: 0.5, z: 0 });
    expect(p.x).toBeCloseTo(RAIL_HALF_WIDTH + 0.2, 9);
    // 0.25 → zNear + 0.25·13 = −5.75，再加竖直漂移 0.5
    expect(p.z).toBeCloseTo(-5.75 + 0.5, 9);
  });
});

describe('2D 线性下落曲线', () => {
  it('判定时刻在判定线上，出生点在可见区顶边', () => {
    const s = createFlatSlope(5, 0, 10);
    expect(s.zAt(0)).toBeCloseTo(BORDER, 9);
    expect(s.zAt(s.duration)).toBeCloseTo(s.spawn, 9);
    expect(s.spawn).toBeCloseTo(BORDER + 10, 9);
  });

  it('等速：位移与 remaining 成正比（俯视下不挤在判定线附近）', () => {
    const s = createFlatSlope(7, 0, 8);
    const v = (s.zAt(1) - s.zAt(0)) / 1;
    for (const t of [0, 0.2, 0.5, 0.9]) {
      expect(s.zAt(t) - s.zAt(0)).toBeCloseTo(v * t, 9);
      expect(s.zAt(s.duration - t) - s.zAt(0)).toBeCloseTo(v * (s.duration - t), 9);
    }
  });

  it('提前量时长沿用 3D 曲线，与 speed 成反比', () => {
    for (const speed of [1, 5, 10, 20]) {
      const flat = createFlatSlope(speed, 0, 9);
      expect(flat.duration).toBeCloseTo(createSlope(speed, 0).duration, 9);
    }
    // 3D 曲线用牛顿迭代收敛（步长 < 0.01 即停），duration 只保证 ~1e-5 精度
    expect(createFlatSlope(10, 0, 9).duration).toBeCloseTo(createFlatSlope(5, 0, 9).duration / 2, 3);
  });

  it('NoteStartZ 只把出生点下移，不改变判定线处的速度', () => {
    const base = createFlatSlope(5, 0, 10);
    const cut = createFlatSlope(5, 50, 10);
    expect(cut.spawn).toBeCloseTo(BORDER + 5, 9);
    expect(cut.duration).toBeCloseTo(base.duration / 2, 9);
    // 世界速度一致 ⇒ 屏幕速度一致（与 3D 判定线处的速度不随 NoteStartZ 变化同义）
    expect(cut.zAt(0.1) - cut.zAt(0)).toBeCloseTo(base.zAt(0.1) - base.zAt(0), 9);
  });

  it('可见长度非法或速度非法时报错', () => {
    expect(() => createFlatSlope(5, 0, 0)).toThrow();
    expect(() => createFlatSlope(0, 0, 10)).toThrow();
    expect(() => createFlatSlope(5, 0, NaN)).toThrow();
  });
});

describe('billboard 基向量', () => {
  const quad = (pitch: number, h = 0.45) => {
    setBillboardPitch(pitch);
    const pos = new Float32Array(18), uv = new Float32Array(12), col = new Float32Array(24);
    pushBillboard(pos, uv, col, 0, 6, 0, Y, 0, 0.4, h, [1, 1, 1, 1]);
    const corners = [0, 1, 2, 3].map(i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
    return corners;
  };

  it('3D 俯角下贴图竖轴沿相机上方（y 变化 + z 反向）', () => {
    const c = quad(PITCH);
    expect(c[2][1] - c[0][1]).toBeCloseTo(Math.cos(PITCH) * 0.45, 6);
    expect(c[2][2] - c[0][2]).toBeCloseTo(-Math.sin(PITCH) * 0.45, 6);
  });

  it('2D 俯视下贴图平铺：四角 y 相同，竖轴落在 z 上', () => {
    const c = quad(FLAT_PITCH);
    for (const p of c) expect(p[1]).toBeCloseTo(Y, 9);
    // unity +z（Three −z）= 屏幕向上
    expect(c[2][2] - c[0][2]).toBeCloseTo(-0.45, 6);
    expect(c[1][0] - c[0][0]).toBeCloseTo(0.4, 6);
  });

  it('九宫格音符同样平铺，且宽度沿 x', () => {
    setBillboardPitch(FLAT_PITCH);
    const pos = new Float32Array(18 * 3), uv = new Float32Array(18 * 2), col = new Float32Array(18 * 4);
    const meta = { border: [60, 0, 60, 0], rect: [128, 68], ppu: 100 };
    const n = pushSlicedNote(pos, uv, col, 0, 18, 0, Y, 0, 0.9, 0.45, meta);
    expect(n).toBeGreaterThan(0);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      expect(pos[i * 3 + 1]).toBeCloseTo(Y, 9);
      minX = Math.min(minX, pos[i * 3]); maxX = Math.max(maxX, pos[i * 3]);
      minZ = Math.min(minZ, pos[i * 3 + 2]); maxZ = Math.max(maxZ, pos[i * 3 + 2]);
    }
    expect(maxX - minX).toBeCloseTo(0.9, 6);
    expect(maxZ - minZ).toBeCloseTo(0.45, 6);
  });

  it('拖尾截面在 2D 下保持水平（宽度方向落在 XZ 面）', () => {
    setBillboardPitch(FLAT_PITCH);
    const pos = new Float32Array(18), uv = new Float32Array(12), col = new Float32Array(24);
    const n = pushTrailSegment(pos, uv, col, 0, 6, [0, Y, 0], [0, Y, 1], 0.1, [1, 1, 1, 1]);
    expect(n).toBe(6);
    for (let i = 0; i < n; i++) expect(pos[i * 3 + 1]).toBeCloseTo(Y, 9);
  });

  it('PlaneEffectModel01 平铺后仍取贴图子矩形、底边贴住粒子（朝屏幕上方伸出）', () => {
    setBillboardPitch(FLAT_PITCH);
    const pos = new Float32Array(18), uv = new Float32Array(12), col = new Float32Array(24);
    // 3D 走 pushLocalQuad(..., PLANE_UV, true)；平铺时必须保留同一子矩形与底部对齐，
    // 否则整张图集（内容挤在下缘）被拉满四边形，光条/箭头会缩在粒子下方、看着「朝下」。
    const n = pushBillboard(pos, uv, col, 0, 6, 0, Y, 0, 0.6, 2, [1, 1, 1, 1], 1, 1, 0, PLANE_UV, true);
    expect(n).toBe(6);
    expect([uv[0], uv[1]]).toEqual([PLANE_UV[0], PLANE_UV[1]]);
    expect([uv[2], uv[3]]).toEqual([PLANE_UV[2], PLANE_UV[1]]);
    expect([uv[4], uv[5]]).toEqual([PLANE_UV[2], PLANE_UV[3]]);
    expect([uv[10], uv[11]]).toEqual([PLANE_UV[0], PLANE_UV[3]]);
    // 底边在粒子位置（Three z = 0），顶边朝屏幕上方（unity +z ⇒ Three −z）
    const zs = Array.from({ length: n }, (_, i) => pos[i * 3 + 2]);
    expect(Math.max(...zs)).toBeCloseTo(0, 9);
    expect(Math.min(...zs)).toBeCloseTo(-2, 6);
    // 宽度仍沿 x 居中展开
    const xs = Array.from({ length: n }, (_, i) => pos[i * 3]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.6, 6);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 6);
  });

  it('切换回 3D 后基向量复原', () => {
    setBillboardPitch(FLAT_PITCH);
    setBillboardPitch(PITCH);
    expect(billboard.upY).toBeCloseTo(Math.cos(PITCH), 12);
    expect(billboard.upZ).toBeCloseTo(-Math.sin(PITCH), 12);
  });
});
