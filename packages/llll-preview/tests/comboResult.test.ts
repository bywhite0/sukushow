import { describe, expect, it } from 'vitest';
import {
  AP_PARTICLES,
  BANNERS,
  COMBO_RESULT_CLIP_DURATION,
  activationTime,
  dampedDistance,
  evalHermite,
  nodeStateAt,
  particleAt,
  spawnEmitter,
} from '../src/comboResult';
import { AP_BANNER_CURVES, AP_BANNER_EMITTERS, AP_BANNER_NODES, CLEAR_BANNER_EMITTERS, COMBO_RESULT_BANNERS, COMBO_RESULT_BG, COMBO_RESULT_TEXTURES } from '../src/comboResultClip';

const node = (p: string) => AP_BANNER_NODES.find((n) => n.path === `Root-AllPerfect/${p}`)!;
const em = (p: string) => AP_BANNER_EMITTERS.find((e) => e.path.endsWith(`/${p}`))!;

describe('曲终横幅 AllPerfect', () => {
  it('clip 4 s，黑罩 alpha 0.698', () => {
    expect(COMBO_RESULT_CLIP_DURATION).toBe(4);
    expect(COMBO_RESULT_BG[3]).toBeCloseTo(0.698, 3);
  });

  it('上下两条线从 ±580 滑入到 ∓40，0.55 s 后淡入', () => {
    expect(nodeStateAt(node('Line-Up'), 0).x).toBeCloseTo(580, 3);
    expect(nodeStateAt(node('Line-Up'), 1).x).toBeCloseTo(-40, 3);
    expect(nodeStateAt(node('Line-Btm'), 1).x).toBeCloseTo(40, 3);
    expect(nodeStateAt(node('Line-Up'), 0.5).a).toBeCloseTo(0, 4);
    expect(nodeStateAt(node('Line-Up'), 1).a).toBeCloseTo(1, 3);
  });

  it('标题 0.3–0.5 s 淡入；Image 从 0.5 倍放大到 2.5 倍', () => {
    expect(nodeStateAt(node('AllPerfect_Title'), 0.29).a).toBeCloseTo(0, 4);
    expect(nodeStateAt(node('AllPerfect_Title'), 0.5).a).toBeCloseTo(1, 3);
    expect(nodeStateAt(node('Image'), 0).sx).toBeCloseTo(0.5, 4);
    expect(nodeStateAt(node('Image'), 2).sx).toBeCloseTo(2.5, 4);
  });

  it('rgb 曲线都是常量（着色可以预先算好）', () => {
    for (const c of AP_BANNER_CURVES) if (['r', 'g', 'b'].includes(c.prop)) expect(c.keys).toHaveLength(1);
  });

  it('发射器开播时刻跟随 active 曲线：Effect01 及子系统 1/60 s，标题光 0.2167 s', () => {
    expect(activationTime(em('Ring').path)).toBeCloseTo(1 / 60, 5);
    expect(activationTime(em('sc2_ingeame_end_AllPerfectTitleEffect').path)).toBeCloseTo(0.21667, 4);
  });

  it('burst 循环：Effect01 3×6、Shine 3×12、BurstParticle 2×6，其余单次', () => {
    const count = (p: string) => spawnEmitter(em(p), 0, 0).length;
    expect(count('sc2_ingeame_end_AllPerfect_Effect01')).toBe(18);
    expect(count('ShineParticle')).toBe(36);
    expect(count('Particle')).toBe(24);
    expect(count('BurstParticle01')).toBe(12);
    expect(count('Ring')).toBe(1);
    const shine = spawnEmitter(em('ShineParticle'), 0, 0);
    const spawns = [...new Set(shine.map((p) => p.spawn.toFixed(4)))];
    expect(spawns).toHaveLength(3);
    expect(+spawns[1]! - +spawns[0]!).toBeCloseTo(0.08, 5);
  });

  it('限速上限逐粒子在 [0.7, 1.0] 内随机；Circle 厚度 0 的在边上出生', () => {
    const ps = spawnEmitter(em('ShineParticle'), 0, 0);
    for (const p of ps) {
      expect(p.limit).toBeGreaterThanOrEqual(0.7 - 1e-6);
      expect(p.limit).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.hypot(p.ox, p.oy)).toBeCloseTo(0.34, 6);
    }
    expect(new Set(ps.map((p) => p.limit.toFixed(3))).size).toBeGreaterThan(5);
  });

  it('限速位移：κ = −ln(1−dampen)×50，远期速度趋于上限', () => {
    const d1 = dampedDistance(10, 1, 0.03, 5), d2 = dampedDistance(10, 1, 0.03, 6);
    expect(d2 - d1).toBeCloseTo(1, 2);
    expect(dampedDistance(0.5, 1, 0.2, 2)).toBeCloseTo(1, 6);
  });

  it('尺寸曲线按 Hermite 求值（端点精确，段内非线性）', () => {
    const k = em('Glow').sizeKeys!;
    expect(evalHermite(k, 0)).toBe(0);
    expect(evalHermite(k, 1)).toBe(1);
    const mid = evalHermite(k, 0.18);
    expect(Math.abs(mid - 0.9709528 * 0.18 / 0.3607)).toBeGreaterThan(0.01);
  });

  it('Glow 600 px 按 maxParticleSize 0.5 钳到 540 px，并画在黑罩之下', () => {
    const g = em('Glow');
    expect(g.underCanvas).toBe(true);
    expect(AP_BANNER_EMITTERS.filter((e) => e.underCanvas)).toHaveLength(1);
    const i = AP_BANNER_EMITTERS.indexOf(g);
    const p = AP_PARTICLES.find((q) => q.emitter === i)!;
    const f = particleAt(p, g, p.spawn + p.life * 0.99)!;
    expect(f.w).toBeCloseTo(540, 3);
  });

  it('粒子是时间的纯函数（拖动可复现）', () => {
    const e = em('StarParticle');
    const i = AP_BANNER_EMITTERS.indexOf(e);
    const p = AP_PARTICLES.find((q) => q.emitter === i)!;
    expect(particleAt(p, e, p.spawn + 0.3)).toEqual(particleAt(p, e, p.spawn + 0.3));
    expect(particleAt(p, e, p.spawn - 0.01)).toBeNull();
    expect(particleAt(p, e, p.spawn + p.life)).toBeNull();
  });
});

