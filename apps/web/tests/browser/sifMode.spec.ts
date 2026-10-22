import { expect, test, type Page } from '@playwright/test';

/** 判定弧半径（世界单位）：180° 弧长 = 可玩轨道跨度 9 ⇒ R = 9/π。 */
const ARC_RADIUS_WORLD = 9 / Math.PI;
/** 取景基准：判定弧半径 = 设置% × min(舞台宽, 16:9 × 舞台高)。 */
const ARC_ASPECT = 16 / 9;
/** 浏览器里直接 import 仓库源码（与 cameraMode.spec.ts 的用法一致）。 */
const CHART_MODULE = '/@fs/D:/Repos/sukushow/packages/chart/src/chart.ts';
const ARC_MODULE = '/@fs/D:/Repos/sukushow/packages/llll-preview/src/arcView.ts';
const SLICE_MODULE = '/@fs/D:/Repos/sukushow/packages/llll-preview/src/slice.ts';

/**
 * `debugArcLayout().radiusPx` 的期望值：设置% × min(宽, 16:9·高)，
 * 再被「圆心到画布底边 / 左右边缘的剩余空间」封顶（见 arcView.arcFrame）。
 */
function expectedRadiusPx(radiusOpt: number, centerOpt: number, w: number, h: number): number {
  const desired = (radiusOpt / 100) * Math.min(w, ARC_ASPECT * h);
  const roomY = Math.max(0, h - (centerOpt / 100) * h - h * 0.02);
  const roomX = Math.max(0, w / 2 - w * 0.02);
  return Math.min(desired, roomY, roomX);
}

/** 打开 LLLL 舞台，等渲染器与贴图资源就绪。 */
async function openStage(page: Page) {
  await page.goto('/?view=llll');
  await page.waitForFunction(() => Boolean((window as any).__LPW__?.renderer), null, { timeout: 90_000 });
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  // 舞台尺寸是取景反解的前提，等它量出来。
  await expect.poll(() => page.evaluate(() => (window as any).__LPW__.renderer.domElement.clientWidth)).toBeGreaterThan(0);
}

async function switchToSif(page: Page) {
  await page.locator('#stage button[data-stage-mode="sif"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', 'sif');
}

/** 读 SIF 取景（CSS px / 世界单位）与舞台尺寸。 */
function readArcLayout(page: Page) {
  return page.evaluate(() => {
    const r = (window as any).__LPW__.renderer;
    const canvas = r.domElement as HTMLCanvasElement;
    return { layout: r.debugArcLayout(), w: canvas.clientWidth, h: canvas.clientHeight, state: r.getCameraState() };
  });
}

/** 设置「播放与轨道」里的 range，并派发 input（与真实拖动同一条路径）。 */
async function setRange(page: Page, id: string, value: number) {
  await page.evaluate(([selector, v]) => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [`#${id}`, value] as const);
}

