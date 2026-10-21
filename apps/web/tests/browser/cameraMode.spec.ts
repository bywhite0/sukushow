import { expect, test } from '@playwright/test';
import { openChartFixture } from './chartFixture';

test('LLLL 舞台通过同一 3D 渲染器切换相机角度', async ({ page }) => {
  await page.goto('/?view=llll');
  const stage = page.locator('#stage');
  const glCanvas = page.locator('#chart-canvas');
  const stageCanvas = page.locator('#stage-canvas');

  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  const threeDAngle = Number(await glCanvas.getAttribute('data-camera-angle'));
  await expect(stageCanvas).toHaveAttribute('aria-hidden', 'false');

  // The visible stage is a 2D compositor target. Skip the idle intro before
  // checking that the existing LLLL edge line made it through the WebGL copy.
  await page.locator('#play').click();
  await expect.poll(() => stageCanvas.getAttribute('data-intro'), { timeout: 8_000 }).toBe('');
  const visibleStagePixels = () => stageCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = Math.floor(i / 4 / canvas.width);
      if (y > canvas.height * 0.25 && data[i] > 220 && data[i + 1] < 100 && data[i + 2] > 120) count++;
    }
    return count;
  });
  await expect.poll(visibleStagePixels, { timeout: 2_000 }).toBeGreaterThan(100);

  await stage.locator('button[data-stage-mode="2d"]').click();
  await expect(stage).toHaveAttribute('data-stage-mode', '2d');
  await expect(stage.locator('button[data-stage-mode="2d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '2d');
  const twoDAngle = Number(await glCanvas.getAttribute('data-camera-angle'));
  expect(twoDAngle).not.toBe(threeDAngle);
  expect(twoDAngle).toBeCloseTo(-Math.PI / 2, 3);
  await expect(stageCanvas).toHaveAttribute('aria-hidden', 'false');

  await stage.locator('button[data-stage-mode="3d"]').click();
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
});

