import { describe, expect, it } from 'vitest';
import {
  apRateFlashAlpha,
  apRateFlashScale,
  comboFlashAlpha,
  comboFlashScale,
  radialFillAmount,
  shouldComboHundredFlash,
  scoreAddTweenX,
  scoreAddTweenAlpha,
  SCORE_ADD_TWEEN,
  SCORE_ADD_LIFE,
  apGageFlashScale,
  apGageFlashAlpha,
  AP_GAGE_FLASH_DURATION,
  apRateBurstScale,
  apRateBurstRootAlpha,
  apRateBurstCoreAlpha,
  apRateBurstParticleScale,
  apRateBurstParticleAlpha,
  apRateBurstTravel,
  AP_RATE_BURST_DURATION,
  AP_RATE_BURST_ACTIVATE_DELAY,
  AP_RATE_BURST_ROOT,
  AP_RATE_BURST_CORE,
} from '../src/hudFxMath';

describe('radialFillAmount', () => {
  it('uses fractional part; integers → 0', () => {
    expect(radialFillAmount(0)).toBe(0);
    expect(radialFillAmount(3)).toBe(0);
    expect(radialFillAmount(3.25)).toBeCloseTo(0.25, 6);
    expect(radialFillAmount(12.0)).toBe(0);
  });
});

describe('shouldComboHundredFlash', () => {
  it('fires on 99→100 / 199→200, not mid-band', () => {
    expect(shouldComboHundredFlash(99, 100)).toBe(true);
    expect(shouldComboHundredFlash(100, 101)).toBe(false);
    expect(shouldComboHundredFlash(199, 200)).toBe(true);
    expect(shouldComboHundredFlash(50, 60)).toBe(false);
    expect(shouldComboHundredFlash(0, 99)).toBe(false);
  });
});

describe('comboFlash curves', () => {
  it('scale 1→1.6@0.7→1.7 over 0.7833s', () => {
    expect(comboFlashScale(0)).toBeCloseTo(1, 5);
    expect(comboFlashScale(0.7833333611488342 * 0.7)).toBeCloseTo(1.6, 4);
    expect(comboFlashScale(0.7833333611488342)).toBeCloseTo(1.7, 5);
  });
  it('alpha: 0→1@1/30, hold to 1/6, poly fade to 0', () => {
    expect(comboFlashAlpha(0)).toBe(0);
    expect(comboFlashAlpha(1 / 30 - 1e-6)).toBe(0);
    expect(comboFlashAlpha(1 / 30)).toBe(1);
    expect(comboFlashAlpha(1 / 6 - 1e-6)).toBe(1);
    expect(comboFlashAlpha(0.4)).toBeGreaterThan(0);
    expect(comboFlashAlpha(0.4)).toBeLessThan(1);
    expect(comboFlashAlpha(0.7833333611488342)).toBe(0);
  });
});

describe('apRateFlash curves', () => {
  it('scale reaches 1.5 by t=7/12', () => {
    expect(apRateFlashScale(0)).toBeCloseTo(1, 5);
    expect(apRateFlashScale(7 / 12)).toBeCloseTo(1.5, 5);
    expect(apRateFlashScale(0.75)).toBeCloseTo(1.5, 5);
  });
  it('alpha 1→0 over 0.75s', () => {
    expect(apRateFlashAlpha(0)).toBeCloseTo(1, 5);
    expect(apRateFlashAlpha(0.375)).toBeGreaterThan(0.4);
    expect(apRateFlashAlpha(0.75)).toBeCloseTo(0, 5);
  });
});

describe('ScoreAddTween', () => {
  it('X/alpha at birth and end match binary', () => {
    expect(scoreAddTweenX(0)).toBe(256);
    expect(scoreAddTweenX(SCORE_ADD_TWEEN)).toBe(304);
    expect(scoreAddTweenX(SCORE_ADD_LIFE)).toBe(304);
    expect(scoreAddTweenAlpha(0)).toBeCloseTo(0.6, 5);
    expect(scoreAddTweenAlpha(SCORE_ADD_TWEEN)).toBeCloseTo(1, 5);
  });
});

describe('ApGageIncreaseAnimation', () => {
  it('scale holds 1 until 0.1s then poly to 1.8 at 0.6s', () => {
    expect(apGageFlashScale(0)).toBe(1);
    expect(apGageFlashScale(0.1)).toBe(1);
    expect(apGageFlashScale(AP_GAGE_FLASH_DURATION)).toBeCloseTo(1.8, 5);
    expect(apGageFlashScale(0.35)).toBeCloseTo(1.4, 5);
  });

  it('alpha flat 0 until 0.1s, then 1→0 by 0.6s', () => {
    expect(apGageFlashAlpha(0)).toBe(0);
    expect(apGageFlashAlpha(0.05)).toBe(0);
    expect(apGageFlashAlpha(0.1)).toBeCloseTo(1, 5);
    expect(apGageFlashAlpha(0.35)).toBeCloseTo(0.5, 5);
    expect(apGageFlashAlpha(AP_GAGE_FLASH_DURATION)).toBe(0);
  });
});