test('SIF 是舞台的第三档相机模式：三档互斥、aria-pressed 与相机角度正确', async ({ page }) => {
  await openStage(page);
  const stage = page.locator('#stage');
  const glCanvas = page.locator('#chart-canvas');

  await expect(stage.locator('button[data-stage-mode]')).toHaveCount(3);
  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(stage.locator('button[data-stage-mode="3d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('button[data-stage-mode="sif"]')).toHaveAttribute('aria-pressed', 'false');
  // 非 SIF 模式没有半圆取景。
  expect(await page.evaluate(() => (window as any).__LPW__.renderer.debugArcLayout())).toBeNull();

  await switchToSif(page);
  await expect(stage).toHaveAttribute('data-stage-mode', 'sif');
  await expect(stage.locator('button[data-stage-mode="sif"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('button[data-stage-mode="3d"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(stage.locator('button[data-stage-mode="2d"]')).toHaveAttribute('aria-pressed', 'false');
  const sifState = await page.evaluate(() => (window as any).__LPW__.renderer.getCameraState());
  expect(sifState.mode).toBe('sif');
  // SIF = 垂直俯视（与 2D 同一俯角），相机在正上方。
  expect(sifState.pitch).toBeCloseTo(-Math.PI / 2, 6);
  expect(sifState.position.x).toBeCloseTo(0, 6);
  expect(await page.evaluate(() => (window as any).__LPW__.renderer.debugArcLayout())).not.toBeNull();

  // 切回 2D / 3D 都正常（三档共用同一个渲染器）。
  await stage.locator('button[data-stage-mode="2d"]').click();
  await expect(stage).toHaveAttribute('data-stage-mode', '2d');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '2d');
  await expect(stage.locator('button[data-stage-mode="2d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(stage.locator('button[data-stage-mode="sif"]')).toHaveAttribute('aria-pressed', 'false');
  expect((await page.evaluate(() => (window as any).__LPW__.renderer.getCameraState())).mode).toBe('2d');
  expect(await page.evaluate(() => (window as any).__LPW__.renderer.debugArcLayout())).toBeNull();

  await stage.locator('button[data-stage-mode="3d"]').click();
  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(stage.locator('button[data-stage-mode="3d"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await page.evaluate(() => (window as any).__LPW__.renderer.getCameraState())).mode).toBe('3d');
});

test('SIF 取景：判定弧半径 / 圆心高度按默认设置反解，世界半径 = 9/π', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);
  const probe = await readArcLayout(page);
  const { layout, w, h } = probe;
  expect(layout).not.toBeNull();

  // 默认「SIF 轨道半径 38%」「SIF 圆心高度 25%」。
  expect(layout.radiusOpt).toBe(38);
  expect(layout.centerOpt).toBe(25);
  expect(layout.radiusCapped).toBe(false);
  expect(layout.radiusPx).toBeCloseTo(expectedRadiusPx(38, 25, w, h), 3);
  expect(layout.centerScreenX).toBeCloseTo(w / 2, 3);
  expect(layout.centerScreenY).toBeCloseTo(0.25 * h, 3);
  expect(layout.judgeArcBottomY).toBeCloseTo(layout.centerScreenY + layout.radiusPx, 6);
  // 180° 弧长 = 可玩轨道跨度 2·4.5 = 9 ⇒ R = 9/π；屏幕比例随之确定。
  expect(layout.radiusWorld).toBeCloseTo(ARC_RADIUS_WORLD, 9);
  expect(layout.laneHalfWidth).toBeCloseTo(4.5, 9);
  expect(layout.fanHalfAngle).toBeCloseTo(Math.PI / 2, 9);
  expect(layout.scale).toBeCloseTo(layout.radiusPx / layout.radiusWorld, 6);
  expect(layout.judgeArcPx).toBeCloseTo(Math.PI * layout.radiusPx, 3);

  // 相机反解：屏幕 y = h/2 + (threeZ − camZ)·scale，圆心 three z = −centerZ。
  expect(layout.camY).toBeGreaterThan(4.5);
  expect(h / 2 + (-layout.centerZ - layout.camZ) * layout.scale).toBeCloseTo(layout.centerScreenY, 3);
  // 相机投影验证：判定弧底端（角度 0、u=1）正好落在圆心下方 radiusPx 处。
  expect(layout.judgePointScreenY).toBeCloseTo(layout.judgeArcBottomY, 3);
  expect(layout.centerProjectedY).toBeCloseTo(layout.centerScreenY, 3);
  // 扇形底端（圆心 + 判定弧半径）仍在画布内。
  expect(layout.judgeArcBottomY).toBeLessThanOrEqual(h + 1);
});

test('SIF 轨道半径 / 圆心高度可配置：拖动即时生效、过大时按剩余空间收窄，并持久化', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  // 默认值先落到表单（含 output 数值显示）。
  await expect(page.locator('#opt-sif-radius')).toHaveValue('38');
  await expect(page.locator('#opt-sif-radius-value')).toHaveText('38');
  await expect(page.locator('#opt-sif-center')).toHaveValue('25');
  await expect(page.locator('#opt-sif-center-value')).toHaveText('25');
  const base = await readArcLayout(page);

  // 40%：仍在画布空间内，半径像素同比放大、圆心不动。
  await setRange(page, 'opt-sif-radius', 40);
  await expect.poll(async () => (await readArcLayout(page)).layout.radiusOpt).toBe(40);
  await expect(page.locator('#opt-sif-radius-value')).toHaveText('40');
  const wide = await readArcLayout(page);
  expect(wide.layout.radiusCapped).toBe(false);
  expect(wide.layout.radiusPx).toBeCloseTo(base.layout.radiusPx * (40 / 38), 3);
  expect(wide.layout.centerScreenY).toBeCloseTo(base.layout.centerScreenY, 3);
  // 世界半径只由弧长定死，不随取景设置变化。
  expect(wide.layout.radiusWorld).toBeCloseTo(ARC_RADIUS_WORLD, 9);

  // 44%（上限）：判定弧底端会跑出画布，radiusPx 被剩余空间（roomY / roomX）封顶。
  await setRange(page, 'opt-sif-radius', 44);
  await expect.poll(async () => (await readArcLayout(page)).layout.radiusOpt).toBe(44);
  await expect(page.locator('#opt-sif-radius-value')).toHaveText('44');
  const capped = await readArcLayout(page);
  expect(capped.layout.radiusCapped).toBe(true);
  expect(capped.layout.radiusPx).toBeCloseTo(expectedRadiusPx(44, 25, capped.w, capped.h), 3);
  expect(capped.layout.radiusPx).toBeLessThan(0.44 * Math.min(capped.w, ARC_ASPECT * capped.h));
  expect(capped.layout.judgeArcBottomY).toBeCloseTo(capped.layout.centerScreenY + capped.layout.radiusPx, 6);
  expect(capped.layout.judgeArcBottomY).toBeLessThanOrEqual(capped.h + 1);

  // 回到 40%，再把圆心下移到 34%：圆心屏幕 y 跟着走，相机跟着平移。
  await setRange(page, 'opt-sif-radius', 40);
  await expect.poll(async () => (await readArcLayout(page)).layout.radiusOpt).toBe(40);
  await setRange(page, 'opt-sif-center', 34);
  await expect.poll(async () => (await readArcLayout(page)).layout.centerOpt).toBe(34);
  await expect(page.locator('#opt-sif-center-value')).toHaveText('34');
  const moved = await readArcLayout(page);
  expect(moved.layout.centerScreenY).toBeCloseTo(0.34 * moved.h, 3);
  expect(moved.layout.centerScreenY).toBeGreaterThan(base.layout.centerScreenY);
  expect(moved.layout.camZ).not.toBeCloseTo(base.layout.camZ, 6);
  expect(moved.layout.radiusPx).toBeCloseTo(expectedRadiusPx(40, 34, moved.w, moved.h), 3);

  // 写入 localStorage 的预览设置。
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('llll-preview-web:settings:v1') || '{}'));
  expect(stored.sifRadius).toBe(40);
  expect(stored.sifCenterY).toBe(34);

  // 刷新后表单恢复，切到 SIF 时按存下的取景反解。
  await page.reload();
  await expect(page.locator('#opt-sif-radius')).toHaveValue('40');
  await expect(page.locator('#opt-sif-center')).toHaveValue('34');
  await expect(page.locator('#opt-sif-radius-value')).toHaveText('40');
  await expect(page.locator('#opt-sif-center-value')).toHaveText('34');
  await page.waitForFunction(() => Boolean((window as any).__LPW__?.renderer), null, { timeout: 90_000 });
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  await switchToSif(page);
  const restored = await readArcLayout(page);
  expect(restored.layout.radiusOpt).toBe(40);
  expect(restored.layout.centerOpt).toBe(34);
  expect(restored.layout.centerScreenY).toBeCloseTo(0.34 * restored.h, 3);
  expect(restored.layout.radiusPx).toBeCloseTo(expectedRadiusPx(40, 34, restored.w, restored.h), 3);
});

test('SIF 音符落在半圆扇形上：角度 = 车道角、半径 = u·R、越接近判定弧越大', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  const probe = await page.evaluate(async ([chartModule, arcModule, sliceModule]) => {
    const { parseChart } = await import(/* @vite-ignore */ chartModule);
    const { createArcSlope, ARC_RADIUS_WORLD } = await import(/* @vite-ignore */ arcModule);
    const { worldWidthOf, worldDepth } = await import(/* @vite-ignore */ sliceModule);
    const r = (window as any).__LPW__.renderer;
    r.setCameraMode('sif');
    r.setVisualOptions({ sifRadius: 38, sifCenterY: 25, laneWidth: 100, noteStartZ: 0 });
    const layout = r.debugArcLayout();
    const slope = createArcSlope(5, 0);
    const noteTime = 6;
    const lanes = [0, 15, 29, 30, 45, 59];
    const us = [0.2, 0.5, 0.8, 1];
    const cases: Array<Record<string, number>> = [];
    for (const lane of lanes) {
      for (const u of us) {
        const remaining = (1 - u) * slope.duration;
        // 单 lane、type 0：Flags = type | r<<4 | l<<16（见 chart.ts 的 parseNote）。
        const flags = (lane << 4) | (lane << 16);
        const chart = parseChart({ Notes: [{ Uid: 1, just: String(noteTime), Flags: flags, holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
        r.render(chart, noteTime - remaining, 5, false, false);
        // 一帧里只有一个音符 ⇒ 贴图批次的全部顶点都属于它。
        const points: number[][] = [];
        for (const batch of r.sheets.values()) {
          for (let i = 0; i < batch.n; i++) points.push([batch.pos[i * 3], batch.pos[i * 3 + 1], -batch.pos[i * 3 + 2]]);
        }
        if (!points.length) { cases.push({ lane, u, vertexCount: 0 }); continue; }
        // 音符四角关于中心对称 ⇒ 包围盒中心 = 贴图中心（9-slice 各段帽宽不对称也不影响）。
        const xs = points.map(p => p[0]), ys = points.map(p => p[1]), zs = points.map(p => p[2]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        const dx = cx, dz = cz - layout.centerZ;
        const length = Math.hypot(dx, dz);
        // 圆心 → 音符 / 切线两个基向量（切向 = 沿判定弧）。
        const radial = [dx / length, dz / length];
        const tangent = [-dz / length, dx / length];
        let tangentExtent = 0, radialExtent = 0;
        for (const p of points) {
          const px = p[0] - cx, pz = p[2] - cz;
          tangentExtent = Math.max(tangentExtent, Math.abs(px * tangent[0] + pz * tangent[1]) * 2);
          radialExtent = Math.max(radialExtent, Math.abs(px * radial[0] + pz * radial[1]) * 2);
        }
        // 弧段是弯的（宽音符不是直弦）：按极坐标量角度跨度 / 径向厚度，
        // 角宽 = worldWidth / (u·R) = 常数，径向厚度 = worldDepth × u。
        const polar = points.map(p => {
          const px = p[0], pz = p[2] - layout.centerZ;
          return { a: Math.atan2(px, -pz), r: Math.hypot(px, pz) };
        });
        const angleSpan = Math.max(...polar.map(p => p.a)) - Math.min(...polar.map(p => p.a));
        const radialSpan = Math.max(...polar.map(p => p.r)) - Math.min(...polar.map(p => p.r));
        cases.push({ lane, u, vertexCount: points.length, cx, cy, cz, radius: length, angle: Math.atan2(dx, -dz), tangentExtent, radialExtent, angleSpan, radialSpan });
      }
    }
    return {
      layout, layoutAfter: r.debugArcLayout(), cases, spawnZ: slope.spawn, radiusWorld: ARC_RADIUS_WORLD,
      noteWidth: worldWidthOf(1, 100), noteDepth: worldDepth(0),
    };
  }, [CHART_MODULE, ARC_MODULE, SLICE_MODULE] as const);

  expect(probe.layout).not.toBeNull();
  // 渲染一帧后 SIF 的出生 z 已按当前下落曲线刷新（音符在圆心处的 z）。
  expect(probe.layoutAfter.spawnZ).toBeCloseTo(probe.spawnZ, 6);

  const byLane = new Map<number, Array<Record<string, number>>>();
  for (const item of probe.cases) {
    // 每个音符都画出来了。
    expect(item.vertexCount, `lane ${item.lane} u ${item.u} 没有音符顶点`).toBeGreaterThan(0);
    // 音符平铺在轨道面（y = Y = 4.5）上。
    expect(item.cy).toBeCloseTo(4.5, 3);
    // 车道角 φ：x = (lane − 29.5) × 0.15 → ±90°（lane 0/59 在左右两端、lane 29.5 在正下方）。
    const phi = (item.lane - 29.5) * 0.15 / 4.5 * (Math.PI / 2);
    // 音符在扇形上按弧长弯成弧段（宽音符不是直弦），这里量的是包围盒中心：
    // 弧段相对极坐标中心有 ≤ 半段弦高 的内缩，所以位置类断言给 0.005 的容差（≈0.3° / 0.5px）。
    expect(item.angle).toBeCloseTo(phi, 2);
    expect(Math.abs(item.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    // 极坐标精确位置：x = sin(φ)·u·R、z = centerZ − cos(φ)·u·R（Unity z 越大越靠屏幕上方）。
    expect(item.cx).toBeCloseTo(Math.sin(phi) * item.u * probe.radiusWorld, 2);
    expect(item.cz).toBeCloseTo(probe.layout.centerZ - Math.cos(phi) * item.u * probe.radiusWorld, 2);
    // 质心半径 = u × 判定弧世界半径（u = 1 落在判定弧上、u = 0 收敛到圆心）。
    expect(item.radius).toBeCloseTo(item.u * probe.radiusWorld, 2);
    // 尺寸随 u 等比放大：切向弧长 = 角宽 × 半径（角宽恒定 = worldWidthOf(1)/R，半径 ∝ u），
    // 径向厚度 = worldDepth(0) × u。
    expect(item.angleSpan).toBeCloseTo(probe.noteWidth / probe.radiusWorld, 3);
    expect(item.radialSpan).toBeCloseTo(probe.noteDepth * item.u, 3);
    const laneCases = byLane.get(item.lane) ?? [];
    laneCases.push(item);
    byLane.set(item.lane, laneCases);
  }

  for (const [lane, laneCases] of byLane) {
    const sorted = [...laneCases].sort((a, b) => a.u - b.u);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], next = sorted[i];
      // 越接近判定弧越大（SIF 的透视缩放）：半径、切向弧长、径向厚度都随 u 增长。
      expect(next.radius, `lane ${lane} 半径应随 u 增长`).toBeGreaterThan(prev.radius);
      expect(next.angleSpan * next.radius, `lane ${lane} 切向尺寸应随 u 增长`).toBeGreaterThan(prev.angleSpan * prev.radius);
      expect(next.radialSpan, `lane ${lane} 径向尺寸应随 u 增长`).toBeGreaterThan(prev.radialSpan);
    }
  }
});

test('SIF 宽音符 / hold 沿弧弯开：顶点落在同一半径上（不是横切扇形的直弦）', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  const probe = await page.evaluate(async ([chartModule, arcModule, sliceModule]) => {
    const { parseChart } = await import(/* @vite-ignore */ chartModule);
    const { createArcSlope, ARC_RADIUS_WORLD } = await import(/* @vite-ignore */ arcModule);
    const { worldWidthOf } = await import(/* @vite-ignore */ sliceModule);
    const r = (window as any).__LPW__.renderer;
    r.setCameraMode('sif');
    r.setVisualOptions({ sifRadius: 38, sifCenterY: 25, laneWidth: 100, noteStartZ: 0 });
    const layout = r.debugArcLayout();
    const slope = createArcSlope(5, 0);
    const noteTime = 6, u = 0.8;
    const polar = (x: number, z: number) => {
      const dx = x, dz = z - layout.centerZ;
      return { a: Math.atan2(dx, -dz), r: Math.hypot(dx, dz) };
    };
    const gather = (batch: any) => {
      const out: Array<{ a: number; r: number }> = [];
      for (let i = 0; i < batch.n; i++) out.push(polar(batch.pos[i * 3], -batch.pos[i * 3 + 2]));
      return out;
    };

    // 13 lane 宽的音符（判定弧上 ≈38°）：弯开时所有顶点半径都落在 [rIn, rOut]，
    // 直弦则四角半径会比外缘大 (半宽)²/(2r) ≈ 0.16 世界（远超容差）。
    const tapFlags = (12 << 4) | (0 << 16);
    const tap = parseChart({ Notes: [{ Uid: 1, just: String(noteTime), Flags: tapFlags, holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    r.render(tap, noteTime - (1 - u) * slope.duration, 5, false, false);
    const noteVerts: Array<{ a: number; r: number }> = [];
    for (const batch of r.sheets.values()) noteVerts.push(...gather(batch));
    const noteR = u * ARC_RADIUS_WORLD;
    const noteHalfH = (0.45 * u) / 2;

    // 11 lane 宽的 hold：头排在判定弧上（半径 = R）、尾排在同一半径（u_tail·R），角度铺满跨度。
    const holdFlags = 1 | (10 << 4) | (10 << 10) | (0 << 16) | (0 << 22);
    const hold = parseChart({ Notes: [{ Uid: 1, just: '6', Flags: holdFlags, holds: ['7.5'] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    r.render(hold, 7, 5, false, false);
    const holdVerts = gather(r.ribbon);

    // 判定弧带：中段沿 180° 弧弯开（顶点半径贴着环带 R ± 带厚/2），左右端帽保持**直的**并伸出
    // 水平直径（与 2D / 3D 判定线超出轨道两端一致），所以端帽顶点的 |x| 恒定、unity z 大于圆心 z。
    const judge = r.arcJudge;
    let uMin = 1, uMax = 0;
    for (let i = 0; i < judge.n; i++) {
      uMin = Math.min(uMin, judge.uv[i * 2]);
      uMax = Math.max(uMax, judge.uv[i * 2]);
    }
    const judgePolar = gather(judge);
    const bandH = layout.bandWidth as number;
    // `buildArcBand` 先铺中段、再把两个端帽追加在末尾（各一个四边形 = 6 顶点），所以按尾部切分。
    const capStart = judge.n - 12;
    const capVerts: Array<{ x: number; uz: number; u: number }> = [];
    const midVerts: Array<{ a: number; r: number }> = [];
    for (let i = 0; i < judge.n; i++) {
      if (i >= capStart) capVerts.push({ x: judge.pos[i * 3], uz: -judge.pos[i * 3 + 2], u: judge.uv[i * 2] });
      else midVerts.push(judgePolar[i]);
    }

    return {
      layout, u,
      note: {
        n: noteVerts.length,
        rMin: Math.min(...noteVerts.map(p => p.r)), rMax: Math.max(...noteVerts.map(p => p.r)),
        angleSpan: Math.max(...noteVerts.map(p => p.a)) - Math.min(...noteVerts.map(p => p.a)),
        expectR: noteR, expectHalfH: noteHalfH,
        expectAngleSpan: worldWidthOf(13, 100) / ARC_RADIUS_WORLD,
      },
      hold: {
        n: holdVerts.length,
        radii: [...new Set(holdVerts.map(p => Math.round(p.r * 1000) / 1000))].sort((a, b) => a - b),
        angleSpan: Math.max(...holdVerts.map(p => p.a)) - Math.min(...holdVerts.map(p => p.a)),
        // hold mesh 的 x 宽度 = pitch·(r − l − 1)（原版比音符贴图窄一条 lane：
        // 从 lane l+1 的左边界到 lane r 的左边界），这里 l=0 / r=10 ⇒ 9 × 0.15。
        expectAngleSpan: (0.15 * 9) / ARC_RADIUS_WORLD,
      },
      judge: {
        n: judge.n, uMin, uMax, bandH,
        angleMin: Math.min(...midVerts.map(p => p.a)), angleMax: Math.max(...midVerts.map(p => p.a)),
        rMin: Math.min(...midVerts.map(p => p.r)), rMax: Math.max(...midVerts.map(p => p.r)),
        capCount: capVerts.length,
        capXMin: capVerts.length ? Math.min(...capVerts.map(p => Math.abs(p.x))) : 0,
        capXMax: capVerts.length ? Math.max(...capVerts.map(p => Math.abs(p.x))) : 0,
        // 直的端帽 = 一个矩形：|x| 只有两档（内外两条边），z 也只有两档（环带端 / 外端）。
        capXDistinct: new Set(capVerts.map(p => Math.round(Math.abs(p.x) * 1e6))).size,
        capZDistinct: new Set(capVerts.map(p => Math.round(p.uz * 1e6))).size,
        capZMin: capVerts.length ? Math.min(...capVerts.map(p => p.uz)) : 0,
        capZMax: capVerts.length ? Math.max(...capVerts.map(p => p.uz)) : 0,
        capU: capVerts.map(p => p.u),
      },
      radiusWorld: ARC_RADIUS_WORLD,
    };
  }, [CHART_MODULE, ARC_MODULE, SLICE_MODULE] as const);

  // 宽音符：所有顶点半径严格落在径向厚度内（弯成弧段），角宽 = 世界宽 / R。
  expect(probe.note.n).toBeGreaterThan(0);
  expect(probe.note.rMax).toBeLessThanOrEqual(probe.note.expectR + probe.note.expectHalfH + 1e-3);
  expect(probe.note.rMin).toBeGreaterThanOrEqual(probe.note.expectR - probe.note.expectHalfH - 1e-3);
  expect(probe.note.angleSpan).toBeCloseTo(probe.note.expectAngleSpan, 3);
  // 顶点确实分成外缘 / 内缘两圈（说明按弧长分了段，不是一张直条四边形）。
  expect(probe.note.n).toBeGreaterThan(12);

  // 宽 hold：顶点半径只有两档（头排 = R、尾排 = u_tail·R），角度铺满整条带的跨度。
  expect(probe.hold.n).toBeGreaterThan(12);
  expect(probe.hold.radii.length).toBeLessThanOrEqual(2);
  expect(probe.hold.radii[probe.hold.radii.length - 1]).toBeCloseTo(probe.radiusWorld, 2);
  expect(probe.hold.angleSpan).toBeCloseTo(probe.hold.expectAngleSpan, 3);

  // 判定弧带：中段沿 180° 弧弯开，顶点半径贴着环带（R ± 带厚/2），不越过水平直径（±90°）。
  // 每段是按切线旋转的短条，厚度让首尾两段的角点略微越界（≈0.04°，亚像素），给 0.005 容差。
  expect(probe.judge.uMin).toBeLessThan(0.01);
  expect(probe.judge.uMax).toBeGreaterThan(0.99);
  expect(probe.judge.angleMin).toBeGreaterThanOrEqual(-Math.PI / 2 - 0.005);
  expect(probe.judge.angleMax).toBeLessThanOrEqual(Math.PI / 2 + 0.005);
  expect(probe.judge.rMax).toBeLessThanOrEqual(probe.radiusWorld + probe.judge.bandH / 2 + 0.01);
  expect(probe.judge.rMin).toBeGreaterThanOrEqual(probe.radiusWorld - probe.judge.bandH / 2 - 0.01);

  // 端帽：直的（矩形，|x| / z 各只有两档）且伸出水平直径之外 —— 与 2D / 3D 判定线超出轨道两端一致。
  // 伸出长度 = (LINE_OVERHANG − 1) / 2 × 轨道跨度 = 0.06 × 9 ≈ 0.54 世界。
  expect(probe.judge.capCount).toBeGreaterThan(0);
  expect(probe.judge.capXDistinct).toBe(2);
  expect(probe.judge.capZDistinct).toBe(2);
  expect(probe.judge.capXMin).toBeCloseTo(probe.radiusWorld - probe.judge.bandH / 2, 2);
  expect(probe.judge.capXMax).toBeCloseTo(probe.radiusWorld + probe.judge.bandH / 2, 2);
  expect(probe.judge.capZMax - probe.judge.capZMin).toBeCloseTo(0.06 * 9, 2);
  // 端帽取贴图两端（u = 0 / u = 1 的收尾装饰）。
  expect(Math.min(...probe.judge.capU)).toBeLessThan(0.01);
  expect(Math.max(...probe.judge.capU)).toBeGreaterThan(0.99);
});

test('SIF 带状特效（击中光条）沿弧弯开：长轴指向圆心、按弧长细分', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  const probe = await page.evaluate(async ([chartModule]) => {
    const { parseChart } = await import(/* @vite-ignore */ chartModule);
    const r = (window as any).__LPW__.renderer;
    r.setCameraMode('sif');
    r.setVisualOptions({ sifRadius: 38, sifCenterY: 25, laneWidth: 100, noteStartZ: 0 });
    const layout = r.debugArcLayout();
    // 宽音符 + 击中华丽：PlaneEffectModel01 的光条是「带状」粒子（mesh === 2）。
    const chart = parseChart({ Notes: [{ Uid: 1, just: '2', Flags: (12 << 4) | (0 << 16), holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    r.playing = true;
    for (let t = 1.95; t <= 2.09 + 1e-9; t += 0.02) r.render(chart, Math.round(t * 1000) / 1000, 5, false, false);
    r.playing = false;
    // 只留带状粒子，单独画一帧读顶点（否则会被别的粒子混在一起）。
    const saved = r.fx.live;
    const bandCount = saved.flatMap((l: any) => l.sparks).filter((s: any) => s.mesh === 2).length;
    r.fx.live = saved.map((l: any) => ({ ...l, sparks: l.sparks.filter((s: any) => s.mesh === 2) }));
    r.fx.draw();
    const devs: number[] = [];
    let quads = 0;
    for (const batch of r.fx.batches.values()) {
      // pushQuad 的顶点顺序是 [a, b, c, a, c, d]：0/1 = 锚点（外缘）边，2/5 = 内缘边。
      for (let g = 0; g + 6 <= batch.n; g += 6) {
        const P = (i: number) => ({ x: batch.pos[i * 3], uz: -batch.pos[i * 3 + 2] });
        const a = P(g), b = P(g + 1), c = P(g + 2), d = P(g + 5);
        const anchor = { x: (a.x + b.x) / 2, uz: (a.uz + b.uz) / 2 };
        const inner = { x: (c.x + d.x) / 2, uz: (c.uz + d.uz) / 2 };
        const ax = inner.x - anchor.x, az = inner.uz - anchor.uz;
        const rx = -anchor.x, rz = layout.centerZ - anchor.uz;
        const la = Math.hypot(ax, az), lr = Math.hypot(rx, rz);
        if (la < 1e-6 || lr < 1e-6) continue;
        const cos = Math.max(-1, Math.min(1, (ax * rx + az * rz) / (la * lr)));
        devs.push(Math.abs(Math.acos(cos)) * 180 / Math.PI);
        quads++;
      }
    }
    r.fx.live = saved;
    r.fx.draw();
    return { bandCount, quads, maxDevDeg: devs.length ? Math.max(...devs) : 999 };
  }, [CHART_MODULE] as const);

  expect(probe.bandCount).toBeGreaterThan(0);
  // 每个光条沿弧长分成多段（平铺直条只有 1 段 6 顶点）。
  expect(probe.quads).toBeGreaterThan(probe.bandCount);
  // 长轴（锚点边 → 内缘边）指向圆心：弯曲/朝向错误时这里会偏出几十度。
  expect(probe.maxDevDeg).toBeLessThan(5);
});

test('SIF hold 按住时的头部特效沿弧弯开（不是旋转过的方块）', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  const probe = await page.evaluate(async ([chartModule]) => {
    const { parseChart } = await import(/* @vite-ignore */ chartModule);
    const r = (window as any).__LPW__.renderer;
    r.setCameraMode('sif');
    r.setVisualOptions({ sifRadius: 38, sifCenterY: 25, laneWidth: 100, noteStartZ: 0 });
    const layout = r.debugArcLayout();
    // 11 lane 宽的 hold，t = 7 时正按住（头部特效 followHead = 贴在头部的光晕 / 光环）。
    const holdFlags = 1 | (10 << 4) | (10 << 10) | (0 << 16) | (0 << 22);
    const chart = parseChart({ Notes: [{ Uid: 1, just: '6', Flags: holdFlags, holds: ['8'] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    r.playing = true;
    for (let t = 6.9; t <= 7.02 + 1e-9; t += 0.02) r.render(chart, Math.round(t * 1000) / 1000, 5, false, false);
    r.playing = false;
    r.render(chart, 7, 5, false, false);
    const saved = r.fx.live;
    const headCount = saved.flatMap((l: any) => l.sparks).filter((s: any) => s.followHead).length;
    r.fx.live = saved.map((l: any) => ({ ...l, sparks: l.sparks.filter((s: any) => s.followHead) }));
    r.fx.draw();
    let quads = 0, maxOver = 0, maxWidth = 0;
    for (const batch of r.fx.batches.values()) {
      for (let g = 0; g + 6 <= batch.n; g += 6) {
        const P = (i: number) => {
          const x = batch.pos[i * 3], uz = -batch.pos[i * 3 + 2];
          return { a: Math.atan2(x, layout.centerZ - uz), r: Math.hypot(x, layout.centerZ - uz) };
        };
        const a = P(g), b = P(g + 1), c = P(g + 2), d = P(g + 5);
        const rOut = (a.r + b.r) / 2, rIn = (c.r + d.r) / 2;
        if (!(rOut > rIn)) continue;
        // 弯开时角点半径不会超过外缘（直条的角点在弦外，多出弓高 (w/2)²/(2r) ≈ 0.2）。
        maxOver = Math.max(maxOver, Math.max(a.r, b.r, c.r, d.r) - rOut);
        maxWidth = Math.max(maxWidth, rOut - rIn);
        quads++;
      }
    }
    r.fx.live = saved;
    r.fx.draw();
    return { headCount, quads, maxOver, maxWidth };
  }, [CHART_MODULE] as const);

  expect(probe.headCount).toBeGreaterThan(0);
  expect(probe.quads).toBeGreaterThan(0);
  // 头部光晕有径向厚度（说明它确实铺在环带方向上，而不是一条线）。
  expect(probe.maxWidth).toBeGreaterThan(0.2);
  // 角点不越出外缘 —— 弯开；直条方块这里会多出 0.1 以上。
  expect(probe.maxOver).toBeLessThan(0.01);
});

test('SIF 忽略 LaneWidth：轨道宽度 120% 时特效仍贴在音符的半径上', async ({ page }) => {
  await openStage(page);
  await switchToSif(page);

  const probe = await page.evaluate(async ([chartModule]) => {
    const { parseChart } = await import(/* @vite-ignore */ chartModule);
    const r = (window as any).__LPW__.renderer;
    r.setCameraMode('sif');
    // 13 lane 宽的音符，中心在 lane 6（判定弧上 ≈ −70°）。轨道宽度 120% 时，
    // 如果特效的 x 被「折角度 + 再缩放一次」处理两次，就会落到 1.2 倍半径上。
    r.setVisualOptions({ sifRadius: 38, sifCenterY: 25, laneWidth: 120, noteStartZ: 0 });
    const layout = r.debugArcLayout();
    const chart = parseChart({ Notes: [{ Uid: 1, just: '2', Flags: (12 << 4) | (0 << 16), holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    r.playing = true;
    // 先渲染到音符时刻之前：读音符自身的极坐标角度（判定后音符 sprite 就不再画了）。
    for (let t = 1.95; t <= 1.99 + 1e-9; t += 0.02) r.render(chart, Math.round(t * 1000) / 1000, 5, false, false);
    const note = r.sheets.get('ui_sc2_ingame_notes_tap');
    let nx = 0, nz = 0, n = 0;
    for (let i = 0; i < note.n; i++) { nx += note.pos[i * 3]; nz += -note.pos[i * 3 + 2]; n++; }
    const noteAngle = Math.atan2(nx / n, layout.centerZ - nz / n);
    // 越过判定时刻，生成击中光条。
    for (let t = 2.01; t <= 2.09 + 1e-9; t += 0.02) r.render(chart, Math.round(t * 1000) / 1000, 5, false, false);
    r.playing = false;
    // 只留击中光条（mesh === 2 的带状粒子），读锚点（外缘边的中点）的极坐标。
    const saved = r.fx.live;
    const bandCount = saved.flatMap((l: any) => l.sparks).filter((s: any) => s.mesh === 2).length;
    r.fx.live = saved.map((l: any) => ({ ...l, sparks: l.sparks.filter((s: any) => s.mesh === 2) }));
    r.fx.draw();
    let sumX = 0, sumZ = 0, quads = 0;
    for (const batch of r.fx.batches.values()) {
      for (let g = 0; g + 6 <= batch.n; g += 6) {
        sumX += (batch.pos[g * 3] + batch.pos[(g + 1) * 3]) / 2;
        sumZ += (-batch.pos[g * 3 + 2] - batch.pos[(g + 1) * 3 + 2]) / 2;
        quads++;
      }
    }
    r.fx.live = saved;
    r.fx.draw();
    const mx = sumX / quads, mz = sumZ / quads;
    return {
      bandCount, quads, noteN: n,
      noteAngleDeg: (noteAngle * 180) / Math.PI,
      meanR: Math.hypot(mx, layout.centerZ - mz),
      meanAngleDeg: (Math.atan2(mx, layout.centerZ - mz) * 180) / Math.PI,
      radiusWorld: layout.radiusWorld,
    };
  }, [CHART_MODULE] as const);

  expect(probe.noteN).toBeGreaterThan(0);
  expect(probe.bandCount).toBeGreaterThan(0);
  expect(probe.quads).toBeGreaterThan(0);
  // 光条与音符同半径（= 判定弧 R）；被缩放两次时会跑到 1.2R（差 0.4 以上）。
  expect(Math.abs(probe.meanR - probe.radiusWorld)).toBeLessThan(0.15);
  // 角度也跟着对齐（LaneWidth 不参与 SIF 的角度映射）。
  expect(Math.abs(probe.meanAngleDeg - probe.noteAngleDeg)).toBeLessThan(5);
});
