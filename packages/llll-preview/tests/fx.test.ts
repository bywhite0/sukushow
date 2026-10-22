import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { parseChart } from '@sukushow/chart/chart';
import { flatParticlePoint, HitFx } from '../src/fx';
import type { FxFile } from '../src/rgAssets';
import { pushBillboard } from '../src/slice';

const resource = JSON.parse(readFileSync(new URL('../../../apps/web/public/rg/fx/fx.json', import.meta.url), 'utf8')) as FxFile;
/** 只保留指定 prefab 的 HitFx：贴图用空 Texture 占位，测试只统计顶点数。 */
function createFx(ids: string[]) {
  const file = structuredClone(resource);
  file.prefabs = file.prefabs.filter(prefab => ids.includes(prefab.id));
  file.fever = [];
  const texture = new THREE.Texture();
  return { fx: new HitFx(file, Object.fromEntries(file.mats.map(mat => [mat.tex, texture]))), texture };
}
function vertexCount(fx: HitFx) {
  fx.draw();
  return fx.group.children.reduce((n, child) => n + (child as THREE.Mesh).geometry.drawRange.count, 0);
}
/** Flags 位域：l/r 头端点、l2/r2 尾端点（与 packages/chart 测试同一组装式）。 */
const flags = (type: number, l: number, r: number) => (type & 15) | ((r & 63) << 4) | ((r & 63) << 10) | ((l & 63) << 16) | ((l & 63) << 22);
const singleNote = parseChart({
  Notes: [{ Uid: 1, just: '1', holds: [], Flags: flags(0, 29, 30) }],
  Bpms: [{ Time: 0, Bpm: 120 }],
});

describe('fx billboard spin', () => {
  it('rotates corners in the billboard plane', () => {
    const pos = new Float32Array(18);
    const uv = new Float32Array(12);
    const col = new Float32Array(24);
    const n = pushBillboard(pos, uv, col, 0, 6, 0, 0, 0, 2, 2, [1, 1, 1, 1], 1, 1, Math.PI / 2);
    expect(n).toBe(6);
    // 90° spin: former right edge maps toward billboard "up" (no pure +X extent).
    const xs = [pos[0], pos[3], pos[6], pos[9]];
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(1.01);
  });
});

/** 2D 俯视下 hitFX / fever 粒子共用同一条绘制路径（HitFx.setFlat），位移也要一起重映射。 */
describe('2D 粒子位移映射', () => {
  // 判定线上的打击粒子：出生在世界 y = Y、unity z = BORDER。
  const spawn = { y0: 4.5, z0: -4.632 };

  it('3D 原样返回', () => {
    const p = { x: 1, y: 9.9, z: 2 };
    expect(flatParticlePoint(spawn, false, p)).toBe(p);
  });

  it('hitFX：竖直位移折到轨道面远端（屏幕向上），丢弃朝相机的深度位移', () => {
    // 3D 打击粒子实测 0.08 s 内 +5.5（沿 +Y），深度位移几乎为 0。
    const q = flatParticlePoint(spawn, true, { x: 1.2, y: 4.5 + 5.5, z: -4.632 - 0.3 });
    expect(q.x).toBe(1.2);
    // 不再朝相机飞：否则俯视下被透视放大、向屏幕外甩
    expect(q.y).toBe(4.5);
    // unity +Z = 屏幕向上 = 与音符下落反向
    expect(q.z).toBeCloseTo(spawn.z0 + 5.5, 9);
    expect(q.z).toBeGreaterThan(spawn.z0);
  });

  it('fever：侧向入场位移同样折到轨道面上', () => {
    // fever 粒子从两侧入场（birthOff 带 y/z 分量），俯视下 y 分量必须变成屏幕位移。
    const q = flatParticlePoint(spawn, true, { x: -4.5, y: 4.5 + 1.2, z: -4.632 });
    expect(q.x).toBe(-4.5);
    expect(q.y).toBe(4.5);
    expect(q.z).toBeCloseTo(spawn.z0 + 1.2, 9);
  });

  it('fever：出生高度不是 Y 的 abs 粒子也被压到音符平面', () => {
    // feverCoreLeft/Right 是 abs 发射，作者给的出生 y 不是 4.5；俯视下留在原高度会
    // 被透视缩放到别的比例，看起来「浮在轨道外」。
    const q = flatParticlePoint({ y0: 0, z0: -4.632 }, true, { x: 6.2, y: 3.1, z: -4.632 });
    expect(q.y).toBe(4.5);
    // 竖直位移仍换算成屏幕位移：3.1 − 0 = +3.1 → unity +z
    expect(q.z).toBeCloseTo(-4.632 + 3.1, 9);
  });

  it('出生瞬间位置不变（粒子仍从判定点长出）', () => {
    expect(flatParticlePoint(spawn, true, { x: 0, y: 4.5, z: -4.632 })).toEqual({ x: 0, y: 4.5, z: -4.632 });
  });

  it('音符下落方向（−z）在 2D 下不再带出粒子', () => {
    // 3D 里朝玩家（unity −z）的位移在 2D 被丢掉，粒子不会顺着音符一起往下漂
    const q = flatParticlePoint(spawn, true, { x: 0, y: 4.5, z: -4.632 - 2 });
    expect(q.z).toBeCloseTo(spawn.z0, 9);
  });
});

