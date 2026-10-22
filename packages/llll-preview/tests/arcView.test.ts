import { describe, it, expect } from 'vitest';
import { BORDER, SPAWN, Y, createSlope, spawnForStartZ } from '../src/geometry';
import { LANE_HALF_WIDTH, LINE_OVERHANG, TAP_LINE_WIDTH } from '../src/flatView';
import {
  ARC_ASPECT, ARC_CENTER_DEFAULT, ARC_CENTER_MAX, ARC_CENTER_MIN, ARC_HALF_ANGLE,
  ARC_JUDGE_BAND, ARC_RADIUS_DEFAULT, ARC_RADIUS_MAX, ARC_RADIUS_MIN, ARC_RADIUS_WORLD,
  arcAngle, arcCenterFraction, arcFrame, arcPoint, arcRadiusAt, arcRadiusFraction,
  createArcSlope,
} from '../src/arcView';

/** 取景基准：min(宽, 16:9 × 高)。 */
const frameBase = (w: number, h: number) => Math.min(w, ARC_ASPECT * h);

describe('SIF 取景设置的比例换算', () => {
  it('默认百分比换算成取景比例', () => {
    expect(arcRadiusFraction(ARC_RADIUS_DEFAULT)).toBeCloseTo(ARC_RADIUS_DEFAULT / 100, 12);
    expect(arcCenterFraction(ARC_CENTER_DEFAULT)).toBeCloseTo(ARC_CENTER_DEFAULT / 100, 12);
    expect(arcRadiusFraction(ARC_RADIUS_DEFAULT)).toBeCloseTo(0.38, 12);
    expect(arcCenterFraction(ARC_CENTER_DEFAULT)).toBeCloseTo(0.25, 12);
  });

  it('超出可调范围时钳位到上下限', () => {
    expect(arcRadiusFraction(ARC_RADIUS_MIN - 10)).toBeCloseTo(ARC_RADIUS_MIN / 100, 12);
    expect(arcRadiusFraction(ARC_RADIUS_MAX + 10)).toBeCloseTo(ARC_RADIUS_MAX / 100, 12);
    expect(arcRadiusFraction(0)).toBeCloseTo(ARC_RADIUS_MIN / 100, 12);
    expect(arcRadiusFraction(999)).toBeCloseTo(ARC_RADIUS_MAX / 100, 12);
    expect(arcCenterFraction(ARC_CENTER_MIN - 10)).toBeCloseTo(ARC_CENTER_MIN / 100, 12);
    expect(arcCenterFraction(ARC_CENTER_MAX + 10)).toBeCloseTo(ARC_CENTER_MAX / 100, 12);
    expect(arcCenterFraction(0)).toBeCloseTo(ARC_CENTER_MIN / 100, 12);
    expect(arcCenterFraction(999)).toBeCloseTo(ARC_CENTER_MAX / 100, 12);
  });

  it('NaN / Infinity 兜底为默认值', () => {
    expect(arcRadiusFraction(Number.NaN)).toBeCloseTo(ARC_RADIUS_DEFAULT / 100, 12);
    expect(arcRadiusFraction(Number.POSITIVE_INFINITY)).toBeCloseTo(ARC_RADIUS_DEFAULT / 100, 12);
    expect(arcRadiusFraction(Number.NEGATIVE_INFINITY)).toBeCloseTo(ARC_RADIUS_DEFAULT / 100, 12);
    expect(arcCenterFraction(Number.NaN)).toBeCloseTo(ARC_CENTER_DEFAULT / 100, 12);
    expect(arcCenterFraction(Number.POSITIVE_INFINITY)).toBeCloseTo(ARC_CENTER_DEFAULT / 100, 12);
  });
});

