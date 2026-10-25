import { describe, expect, it } from 'vitest';
import { ResultScreen, type ResultSnapshot } from '../src/resultScreen';
import { RESULT_CLIPS, RESULT_FX, RESULT_NODES } from '../src/resultScreenClip';
import { resultActivationTime, resultParticleAboveUi, resultParticleAt, spawnResultEmitter } from '../src/resultScreenParticles';
import { sampleCurve } from '../src/startAnim';

const title = RESULT_CLIPS.find((c) => c.name === 'sc2_ResultTitleAnimation')!;
const fx = (suffix: string) => RESULT_FX.find((e) => e.path === `ResultTitle/${suffix}`)!;
const flash = fx('SC2_ResultTitleEffect01/FlashCore');
const value = (path: string, prop: string, t: number) => sampleCurve(title.curves.find((c) => c.path === path && c.prop === prop)!.keys, t);

describe('结算标题原包关键帧', () => {
  it('逐字激活按阶梯键，整体弹跳保留原始幅度与时长', () => {
    expect(title.dur).toBe(2.4166667461395264);
    const letters = ['L0', 'i', 'V', 'E0', 'star', 'C', 'L1', 'E1', 'A', 'R'];
    for (const [t, count] of [[0, 0], [0.125, 2], [0.25, 3], [0.5, 6], [1, 10]]) {
      expect(letters.filter((p) => value(p, 'active', t!) > 0.5)).toHaveLength(count!);
    }
    for (const path of ['L0', 'R']) {
      for (const [t, scale] of [[1, 0.8], [1.125, 1.15], [1.1666666269302368, 1.5], [1.375, 1.25], [1.5833333730697632, 1]]) {
        expect(value(path, 'scale.x', t!)).toBeCloseTo(scale!, 6);
        expect(value(path, 'scale.y', t!)).toBeCloseTo(scale!, 6);
      }
    }
    expect(value('R', 'active', 0.7666)).toBe(0);
    expect(value('R', 'active', 0.7666666507720947)).toBe(1);
  });

  it('子发射器继承祖先的精确激活时刻', () => {
    expect(resultActivationTime(title, 'ResultTitle', flash.path, RESULT_NODES)).toBe(1.0666667222976685);
    expect(resultActivationTime(title, 'ResultTitle', fx('SC2_ResultTitleEffect_charge/ChargeCore').path, RESULT_NODES)).toBe(0.1666666716337204);
  });
});