/** 手动判定：`sync(..., autoSpawn=false)` 不按音符时刻生成特效，改由 `hit()` 驱动。 */
describe('fx.sync 的 autoSpawn', () => {
  const advance = (fx: HitFx, autoSpawn: boolean) => {
    fx.sync(singleNote, 0, false);
    for (const time of [0.4, 0.8, 1.05]) fx.sync(singleNote, time, false, true, autoSpawn);
  };

  it('auto（默认）：跨过音符时刻仍自动生成打击特效', () => {
    const { fx, texture } = createFx(['tap']);
    advance(fx, true);
    expect(vertexCount(fx)).toBeGreaterThan(0);
    fx.dispose(); texture.dispose();
  });

  it('manual：不自动生成打击特效', () => {
    const { fx, texture } = createFx(['tap']);
    advance(fx, false);
    expect(vertexCount(fx)).toBe(0);
    fx.dispose(); texture.dispose();
  });
});

describe('fx.stopLoop', () => {
  it('只结束指定 UID 的 Hold 循环特效', () => {
    const { fx, texture } = createFx(['holdLoop']);
    fx.spawn('holdLoop', 0, 4, true, 7);
    expect(vertexCount(fx)).toBeGreaterThan(0);
    fx.stopLoop(8);
    expect(vertexCount(fx)).toBeGreaterThan(0);
    fx.stopLoop(7);
    expect(vertexCount(fx)).toBe(0);
    fx.dispose(); texture.dispose();
  });
});

describe('fx.ensureLoop', () => {
  it('不在场时生成；已在场不重启（同一个实例）；stopLoop 后可再次生成', () => {
    const { fx, texture } = createFx(['holdLoop']);
    expect(fx.hasLoop(7)).toBe(false);
    fx.ensureLoop(7, 0, 4);
    expect(fx.hasLoop(7)).toBe(true);
    const live = (fx as unknown as { live: unknown[] }).live;
    const first = live.find((l) => (l as { uid: number }).uid === 7);
    fx.ensureLoop(7, 1, 4);
    const after = (fx as unknown as { live: unknown[] }).live.filter((l) => (l as { uid: number }).uid === 7);
    expect(after).toEqual([first]);
    fx.stopLoop(7);
    expect(fx.hasLoop(7)).toBe(false);
    fx.ensureLoop(7, 0, 4);
    expect(fx.hasLoop(7)).toBe(true);
    fx.dispose(); texture.dispose();
  });

  it('跳转：自动模式按时间补 Hold 循环特效，手动模式不补（交给判定状态）', () => {
    const hold = parseChart({ Notes: [{ Uid: 3, just: '1', holds: ['3'], Flags: flags(1, 29, 30) }], Bpms: [{ Time: 0, Bpm: 120 }] });
    for (const [autoSpawn, expected] of [[true, true], [false, false]] as const) {
      const { fx, texture } = createFx(['holdLoop']);
      fx.sync(hold, 0, false);
      fx.sync(hold, 2, false, false, autoSpawn);
      expect(fx.hasLoop(3)).toBe(expected);
      fx.dispose(); texture.dispose();
    }
  });
});