describe('APRateEffect 贴图爆发', () => {
  it('寿命 1s，SetActive 延后 1/60s', () => {
    expect(AP_RATE_BURST_DURATION).toBe(1);
    expect(AP_RATE_BURST_ACTIVATE_DELAY).toBeCloseTo(1 / 60, 9);
  });

  it('底光两层基准尺寸：Root 254×63、Bg_core 400×300', () => {
    expect(AP_RATE_BURST_ROOT).toEqual({ w: 254, h: 63 });
    expect(AP_RATE_BURST_CORE).toEqual({ w: 400, h: 300 });
  });

  it('Root/Bg_core 共用尺寸曲线：0 起步，0.2609 到 0.9385×1.35 后保持', () => {
    expect(apRateBurstScale(0)).toBe(0);
    expect(apRateBurstScale(0.2608909606933594)).toBeCloseTo(0.9384613037109375 * 1.35, 5);
    expect(apRateBurstScale(1)).toBeCloseTo(0.9384613037109375 * 1.35, 5);
    // 单调放大：尺寸不会回缩
    let prev = -1;
    for (let t = 0; t <= AP_RATE_BURST_DURATION; t += 0.02) {
      const v = apRateBurstScale(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('Root alpha 在 0.4298 归零，早于 1s 寿命', () => {
    expect(apRateBurstRootAlpha(0)).toBeCloseTo(1, 5);
    expect(apRateBurstRootAlpha(0.42983138780804153)).toBeCloseTo(0, 5);
    expect(apRateBurstRootAlpha(1)).toBe(0);
  });

  it('Bg_core alpha 整寿命线性淡出到 1s', () => {
    expect(apRateBurstCoreAlpha(0)).toBeCloseTo(1, 5);
    expect(apRateBurstCoreAlpha(0.5)).toBeGreaterThan(0.3);
    expect(apRateBurstCoreAlpha(1)).toBe(0);
  });

  it('火花粒子尺寸从 0 长出、alpha 单调淡出', () => {
    expect(apRateBurstParticleScale(0)).toBe(0);
    expect(apRateBurstParticleScale(1)).toBe(1);
    expect(apRateBurstParticleScale(0.5)).toBeGreaterThan(0);
    expect(apRateBurstParticleAlpha(0)).toBeCloseTo(1, 5);
    expect(apRateBurstParticleAlpha(1)).toBe(0);
  });
});

describe('apRateBurstTravel（LimitVelocityOverLifetime 位移积分）', () => {
  it('dampen=0 退化为匀速 v0·t', () => {
    const [x, y] = apRateBurstTravel(300, 400, 0.5, 100, 0);
    expect(Math.hypot(x, y)).toBeCloseTo(500 * 0.5, 6); // 合速度 500 × 0.5s
  });

  it('t=0 或零速度 ⇒ 不位移', () => {
    expect(apRateBurstTravel(700, 0, 0, 100, 0.3)).toEqual([0, 0]);
    expect(apRateBurstTravel(0, 0, 0.5, 100, 0.3)).toEqual([0, 0]);
  });

  it('有限速时位移远小于按初速直飞', () => {
    // #564 Closs：v0=700 px/s、lim=100、dampen=0.3、寿命 0.65s ⇒ 约 101px（直飞会是 455px）。
    const [x] = apRateBurstTravel(700, 0, 0.65, 100, 0.3);
    const naive = 700 * 0.65;
    expect(x).toBeLessThan(naive * 0.3);
    expect(x).toBeGreaterThan(80);
    expect(x).toBeLessThan(130);
  });

  it('限速只改距离、不改方向', () => {
    const [x, y] = apRateBurstTravel(300, 400, 0.4, 50, 0.3);
    // 方向比例仍为 3:4
    expect(y / x).toBeCloseTo(400 / 300, 6);
    expect(Math.hypot(x, y)).toBeLessThan(500 * 0.4);
  });

  it('位移随限速上限单调增（lim 越大走越远）', () => {
    const a = apRateBurstTravel(700, 0, 0.65, 50, 0.3)[0];
    const b = apRateBurstTravel(700, 0, 0.65, 100, 0.3)[0];
    const c = apRateBurstTravel(700, 0, 0.65, 200, 0.3)[0];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