describe('曲终横幅四档（FC / Clear / Finish）', () => {
  it('按 GetResultIndex 排列，root 与 clip 一一对应，各 4 s', () => {
    expect(COMBO_RESULT_BANNERS.map((b) => b.root)).toEqual(['Root-AllPerfect', 'Root-FullCombo', 'Root-Clear', 'Root-Finish']);
    expect(COMBO_RESULT_BANNERS.map((b) => b.clip)).toEqual(['sc2_ingame_end_AllPerfect', 'sc2_ingame_end_FullCombo', 'sc2_ingame_end_Clear', 'sc2_ingame_end_Finish']);
    for (const b of COMBO_RESULT_BANNERS) for (const n of b.nodes) expect(n.path.startsWith(b.root)).toBe(true);
  });

  it('每档的 rgb 曲线都是常量（预着色成立），贴图都在清单里', () => {
    for (const b of COMBO_RESULT_BANNERS) {
      for (const c of b.curves) if (['r', 'g', 'b'].includes(c.prop)) expect(c.keys).toHaveLength(1);
      for (const n of b.nodes) if (n.sprite) expect(COMBO_RESULT_TEXTURES).toContain(n.sprite);
      for (const e of b.emitters) expect(COMBO_RESULT_TEXTURES).toContain(e.tex);
    }
  });

  it('每档都有粒子，且都在 4 s 片段内出生', () => {
    for (const b of BANNERS) {
      expect(b.particles.length).toBeGreaterThan(0);
      for (const p of b.particles) if (Number.isFinite(p.spawn)) expect(p.spawn).toBeLessThan(4);
    }
  });

  it('只导出原包里真正绘制的发射器（GameObject 链 active 且 Renderer 启用）', () => {
    const names = (b: (typeof BANNERS)[number]) => b.clip.emitters.map((e) => e.path.split('/').pop()).sort();
    expect(BANNERS[0]!.clip.emitters).toHaveLength(12);
    expect(BANNERS[1]!.clip.emitters).toHaveLength(11);
    expect(names(BANNERS[2]!)).toEqual(['BurstParticle01', 'flare02', 'sc2_ingeame_end_ClearTitleEffect']);
    expect(names(BANNERS[3]!)).toEqual(['flare02', 'sc2_ingeame_end_FinishiTitleEffect']);
  });

  it('Clear 的 BurstParticle 是 Box 发射：5.4×2.5 矩形内均匀出生，平面内不移动', () => {
    const boxes = CLEAR_BANNER_EMITTERS.filter((e) => e.shape === 'box');
    expect(boxes.map((e) => e.path.split('/').pop())).toEqual(['BurstParticle01']);
    for (const e of boxes) {
      expect(e.box).toEqual([5.400000095367432, 2.5]);
      const ps = spawnEmitter(e, 0, 0);
      for (const p of ps) {
        expect(Math.abs(p.ox)).toBeLessThanOrEqual(2.7 + 1e-6);
        expect(Math.abs(p.oy)).toBeLessThanOrEqual(1.25 + 1e-6);
        expect(p.dx).toBe(0);
        expect(p.dy).toBe(0);
        const f = particleAt(p, e, p.spawn + p.life * 0.5)!;
        expect(f.x).toBeCloseTo(p.ox * 100, 6);
      }
    }
  });
});