describe('SIF 半圆取景（arcFrame）', () => {
  it('判定弧半径 = 百分比 × min(宽, 16:9 高)，scale / 弧长随之确定', () => {
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080], [1024, 682], [800, 1200]] as const) {
      const f = arcFrame(w, h);
      expect(f.width).toBe(w);
      expect(f.height).toBe(h);
      // 「SIF 轨道半径」占 min(舞台宽, 16:9 × 舞台高)
      expect(f.radiusPx).toBeCloseTo((ARC_RADIUS_DEFAULT / 100) * frameBase(w, h), 9);
      // 世界单位 → CSS px
      expect(f.scale).toBeCloseTo(f.radiusPx / ARC_RADIUS_WORLD, 12);
      // 判定弧世界半径固定，弧长 = π × 屏幕半径
      expect(f.radius).toBeCloseTo(ARC_RADIUS_WORLD, 12);
      expect(f.arcPx).toBeCloseTo(Math.PI * f.radiusPx, 9);
      expect(f.fanHalfAngle).toBeCloseTo(ARC_HALF_ANGLE, 12);
      expect(f.laneHalfWidth).toBeCloseTo(LANE_HALF_WIDTH, 12);
      // 默认 38% / 25% 在常见画布比例下都放得下，不触发半径封顶
      expect(f.radiusCapped).toBe(false);
    }
    // 超宽画布取 min：半径按 16:9 基准封顶，不随画布变宽无限放大
    expect(arcFrame(2400, 1080).radiusPx).toBeCloseTo(arcFrame(1920, 1080).radiusPx, 9);
    expect(arcFrame(2560, 1080).radiusPx).toBeCloseTo(arcFrame(1920, 1080).radiusPx, 9);
    // 4:3 画布取宽：半径按宽度算，比 16:9 同高画布小
    expect(arcFrame(1440, 1080).radiusPx).toBeCloseTo(0.38 * 1440, 9);
    expect(arcFrame(1440, 1080).radiusPx).toBeLessThan(arcFrame(1920, 1080).radiusPx);
  });

  it('相机反解：音符面投影比例 = scale，圆心投影在 centerScreenY', () => {
    const fov = 60;
    const tan = Math.tan((fov * Math.PI) / 360);
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080]] as const) {
      for (const center of [ARC_CENTER_MIN, ARC_CENTER_DEFAULT, ARC_CENTER_MAX]) {
        const f = arcFrame(w, h, fov, ARC_RADIUS_DEFAULT, center);
        // 俯视透视：音符面（y = Y）上的投影比例
        expect(h / 2 / ((f.camY - Y) * tan)).toBeCloseTo(f.scale, 6);
        // 圆心高度 = 舞台高的百分比
        expect(f.centerScreenY).toBeCloseTo((center / 100) * h, 9);
        // 圆心（世界 z = centerZ）的屏幕 y（自上而下）= centerScreenY
        expect(h / 2 + (-f.centerZ - f.camZ) * f.scale).toBeCloseTo(f.centerScreenY, 6);
      }
    }
  });

  it('不同画布比例下扇形底端（centerScreenY + radiusPx）不超出画布底边', () => {
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080], [1024, 682], [800, 1200]] as const) {
      const f = arcFrame(w, h);
      expect(f.centerScreenY + f.radiusPx).toBeLessThanOrEqual(h + 1e-9);
      // 默认参数下底部还留有余量（16:9 时 ≈ 92.6% 画布高）
      expect(f.centerScreenY + f.radiusPx).toBeLessThan(h);
      // 判定弧左右两端在水平直径上，x 方向对称
      expect(w / 2 - f.radiusPx).toBeGreaterThan(-1e-9);
      expect(w / 2 + f.radiusPx).toBeLessThanOrEqual(w + 1e-9);
    }
  });

  it('极值参数触发半径封顶：压到剩余空间内，扇形仍整块在画布内', () => {
    // 半径上限 44% + 圆心 40%：横屏下「设置值」的像素半径会超过判定弧到画布底边的剩余空间，
    // arcFrame 把它压到 roomY / roomX 的较小者。
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080]] as const) {
      const f = arcFrame(w, h, 60, ARC_RADIUS_MAX, ARC_CENTER_MAX);
      const desiredPx = (ARC_RADIUS_MAX / 100) * frameBase(w, h);
      const roomY = h - f.centerScreenY - h * 0.02;
      const roomX = w / 2 - w * 0.02;
      expect(f.radiusCapped).toBe(true);
      expect(f.radiusPx).toBeCloseTo(Math.min(desiredPx, roomY, roomX), 9);
      expect(f.radiusPx).toBeCloseTo(Math.min(roomY, roomX), 9);
      // 封顶后判定弧不再出画布：底端 ≤ 画布底边，左右两端在画布内
      expect(f.centerScreenY + f.radiusPx).toBeLessThanOrEqual(h + 1e-9);
      expect(w / 2 + f.radiusPx).toBeLessThanOrEqual(w + 1e-9);
      expect(w / 2 - f.radiusPx).toBeGreaterThanOrEqual(-1e-9);
      // 相机仍然按封顶后的 scale 反解
      const tan = Math.tan((60 * Math.PI) / 360);
      expect(h / 2 / ((f.camY - Y) * tan)).toBeCloseTo(f.scale, 6);
      expect(h / 2 + (-f.centerZ - f.camZ) * f.scale).toBeCloseTo(f.centerScreenY, 6);
      // 回显的仍是「设置值」，不是封顶后的像素半径
      expect(f.radiusOpt).toBeCloseTo(ARC_RADIUS_MAX, 9);
      expect(f.centerOpt).toBeCloseTo(ARC_CENTER_MAX, 9);
    }
    // 横屏（1920×1080）由 roomY 封顶
    const landscape = arcFrame(1920, 1080, 60, ARC_RADIUS_MAX, ARC_CENTER_MAX);
    expect(landscape.radiusPx).toBeCloseTo(1080 - landscape.centerScreenY - 1080 * 0.02, 9);
    // 竖屏（800×1200）：44% 半径 352px 本来就小于 roomX 384px，左右放得下 → 不封顶
    const portrait = arcFrame(800, 1200, 60, ARC_RADIUS_MAX, ARC_CENTER_MAX);
    expect(portrait.radiusCapped).toBe(false);
    expect(portrait.radiusPx).toBeCloseTo((ARC_RADIUS_MAX / 100) * 800, 9);
    // 默认参数不封顶（对比：同样画布默认 38% / 25%）
    expect(arcFrame(1920, 1080).radiusCapped).toBe(false);
  });

  it('radiusOpt / centerOpt 回显钳位后的设置值，NaN 回退默认', () => {
    // 999 / 999 越界 → 回显 44 / 40；此时设置值本身超出画布，会被封顶到 roomY。
    const f = arcFrame(1920, 1080, 60, 999, 999);
    expect(f.radiusOpt).toBeCloseTo(ARC_RADIUS_MAX, 9);
    expect(f.centerOpt).toBeCloseTo(ARC_CENTER_MAX, 9);
    expect(f.centerScreenY).toBeCloseTo((ARC_CENTER_MAX / 100) * 1080, 9);
    expect(f.radiusPx).toBeCloseTo(Math.min((ARC_RADIUS_MAX / 100) * 1920, 1080 - f.centerScreenY - 1080 * 0.02, 1920 / 2 - 1920 * 0.02), 9);
    expect(f.radiusCapped).toBe(true);

    // -999 / 999 越界 → 回显 26 / 40；26% 在 16:9 下放得下，不封顶。
    const low = arcFrame(1920, 1080, 60, -999, 999);
    expect(low.radiusOpt).toBeCloseTo(ARC_RADIUS_MIN, 9);
    expect(low.centerOpt).toBeCloseTo(ARC_CENTER_MAX, 9);
    expect(low.radiusPx).toBeCloseTo((ARC_RADIUS_MIN / 100) * 1920, 9);
    expect(low.radiusCapped).toBe(false);

    const d = arcFrame(1920, 1080, 60, Number.NaN, Number.NaN);
    expect(d.radiusOpt).toBeCloseTo(ARC_RADIUS_DEFAULT, 9);
    expect(d.centerOpt).toBeCloseTo(ARC_CENTER_DEFAULT, 9);
    expect(d.radiusPx).toBeCloseTo(arcFrame(1920, 1080).radiusPx, 9);
    expect(d.centerScreenY).toBeCloseTo(arcFrame(1920, 1080).centerScreenY, 9);
    expect(d.radiusCapped).toBe(false);
  });

  it('判定弧贴图带厚与 2D 判定线贴图的高宽比一致', () => {
    // 2D 里判定线贴图（设计宽 1612 / 高 54）等比缩到「轨道跨度 × LINE_OVERHANG」；
    // SIF 里判定弧的弧长正好等于轨道跨度，所以带厚 = 54/1612 × 弧长。
    const judgeArcLength = 2 * LANE_HALF_WIDTH * LINE_OVERHANG;
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080]] as const) {
      const f = arcFrame(w, h);
      expect(f.bandWidth).toBeCloseTo(ARC_JUDGE_BAND, 12);
      expect(f.bandWidth).toBeCloseTo((54 / TAP_LINE_WIDTH) * judgeArcLength, 12);
      // 带厚 / 判定弧（含两端伸出） = 贴图高宽比
      expect(f.bandWidth / judgeArcLength).toBeCloseTo(54 / TAP_LINE_WIDTH, 12);
      // 换成屏幕像素后：带宽 / 弧长 = 54/1612 × LINE_OVERHANG（与 2D 的 linePx/trackPx 同义）
      expect((f.bandWidth * f.scale) / f.arcPx).toBeCloseTo((54 / TAP_LINE_WIDTH) * LINE_OVERHANG, 9);
    }
  });
});