describe('结算粒子模块', () => {
  it('尺寸在相邻键之间按原始切线连续变化', () => {
    const p = spawnResultEmitter(flash, 0)[0]!;
    const at = resultParticleAt(flash, p, p.spawn + p.life * 0.23002798855304718)!;
    // 原始首段中点：(v0+v1)/2 + dt*(out0-in1)/8。
    expect(at.w / p.size).toBeCloseTo(0.542434643525864, 9);
    expect(at.h / p.sizeY).toBeCloseTo(at.w / p.size, 12);
    const near = resultParticleAt(flash, p, p.spawn + p.life * 0.23012798855304718)!;
    expect(near.w).toBeGreaterThan(at.w);
    expect(near.w - at.w).toBeLessThan(1);
  });

  it('charge 的两轮爆发间隔 0.15 秒，Glow 的两轮间隔 0.01 秒', () => {
    for (const [name, interval] of [['SC2_ResultTitleEffect_charge', 0.15000000596046448], ['SC2_ResultTitleEffect01/Glow', 0.009999999776482582]] as const) {
      const e = fx(name);
      const ps = spawnResultEmitter(e, 1);
      expect(ps).toHaveLength(2);
      expect(ps[1]!.spawn - ps[0]!.spawn).toBeCloseTo(interval, 12);
      expect(resultParticleAt(e, ps[1]!, ps[1]!.spawn - 1e-6)).toBeNull();
    }
  });

  it('TwoGradients 在相同寿命相位按出生因子连续混色', () => {
    const p = spawnResultEmitter(flash, 0)[0]!;
    const time = p.spawn + p.life * 0.5;
    const yellow = resultParticleAt(flash, { ...p, gradientMix: 0 }, time)!;
    const pink = resultParticleAt(flash, { ...p, gradientMix: 1 }, time)!;
    const middle = resultParticleAt(flash, { ...p, gradientMix: 0.5 }, time)!;
    expect(yellow.g).toBeCloseTo(0.9991292953491211, 10);
    expect(pink.g).toBeCloseTo(0.6745283007621765, 10);
    expect(middle.g).toBeCloseTo((yellow.g + pink.g) / 2, 10);
    expect(yellow.a).toBeCloseTo(pink.a, 10);
  });

  it('禁用的 RotationModule 不读取遗留角速度，非 3D 尺寸保持正方形', () => {
    expect(flash.rot).toEqual([0, 0]);
    const e = fx('SC2_ResultTitleEffect01/ClossParticle');
    for (const p of spawnResultEmitter(e, 0)) expect(p.sizeY).toBe(p.size);
    const core = RESULT_FX.find((e) => e.path.endsWith('sc2_AllPerfectCombo_Effect/CoreFlash'))!;
    expect(spawnResultEmitter(core, 0).some((p) => p.rotation > 0)).toBe(true);
  });

  it('球壳保留半径、形状缩放与三维方向，锥形只向前发射', () => {
    const e = fx('SC2_ResultTitleEffect_charge/ChargeParticle');
    for (const p of spawnResultEmitter(e, 0)) {
      expect(Math.hypot(...p.position)).toBeCloseTo(750.5999755859375, 8);
      expect(Math.hypot(...p.direction)).toBeCloseTo(1, 12);
    }
    const cone = fx('SC2_ResultTitleEffect01/Particle');
    for (const p of spawnResultEmitter(cone, 0)) expect(p.direction[2]).toBeCloseTo(Math.cos(Math.PI / 18), 12);
  });

  it('拉伸 billboard 沿投影速度定向并使用 lengthScale', () => {
    const e = fx('SC2_ResultTitleEffect01/Line');
    const p = spawnResultEmitter(e, 0)[0]!;
    const f = resultParticleAt(e, { ...p, direction: [1, 0, 0] }, p.spawn + p.life * 0.5)!;
    expect(f.rotation).toBe(-Math.PI / 2);
    expect(f.h / f.w).toBeCloseTo(p.sizeY / p.size * 2, 10);
  });

  it('主 UI 下方只有两个标题柔光，其余标题粒子位于主 UI 上方', () => {
    expect(RESULT_FX.filter((e) => e.path.startsWith('ResultTitle/') && !resultParticleAboveUi(e)).map((e) => e.path)).toEqual([
      'ResultTitle/SC2_ResultTitleEffect01',
      'ResultTitle/SC2_ResultTitleEffect_charge/ChargeCoreGlow',
    ]);
  });
});

const snapshot: ResultSnapshot = { score: 1, technicalRaw: 1, userCombo: 1, judgements: [0, 0, 0, 0, 0, 1], conditions: [0, 0, 0], comboFlags: 3, remainMental: 1, scoreRank: 4, musicTitle: 'test', difficulty: 'MASTER', difficultyId: 4, difficultyLevel: 30, totalNoteCount: 1, enableFastSlow: false };

describe('粒子与播放时间轴', () => {
  it('相同标题时刻的大步推进与逐帧推进得到相同粒子状态', () => {
    const screen = () => { const s = new ResultScreen(); s.open(snapshot); return s; };
    const large = screen(), small = screen();
    large.tick(1.2);
    for (let i = 0; i < 72; i++) small.tick(1 / 60);
    const particles = (s: ResultScreen) => (s as unknown as { playbacks: { emitters: { e: typeof flash; parts: ReturnType<typeof spawnResultEmitter> }[] }[] }).playbacks[0]!.emitters;
    expect(particles(large)).toEqual(particles(small));
    large.tick(1.3);
    large.skip();
    expect((large as unknown as { playbacks: { emitters: unknown[] }[] }).playbacks.slice(1).every((p) => p.emitters.length === 0)).toBe(true);
  });
});