test('2D 俯视取景：判定点对齐判定线，判定线两端伸出轨道，音符平铺', async ({ page }) => {
  await openChartFixture(page);
  await page.evaluate(async () => {
    await (window as any).__LPW__.renderer.whenReady();
    const timeline = document.querySelector<HTMLInputElement>('#timeline')!;
    timeline.value = '5';
    timeline.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const stage = page.locator('#stage');
  await stage.locator('button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');
  // 等一帧真正带音符的 2D 渲染（音符在 t=5 附近才可见）。
  await expect.poll(() => page.evaluate(() => {
    const r = (window as any).__LPW__.renderer;
    let vertices = 0;
    for (const batch of r.sheets.values()) vertices += batch.n;
    return vertices;
  }), { timeout: 5_000 }).toBeGreaterThan(0);
  // 顶点数在 3D 帧里也 > 0：再等两帧，确保读到的是切换后的 2D 顶点。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  const probe = await page.evaluate(() => {
    const r = (window as any).__LPW__.renderer;
    const canvas = r.domElement as HTMLCanvasElement;
    const ys = new Set<number>();
    for (const batch of r.sheets.values()) {
      for (let i = 0; i < batch.n; i++) ys.add(Math.round(batch.pos[i * 3 + 1] * 1e4) / 1e4);
    }
    return {
      layout: r.debugFlatLayout(),
      state: r.getCameraState(),
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      noteWorldY: [...ys],
    };
  });

  // 垂直俯视 + 明显拉远（3D 机位 y = 9）。
  expect(probe.state.mode).toBe('2d');
  expect(probe.state.pitch).toBeCloseTo(-Math.PI / 2, 6);
  expect(probe.state.position.x).toBeCloseTo(0, 6);
  expect(probe.state.position.y).toBeGreaterThan(10);

  const { layout } = probe;
  expect(layout).not.toBeNull();
  // 音符判定点（BORDER 处投影）与判定线贴图中心重合：误差 < 1px。
  expect(Math.abs(layout!.judgePointY - layout!.judgeY)).toBeLessThan(1);
  expect(Math.abs(layout!.lineCenterY - layout!.judgeY)).toBeLessThan(1);
  // 判定线两端伸出轨道：比轨道（平面 / 边线取较宽者）宽 12%，
  // 轨道默认占舞台 60%（3D 判定线是 84%）。
  expect(layout!.trackPx).toBeGreaterThanOrEqual(layout!.planePx);
  expect(layout!.linePx).toBeCloseTo(layout!.trackPx * 1.12, 0);
  expect(layout!.linePx).toBeGreaterThan(layout!.planePx + 1);
  expect(layout!.planePx / probe.w).toBeGreaterThan(0.5);
  expect(layout!.planePx / probe.w).toBeLessThan(0.65);
  // 轨道平面铺满到画布底边（窄画布靠平移补足）。
  expect(layout!.planeNearZ).toBeGreaterThanOrEqual(layout!.bottomZ - 1e-6);

  // 2D 下音符四角在同一高度（贴图平铺在轨道面上），3D 下是朝向相机的斜置 billboard。
  expect(probe.noteWorldY.length).toBeGreaterThan(0);
  expect(probe.noteWorldY.every(y => Math.abs(y - 4.5) < 1e-6)).toBe(true);

  await stage.locator('button[data-stage-mode="3d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '3d');
  const tilted = await page.evaluate(async () => {
    // 等一帧 3D 重绘，否则读到的是切换前那一帧的顶点。
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = (window as any).__LPW__.renderer;
    const ys = new Set<number>();
    for (const batch of r.sheets.values()) {
      for (let i = 0; i < batch.n; i++) ys.add(Math.round(batch.pos[i * 3 + 1] * 1e4) / 1e4);
    }
    return { ys: [...ys], cameraY: r.getCameraState().position.y };
  });
  expect(tilted.cameraY).toBeCloseTo(9, 6);
  expect(tilted.ys.some(y => Math.abs(y - 4.5) > 1e-3)).toBe(true);
});

test('2D 轨道宽度是预览可配置项（等价于 2D 相机距离），并写进持久化设置', async ({ page }) => {
  await openChartFixture(page);
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  await page.locator('#stage button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');

  const setTrackWidth = (value: number) => page.evaluate((v) => {
    const input = document.querySelector<HTMLInputElement>('#opt-flat-track')!;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const readLayout = () => page.evaluate(() => {
    const layout = (window as any).__LPW__.renderer.debugFlatLayout();
    return {
      planePx: layout.planePx, linePx: layout.linePx, trackPx: layout.trackPx, scale: layout.scale,
      trackWidthOpt: layout.trackWidthOpt, judgePointY: layout.judgePointY, judgeY: layout.judgeY,
      output: document.querySelector('#opt-flat-track-value')!.textContent,
    };
  });

  // 默认 60%：轨道宽约 60% 舞台，判定线比轨道宽 12%。
  const base = await readLayout();
  expect(base.trackWidthOpt).toBe(60);
  expect(base.output).toBe('60');
  expect(base.linePx).toBeCloseTo(base.trackPx * 1.12, 0);

  // 80%：轨道与判定线同比放大 4/3，判定点仍压在判定线中心。
  await setTrackWidth(80);
  await expect.poll(async () => (await readLayout()).trackWidthOpt).toBe(80);
  const wide = await readLayout();
  expect(wide.output).toBe('80');
  // 轨道宽度（边线跨度 = 平面投影宽度）严格按百分比缩放；`scale` 因为要扣掉平面高度差
  // 带来的透视修正，略非线性，所以按 trackPx 断言。
  expect(wide.trackPx / base.trackPx).toBeCloseTo(80 / 60, 6);
  expect(wide.planePx / base.planePx).toBeCloseTo(80 / 60, 1);
  expect(wide.linePx / base.linePx).toBeCloseTo(80 / 60, 1);
  expect(Math.abs(wide.judgePointY - wide.judgeY)).toBeLessThan(1);

  // 40%：明显变窄。
  await setTrackWidth(40);
  await expect.poll(async () => (await readLayout()).trackWidthOpt).toBe(40);
  const narrow = await readLayout();
  expect(narrow.trackPx / base.trackPx).toBeCloseTo(40 / 60, 6);
  expect(narrow.planePx).toBeLessThan(base.planePx);

  // 落到 localStorage 的预览设置里，刷新后仍是 40%。
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('llll-preview-web:settings:v1') || '{}'));
  expect(stored.flatTrackWidth).toBe(40);
  await page.reload();
  await expect(page.locator('#opt-flat-track')).toHaveValue('40');
});

test('2D 判定线位置可配置：判定线与判定线贴图一起上下移动，轨道铺满画布底边', async ({ page }) => {
  await openChartFixture(page);
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  await page.locator('#stage button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');

  const probe = (value: number) => page.evaluate(async (v) => {
    const input = document.querySelector<HTMLInputElement>('#opt-flat-judge')!;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = (window as any).__LPW__.renderer;
    const canvas = r.domElement as HTMLCanvasElement;
    const layout = r.debugFlatLayout();
    return {
      layout,
      camZ: r.getCameraState().position.z,
      // 轨道平面的世界半宽（几何 ±5 × mesh.scale.x）：应当与两侧边线的 x 重合
      planeHalfWorld: 5 * r.planeMesh.scale.x,
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      output: document.querySelector('#opt-flat-judge-value')!.textContent,
    };
  }, value);

  const read = async (v: number) => {
    await probe(v);
    await expect.poll(async () => (await page.evaluate(() => (window as any).__LPW__.renderer.debugFlatLayout()?.judgeLineOpt))).toBe(v);
    return probe(v);
  };

  const base = await read(73);
  expect(base.output).toBe('73');
  expect(base.layout.judgeY).toBeCloseTo(base.h * 0.73, 3);
  // 判定点 / 判定线贴图中心都压在 judgeY 上
  expect(Math.abs(base.layout.judgePointY - base.layout.judgeY)).toBeLessThan(1);
  expect(Math.abs(base.layout.lineCenterY - base.layout.judgeY)).toBeLessThan(1);
  // 轨道边线压在轨道平面边缘、且音符横向撑满轨道：三者同宽。
  expect(base.layout.planePx).toBeCloseTo(base.layout.railPx, 0);
  expect(base.layout.railPx).toBeCloseTo(base.layout.trackPx, 0);
  // 平面在音符面下方 0.54、投影比例更小，所以横向按 planeScaleX 缩放，投影边缘才压在边线上；
  // 边线本身 = 可玩轨道半宽（60 个 lane 的跨度），音符外沿就落在边线上。
  expect(base.layout.railX).toBeCloseTo(4.5, 6);
  expect(base.planeHalfWorld).toBeGreaterThan(base.layout.railX);
  expect(base.planeHalfWorld).toBeLessThan(base.layout.railX * 1.15);
  // 平面底边在画布外：看不到轨道区域的下界
  expect(base.layout.planeBottomY).toBeGreaterThanOrEqual(base.h);
  // 边线近端收在画布底边
  expect(base.h / 2 + (base.layout.bottomZ - base.camZ) * base.layout.scale).toBeCloseTo(base.h, 3);

  // 上移（60%）与下移（85%）：判定线、贴图中心、下落窗口一起跟随
  const up = await read(60);
  const down = await read(85);
  expect(up.layout.judgeY).toBeCloseTo(up.h * 0.6, 3);
  expect(down.layout.judgeY).toBeCloseTo(down.h * 0.85, 3);
  expect(down.layout.judgeY).toBeGreaterThan(up.layout.judgeY);
  for (const p of [up, down]) {
    expect(Math.abs(p.layout.lineCenterY - p.layout.judgeY)).toBeLessThan(1);
    expect(Math.abs(p.layout.judgePointY - p.layout.judgeY)).toBeLessThan(1);
    expect(p.layout.field).toBeCloseTo(p.layout.judgeY / p.layout.scale, 6);
    // 判定线移动时轨道宽度、判定线贴图宽度不变（只有位置变）
    expect(p.layout.linePx).toBeCloseTo(base.layout.linePx, 0);
    expect(p.layout.railPx).toBeCloseTo(base.layout.railPx, 0);
    // 平面始终盖住画布底边
    expect(p.layout.planeBottomY).toBeGreaterThanOrEqual(p.h);
    expect(p.layout.planePx).toBeCloseTo(p.layout.railPx, 0);
  }
  // 往下移 ⇒ 判定线上方的下落窗口变长
  expect(down.layout.field).toBeGreaterThan(up.layout.field);

  // 持久化
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('llll-preview-web:settings:v1') || '{}'));
  expect(stored.flatJudgeLine).toBe(85);
  await page.reload();
  await expect(page.locator('#opt-flat-judge')).toHaveValue('85');
  // 刷新后 2D 取景直接用存下的判定线位置
  await page.locator('#stage button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');
  const restored = await page.evaluate(() => {
    const r = (window as any).__LPW__.renderer;
    const layout = r.debugFlatLayout();
    return { judgeY: layout.judgeY, judgeLineOpt: layout.judgeLineOpt, h: (r.domElement as HTMLCanvasElement).clientHeight };
  });
  expect(restored.judgeLineOpt).toBe(85);
  expect(restored.judgeY).toBeCloseTo(restored.h * 0.85, 3);
});