describe('判定弧世界半径', () => {
  it('180° 弧长等于可玩轨道跨度（π·R = 2·LANE_HALF_WIDTH = 9）', () => {
    expect(Math.PI * ARC_RADIUS_WORLD).toBeCloseTo(2 * LANE_HALF_WIDTH, 12);
    expect(Math.PI * ARC_RADIUS_WORLD).toBeCloseTo(9, 12);
    expect(ARC_RADIUS_WORLD).toBeCloseTo(9 / Math.PI, 12);
    // 一个 lane（0.15 世界宽）= 3° 弧
    expect(arcAngle(0.15) - arcAngle(0)).toBeCloseTo((3 * Math.PI) / 180, 12);
    expect(ARC_HALF_ANGLE).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('车道 → 扇形角度（arcAngle）', () => {
  it('中心车道在正下方（0°），两侧车道在 ±90°', () => {
    expect(arcAngle(0)).toBeCloseTo(0, 12);
    expect(arcAngle(LANE_HALF_WIDTH)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(-LANE_HALF_WIDTH)).toBeCloseTo(-Math.PI / 2, 12);
    // 线性：半宽的一半 = 45°
    expect(arcAngle(LANE_HALF_WIDTH / 2)).toBeCloseTo(Math.PI / 4, 12);
    expect(arcAngle(-LANE_HALF_WIDTH / 2)).toBeCloseTo(-Math.PI / 4, 12);
    // 世界 x = lane 0 / lane 59 的外沿 → 扇形两端
    expect(arcAngle(-30 * 0.15)).toBeCloseTo(-Math.PI / 2, 12);
    expect(arcAngle(30 * 0.15)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('越界钳位到 ±90°', () => {
    expect(arcAngle(LANE_HALF_WIDTH * 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(-LANE_HALF_WIDTH * 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(arcAngle(1e6)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(-1e6)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('自定义轨道半宽：±laneHalfWidth 仍映射到 ±90°，非法半宽回退默认', () => {
    expect(arcAngle(3, 3)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(-3, 3)).toBeCloseTo(-Math.PI / 2, 12);
    expect(arcAngle(1.5, 3)).toBeCloseTo(Math.PI / 4, 12);
    expect(arcAngle(9, 3)).toBeCloseTo(Math.PI / 2, 12);
    // 半宽 <= 0 时按 LANE_HALF_WIDTH 归一化
    expect(arcAngle(LANE_HALF_WIDTH, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(LANE_HALF_WIDTH, -1)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcAngle(0, 0)).toBeCloseTo(0, 12);
  });
});

describe('下落距离 → 径向比例（arcRadiusAt）', () => {
  it('判定线处 u = 1，出生点处 u = 0，中间线性', () => {
    const spawn = spawnForStartZ(0);
    expect(spawn).toBeCloseTo(SPAWN, 9);
    expect(arcRadiusAt(BORDER, spawn)).toBeCloseTo(1, 12);
    expect(arcRadiusAt(spawn, spawn)).toBeCloseTo(0, 12);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const z = BORDER + t * (spawn - BORDER);
      expect(arcRadiusAt(z, spawn)).toBeCloseTo(1 - t, 9);
    }
    // 中点（世界 z 的中点）在径向一半处
    expect(arcRadiusAt((BORDER + spawn) / 2, spawn)).toBeCloseTo(0.5, 9);
  });

  it('超出判定线 / 出生点时钳位到 0..1', () => {
    const spawn = spawnForStartZ(0);
    expect(arcRadiusAt(BORDER - 10, spawn)).toBeCloseTo(1, 12);
    expect(arcRadiusAt(spawn + 10, spawn)).toBeCloseTo(0, 12);
    expect(arcRadiusAt(SPAWN + 100, spawn)).toBeCloseTo(0, 12);
    // NoteStartZ 缩短后的出生点同样适用
    const cut = spawnForStartZ(50);
    expect(arcRadiusAt(BORDER, cut)).toBeCloseTo(1, 12);
    expect(arcRadiusAt(cut, cut)).toBeCloseTo(0, 12);
    expect(arcRadiusAt((BORDER + cut) / 2, cut)).toBeCloseTo(0.5, 9);
    expect(arcRadiusAt(cut + 1, cut)).toBeCloseTo(0, 12);
  });

  it('spawnZ == BORDER（NoteStartZ = 100）退化：判定线上为 1，其余为 0', () => {
    const spawn = spawnForStartZ(100);
    expect(spawn).toBeCloseTo(BORDER, 9);
    // 整段都压在判定弧上：z <= BORDER 视为判定弧，z > BORDER（已出生之外）视为圆心
    expect(arcRadiusAt(BORDER, spawn)).toBeCloseTo(1, 12);
    expect(arcRadiusAt(BORDER - 1, spawn)).toBeCloseTo(1, 12);
    expect(arcRadiusAt(BORDER + 1, spawn)).toBeCloseTo(0, 12);
    expect(arcRadiusAt(SPAWN, spawn)).toBeCloseTo(0, 12);
  });
});

describe('轨道坐标 → 半圆盘坐标（arcPoint）', () => {
  const frame = arcFrame(1920, 1080);
  const spawn = spawnForStartZ(0);
  /** 由径向比例 u 反推世界 z（u = 1 - (z - BORDER) / (spawn - BORDER)）。 */
  const zAtU = (u: number) => BORDER + (1 - u) * (spawn - BORDER);

  it('到圆心的距离 = u × ARC_RADIUS_WORLD', () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      const p = arcPoint(frame, 2.25, zAtU(u), spawn);
      expect(p.u).toBeCloseTo(u, 9);
      expect(Math.hypot(p.x, p.z - frame.centerZ)).toBeCloseTo(u * ARC_RADIUS_WORLD, 9);
      expect(Math.hypot(p.x, p.z - frame.centerZ)).toBeCloseTo(u * frame.radius, 9);
    }
  });

  it('角度由 x 定：x = sin(angle)·r、z = centerZ − cos(angle)·r、rot = angle', () => {
    for (const x of [-LANE_HALF_WIDTH, -2.25, 0, 2.25, LANE_HALF_WIDTH]) {
      for (const u of [0.3, 0.6, 1]) {
        const p = arcPoint(frame, x, zAtU(u), spawn);
        const r = u * frame.radius;
        expect(p.angle).toBeCloseTo(arcAngle(x), 12);
        // 横向：局部 +x 沿切线展开
        expect(p.x).toBeCloseTo(Math.sin(p.angle) * r, 9);
        // 径向：Unity z 越大 = 屏幕越靠上，所以「圆心 → 判定弧」是 z 变小
        expect(p.z).toBeCloseTo(frame.centerZ - Math.cos(p.angle) * r, 9);
        // 贴图朝向 = 车道角（slice.ts 的 flatCorners 约定：局部 +x 沿切线、+y 指向圆心）
        expect(p.rot).toBeCloseTo(p.angle, 12);
      }
    }
  });

  it('u = 0 时音符落在圆心', () => {
    for (const x of [-LANE_HALF_WIDTH, -1, 0, 1, LANE_HALF_WIDTH]) {
      const p = arcPoint(frame, x, spawn, spawn);
      expect(p.u).toBeCloseTo(0, 12);
      expect(p.x).toBeCloseTo(0, 12);
      expect(p.z).toBeCloseTo(frame.centerZ, 12);
      expect(p.rot).toBeCloseTo(arcAngle(x), 12);
    }
  });

  it('u = 1、angle = ±90° 时落在左右两端（水平直径上）', () => {
    const left = arcPoint(frame, -LANE_HALF_WIDTH, BORDER, spawn);
    const right = arcPoint(frame, LANE_HALF_WIDTH, BORDER, spawn);
    expect(left.angle).toBeCloseTo(-Math.PI / 2, 12);
    expect(right.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(left.x).toBeCloseTo(-ARC_RADIUS_WORLD, 9);
    expect(right.x).toBeCloseTo(ARC_RADIUS_WORLD, 9);
    // 两端在水平直径上：z 回到圆心所在的 z
    expect(left.z).toBeCloseTo(frame.centerZ, 9);
    expect(right.z).toBeCloseTo(frame.centerZ, 9);
    // 贴图朝向：左端 rot = −90°、右端 rot = +90°（竖轴仍指向圆心）
    expect(left.rot).toBeCloseTo(-Math.PI / 2, 12);
    expect(right.rot).toBeCloseTo(Math.PI / 2, 12);
  });

  it('lane 29.5（x = 0）沿半径向外：只沿 z 方向移动，x 恒为 0', () => {
    for (const u of [0.25, 0.5, 0.75, 1]) {
      const p = arcPoint(frame, 0, zAtU(u), spawn);
      expect(p.x).toBeCloseTo(0, 12);
      expect(p.angle).toBeCloseTo(0, 12);
      expect(p.z).toBeCloseTo(frame.centerZ - u * ARC_RADIUS_WORLD, 9);
      expect(p.rot).toBeCloseTo(0, 12);
    }
  });

  it('判定点（angle = 0、u = 1）经相机投影后落在 centerScreenY + radiusPx（画布内）', () => {
    // 与 renderer 相同的俯视透视：screenY = h/2 + (threeZ − camZ)·scale，threeZ = −z。
    const screenY = (f: ReturnType<typeof arcFrame>, z: number) => f.height / 2 + (-z - f.camZ) * f.scale;
    const screenX = (f: ReturnType<typeof arcFrame>, x: number) => f.width / 2 + x * f.scale;
    for (const [w, h] of [[1920, 1080], [1440, 1080], [2400, 1080], [1024, 682]] as const) {
      const f = arcFrame(w, h);
      const judge = arcPoint(f, 0, BORDER, spawn);
      const center = arcPoint(f, 0, spawn, spawn);
      // 圆心投影在 centerScreenY，判定点在它正下方 radiusPx 处
      expect(screenY(f, center.z)).toBeCloseTo(f.centerScreenY, 6);
      expect(screenX(f, judge.x)).toBeCloseTo(w / 2, 6);
      expect(screenY(f, judge.z)).toBeCloseTo(f.centerScreenY + f.radiusPx, 6);
      expect(screenY(f, judge.z)).toBeGreaterThan(f.centerScreenY);
      expect(screenY(f, judge.z)).toBeLessThanOrEqual(h + 1e-9);
      // 左右两端在水平直径上：屏幕 y 与圆心相同、x 各偏 radiusPx
      const left = arcPoint(f, -LANE_HALF_WIDTH, BORDER, spawn);
      const right = arcPoint(f, LANE_HALF_WIDTH, BORDER, spawn);
      expect(screenY(f, left.z)).toBeCloseTo(f.centerScreenY, 6);
      expect(screenY(f, right.z)).toBeCloseTo(f.centerScreenY, 6);
      expect(screenX(f, left.x)).toBeCloseTo(w / 2 - f.radiusPx, 6);
      expect(screenX(f, right.x)).toBeCloseTo(w / 2 + f.radiusPx, 6);
    }
  });
});

describe('SIF 线性径向下落曲线（createArcSlope）', () => {
  it('提前量时长与 3D 曲线一致，判定时刻在判定线、出生点在出生点', () => {
    for (const speed of [1, 5, 10, 20]) {
      const s = createArcSlope(speed, 0);
      expect(s.duration).toBeCloseTo(createSlope(speed, 0).duration, 12);
      expect(s.speed).toBe(speed);
      expect(s.spawn).toBeCloseTo(spawnForStartZ(0), 9);
      expect(s.spawn).toBeCloseTo(SPAWN, 9);
      expect(s.zAt(0)).toBeCloseTo(BORDER, 12);
      expect(s.zAt(s.duration)).toBeCloseTo(s.spawn, 9);
    }
  });

  it('线性：等时间间隔的 z 差相等（屏幕上是匀速滑向判定弧）', () => {
    const s = createArcSlope(7, 0);
    const step = s.duration / 8;
    const dz = s.zAt(step) - s.zAt(0);
    for (let i = 1; i < 8; i++) {
      expect(s.zAt((i + 1) * step) - s.zAt(i * step)).toBeCloseTo(dz, 9);
    }
    // 与 3D 的 zAt 不同：SIF 的 z 与 remaining 严格成正比
    for (const t of [0.1, 0.5, 0.9]) {
      expect(s.zAt(t * s.duration) - s.zAt(0)).toBeCloseTo(t * (s.spawn - BORDER), 9);
    }
  });

  it('NoteStartZ > 0：时长按 (1 − startZ/100) 缩短，出生点与 spawnForStartZ 一致', () => {
    const base = createSlope(5, 0).duration;
    for (const startZ of [25, 50, 75]) {
      const s = createArcSlope(5, startZ);
      expect(s.duration).toBeCloseTo(base * (1 - startZ / 100), 9);
      expect(s.spawn).toBeCloseTo(spawnForStartZ(startZ), 9);
      expect(s.zAt(0)).toBeCloseTo(BORDER, 12);
      expect(s.zAt(s.duration)).toBeCloseTo(s.spawn, 9);
    }
  });

  it('判定线处速度 (spawn − BORDER) / duration 与 NoteStartZ 无关', () => {
    const base = createArcSlope(5, 0);
    const v = (base.spawn - BORDER) / base.duration;
    for (const startZ of [25, 50, 75]) {
      const s = createArcSlope(5, startZ);
      expect((s.spawn - BORDER) / s.duration).toBeCloseTo(v, 9);
      // zAt 的斜率同样不变（只缩短读谱窗口）
      expect((s.zAt(0.2) - s.zAt(0)) / 0.2).toBeCloseTo(v, 9);
    }
  });

  it('NoteStartZ 越界被钳位；startZ = 100 时退化为极小提前量', () => {
    expect(createArcSlope(5, -20).spawn).toBeCloseTo(spawnForStartZ(0), 9);
    expect(createArcSlope(5, -20).duration).toBeCloseTo(createSlope(5, 0).duration, 9);
    expect(createArcSlope(5, 150).spawn).toBeCloseTo(spawnForStartZ(100), 9);
    expect(createArcSlope(5, 150).duration).toBeCloseTo(createArcSlope(5, 100).duration, 12);

    const full = createArcSlope(5, 100);
    expect(full.spawn).toBeCloseTo(BORDER, 9);
    // 时长缩到 0，这里用极小值兜底，不产生 0/0
    expect(full.duration).toBeGreaterThan(0);
    expect(full.duration).toBeCloseTo(1e-6, 12);
    expect(full.zAt(0)).toBeCloseTo(BORDER, 9);
    expect(full.zAt(full.duration)).toBeCloseTo(BORDER, 9);
  });

  it('非法速度抛错（沿用 createSlope 的校验）', () => {
    for (const bad of [0, -1, 30.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createArcSlope(bad, 0)).toThrow();
    }
  });
});