test('2D Fever：LineMove 长条贴在轨道边线上，向轨道外扩散', async ({ page }) => {
  await page.goto('/?view=llll');
  await page.waitForFunction(() => Boolean((window as any).__LPW__?.renderer), null, { timeout: 90_000 });
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  await page.locator('#stage button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');

  // 直接驱动渲染器：Fever 从 40s 起，取 0.8s 周期内的两个时刻。
  const readQuads = (time: number) => page.evaluate(async (t) => {
    const { parseChart } = await import('/@fs/D:/Repos/sukushow/packages/chart/src/chart.ts');
    const renderer = (window as any).__LPW__.renderer;
    renderer.setCameraMode('2d');
    renderer.setHitEffectMode('off');
    renderer.setPlaying(true);
    renderer.setFeverState(true, 40);
    const chart = parseChart({ Notes: [{ Uid: 2, just: '40', Flags: 80, holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    renderer.render(chart, t, 5, false, false);
    const batch = renderer.worldLaneEdges;
    const quads: any[] = [];
    for (let q = 0; q < batch.count / 6; q++) {
      const xs: number[] = [], zs: number[] = [];
      for (let v = 0; v < 6; v++) {
        const i = (q * 6 + v) * 3;
        xs.push(batch.positions[i]); zs.push(batch.positions[i + 2]);
      }
      quads.push({
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        width: Math.max(...xs) - Math.min(...xs),
        zSpan: Math.max(...zs) - Math.min(...zs),
      });
    }
    return { quads, railX: renderer.debugFlatLayout().railX };
  }, time);

  // 起点取 Fever 刚起的一瞬：此时 LineMask 揭示窗口还很小，长条被裁成很窄的一段。
  const startProbe = await readQuads(40.01);
  const midProbe = await readQuads(40.4);
  const start = startProbe.quads, mid = midProbe.quads;
  // 边线宽 0.025、`LineBase` 彩虹光带宽 0.13，`LineMove` 长条宽 0.11 ⇒ 按宽度挑出 LineMove。
  const moves = (quads: any[]) => quads.filter(q => Math.abs(q.width - 0.11) < 0.01);
  expect(moves(start)).toHaveLength(2);
  expect(moves(mid)).toHaveLength(2);
  const [moveLeftStart, moveRightStart] = moves(start);
  const [moveLeftMid, moveRightMid] = moves(mid);
  const rails = start.filter(q => Math.abs(q.width - 0.025) < 1e-6);
  expect(rails).toHaveLength(2);

  // 长轴沿轨道边（z）：和边线同向 ⇒ 不是横跨轨道的斜带；宽度取原包 0.11。
  // 长度被 `LineMask` 裁到已揭示窗口内（3D 里由 stencil 遮罩做同一件事），所以不再是 120。
  for (const bar of [moveLeftStart, moveRightStart, moveLeftMid, moveRightMid]) {
    expect(bar.width).toBeCloseTo(0.11, 3);
    expect(bar.zSpan).toBeLessThan(rails[0].zSpan);
  }
  expect(moveLeftMid.zSpan).toBeGreaterThan(moveLeftStart.zSpan);
  // 横向贴在两条边线上（不是轨道中央），0.4s 后各自向轨道外扩散。
  // 2D 的边线按 railFitX 收窄到轨道平面边缘，所以不是原包的 ±5.03。
  const railLeft = Math.min(...rails.map(q => q.cx)), railRight = Math.max(...rails.map(q => q.cx));
  expect(railLeft).toBeCloseTo(-startProbe.railX, 3);
  expect(railRight).toBeCloseTo(startProbe.railX, 3);
  expect(railRight - railLeft).toBeLessThan(2 * 5.03);
  expect(moveLeftStart.cx).toBeCloseTo(railLeft, 2);
  expect(moveRightStart.cx).toBeCloseTo(railRight, 2);
  expect(moveLeftMid.cx).toBeLessThan(railLeft - 0.08);
  expect(moveRightMid.cx).toBeGreaterThan(railRight + 0.08);
  // 外漂幅度与 3D 一致：0.35 u/s × 0.4s = 0.14。
  expect(moveLeftMid.cx - railLeft).toBeCloseTo(-0.14, 2);
  expect(moveRightMid.cx - railRight).toBeCloseTo(0.14, 2);
});

test('2D Fever：LineCoreMove 彗星沿轨道边入场、彩虹边线由判定线端揭示、LineParticle 火花贴边', async ({ page }) => {
  await page.goto('/?view=llll');
  await page.waitForFunction(() => Boolean((window as any).__LPW__?.renderer), null, { timeout: 90_000 });
  await page.evaluate(async () => { await (window as any).__LPW__.renderer.whenReady(); });
  await page.locator('#stage button[data-stage-mode="2d"]').click();
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-camera-mode', '2d');

  // Fever 从 40s 起；逐帧推进到目标时刻再取样（粒子是逐步发射的）。
  const probe = (time: number) => page.evaluate(async (t) => {
    const { parseChart } = await import('/@fs/D:/Repos/sukushow/packages/chart/src/chart.ts');
    const renderer = (window as any).__LPW__.renderer;
    renderer.setCameraMode('2d');
    renderer.setHitEffectMode('off');
    renderer.setPlaying(true);
    renderer.setFeverState(false, 40);
    renderer.setFeverState(true, 40);
    const chart = parseChart({ Notes: [{ Uid: 2, just: '40', Flags: 80, holds: [] }], Bpms: [{ Time: 0, Bpm: 120 }] });
    for (let s = 40 + 1 / 60; s <= t + 1e-9; s += 1 / 60) renderer.render(chart, s, 5, false, false);
    renderer.render(chart, t, 5, false, false);

    const rail = renderer.fx.flatRail;
    const sparks = (id: string) => {
      const live = renderer.fx.live.find((f: any) => f.id === id);
      if (!live) return [];
      return live.sparks.map((s: any) => renderer.fx.sparkPoint(live, s));
    };
    const batch = renderer.worldLaneEdges;
    const quads: any[] = [];
    for (let q = 0; q < batch.count / 6; q++) {
      const xs: number[] = [], zs: number[] = [];
      for (let v = 0; v < 6; v++) {
        const i = (q * 6 + v) * 3;
        xs.push(batch.positions[i]); zs.push(batch.positions[i + 2]);
      }
      // 颜色按顶点存 4 分量（rgba），取每个四边形的第一个顶点。
      const ci = (q * 6) * 4;
      const col = [batch.colors[ci], batch.colors[ci + 1], batch.colors[ci + 2]];
      // 批里存的是 Three 坐标（z 与 Unity 反号），这里换回 Unity 世界坐标。
      quads.push({
        cx: (Math.min(...xs) + Math.max(...xs)) / 2,
        width: Math.max(...xs) - Math.min(...xs),
        zNear: -Math.max(...zs), zFar: -Math.min(...zs),
        col,
      });
    }
    return { rail, quads, coreLeft: sparks('feverCoreLeft'), coreRight: sparks('feverCoreRight'), lineLeft: sparks('feverLineLeft'), lineRight: sparks('feverLineRight') };
  }, time);

  const early = await probe(40.05);
  const warm = await probe(40.15);
  const mid = await probe(40.3);
  const late = await probe(40.4);
  const rail = early.rail;
  const span = rail.zFar - rail.zNear;
  expect(span).toBeGreaterThan(6);

  // LineCoreMove：x 钉在 ±railX（彗星在边线上，不再横穿轨道），z 从判定线端推向远端。
  for (const side of ['coreLeft', 'coreRight'] as const) {
    const dir = side === 'coreLeft' ? -1 : 1;
    const pts = early[side];
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      // 彗星粒子自身是锥形发射，横向会有 ±0.2 抖动，但整体贴在边线上（不会跑到轨道中央）。
      expect(p.x * dir).toBeGreaterThan(rail.railX - 0.5);
      expect(p.x * dir).toBeLessThan(rail.railX + 0.9);
      expect(p.y).toBeCloseTo(4.5, 6);
      expect(p.z).toBeGreaterThan(rail.zNear - 0.2);
      expect(p.z).toBeLessThan(rail.zFar + 0.2);
    }
    const head = Math.max(...pts.map((p: any) => p.z));
    // 0.05s / 0.4167s ≈ 12% 行程
    expect((head - rail.zNear) / span).toBeLessThan(0.25);
    // 0.4s 时彗星已走到远端
    const headLate = Math.max(...late[side].map((p: any) => p.z));
    expect((headLate - rail.zNear) / span).toBeGreaterThan(0.85);
  }

  // LineParticle 及其 Particle / Closs 发射器：贴边线（±railX 附近），沿轨道边分布，
  // 且只撒在 LineMask 已揭示的那一段里。
  for (const side of ['lineLeft', 'lineRight'] as const) {
    const dir = side === 'lineLeft' ? -1 : 1;
    const pts = late[side];
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) {
      expect(Math.abs(Math.abs(p.x) - rail.railX)).toBeLessThan(0.35);
      expect(p.x * dir).toBeGreaterThan(0);
      expect(p.z).toBeGreaterThan(rail.zNear - 0.3);
      expect(p.z).toBeLessThan(rail.zFar + 0.3);
    }
    const zs = pts.map((p: any) => p.z);
    // 存活火花只来自最近 0.2–0.5s 的发射（揭示在这段时间里从 35% 长到 92%）
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(span * 0.6);
    // 0.15s 时揭示只有 35% ⇒ 火花不会先出现在远端（3D 里被 LineMask 挡住）
    const warmPts = warm[side];
    expect(warmPts.length).toBeGreaterThan(0);
    for (const p of warmPts) {
      expect(p.z).toBeLessThan(rail.zNear + span * 0.45);
    }
  }

  // LineMask 揭示：常色边线整条常驻（宽 0.025 ≈2 px），彩虹 `LineBase` 光带（原包宽 0.13
  // ≈10 px）只画在遮罩已揭示的窗口里 ⇒ 从判定线端「长出来」。`LineMove` 长条同样被裁到该窗口。
  const border = (r: any) => r.quads.filter((q: any) => Math.abs(q.width - 0.025) < 1e-6);
  const bands = (r: any) => r.quads.filter((q: any) => Math.abs(q.width - 0.13) < 0.01);
  const moves = (r: any) => r.quads.filter((q: any) => Math.abs(q.width - 0.11) < 0.01);
  // 边线：左右各一条、铺满整段，且颜色恒为常色（不是彩虹 ⇒ 彩虹只由遮罩揭示）。
  for (const r of [early, mid, late]) {
    const b = border(r);
    expect(b).toHaveLength(2);
    for (const q of b) {
      expect(q.zNear).toBeCloseTo(rail.zNear, 1);
      expect(q.zFar).toBeCloseTo(rail.zFar, 1);
      expect(q.col[0]).toBeCloseTo(1, 2);
      expect(q.col[1]).toBeCloseTo(0.227, 2);
      expect(q.col[2]).toBeCloseTo(0.6, 2);
    }
  }
  // 彩虹光带：从判定线端生长，长度 = 揭示比例 × 可见跨度（0.4333s 走完）。
  for (const r of [early, mid, late]) {
    const b = bands(r);
    expect(b).toHaveLength(2);
    for (const q of b) expect(q.zNear).toBeCloseTo(rail.zNear, 1);
  }
  const leftBand = (r: any) => bands(r).filter((q: any) => q.cx < 0)[0];
  const lenOf = (r: any) => leftBand(r).zFar - leftBand(r).zNear;
  expect(lenOf(early) / span).toBeLessThan(0.25);
  expect(lenOf(mid) / span).toBeGreaterThan(0.5);
  expect(lenOf(late) / span).toBeGreaterThan(0.85);
  // 越长越接近整段（单调增长）
  expect(lenOf(mid)).toBeGreaterThan(lenOf(early));
  expect(lenOf(late)).toBeGreaterThan(lenOf(mid));
  // LineMove 长条也被遮罩裁剪：只出现在已揭示窗口内。
  for (const r of [early, mid, late]) {
    const m = moves(r);
    expect(m.length).toBeGreaterThan(0);
    for (const q of m) {
      expect(q.zNear).toBeGreaterThanOrEqual(rail.zNear - 1e-6);
      expect(q.zFar).toBeLessThanOrEqual(leftBand(r).zFar + 1e-6);
    }
  }
});

