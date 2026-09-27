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
  isPerfectOrAbove,
  apContinueAfterHit,
  apContinueEffectVisible,
  comboEffectUpperAlpha,
  comboEffectLowerAlpha,
  COMBO_EFFECT_UPPER_LIFE,
  COMBO_EFFECT_LOWER_LIFE,
  COMBO_EFFECT_SHEET_W,
  COMBO_EFFECT_DIGIT_RECT,
  comboEffectDigitWidth,
  comboEffectOutlineBox,
  comboEffectUpperOutlineScale,
  comboDigitCount,
  comboEffectRefreshLoop,
  additiveStack,
  alphaBlendStack,
  COMBO_EFFECT_UPPER_ACTIVATE_DELAY,
  comboGlowUpperCurve,
  comboGlowLowerCurve,
  COMBO_GLOW_LIFE,
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
  it('scale：1 到 1/30s，三次段 1.6@0.7s，1.7@47/60s 后保持', () => {
    expect(comboFlashScale(0)).toBe(1);
    expect(comboFlashScale(0.02)).toBe(1);
    expect(comboFlashScale(0.7 - 1e-9)).toBeCloseTo(1.6, 3);
    expect(comboFlashScale(0.7)).toBeCloseTo(1.6, 5);
    expect(comboFlashScale(0.7833333611488342)).toBeCloseTo(1.7, 5);
    expect(comboFlashScale(2)).toBeCloseTo(1.7, 6);
    // 三次段不是线性：第一段中点（1/30 + 1/3 s）≈ 1.2556，低于线性插值的 1.3（先慢后快）
    expect(comboFlashScale(1 / 30 + 1 / 3)).toBeCloseTo(1.2556, 3);
  });
  it('alpha: 0→1@1/30, hold to 1/6, poly fade to 0', () => {
    expect(comboFlashAlpha(0)).toBe(0);
    // 键时刻取 float32 原值：1/30 存成 0.0333333351。
    expect(comboFlashAlpha(0.03333333507180214 - 1e-9)).toBe(0);
    expect(comboFlashAlpha(0.03333333507180214)).toBe(1);
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

describe('AP 継続（isApContinue）', () => {
  it('Perfect(4) 与 PerfectPlus(5) 算「以上」', () => {
    expect(isPerfectOrAbove(4)).toBe(true);
    expect(isPerfectOrAbove(5)).toBe(true);
  });

  it('Great(3) 及以下不算（(type & 0xFE) == 4 的判据）', () => {
    for (const t of [0, 1, 2, 3]) expect(isPerfectOrAbove(t)).toBe(false);
  });

  it('一旦掉出 Perfect 就永久关闭，后续 Perfect 不能恢复', () => {
    let s = true;
    s = apContinueAfterHit(s, 4);
    expect(s).toBe(true);
    s = apContinueAfterHit(s, 3);   // Great
    expect(s).toBe(false);
    s = apContinueAfterHit(s, 5);   // 再 Perfect+ 也不回来
    expect(s).toBe(false);
  });

  it('特效门槛是 combo >= 10（与数字行同门槛）', () => {
    expect(apContinueEffectVisible(9, true)).toBe(false);
    expect(apContinueEffectVisible(10, true)).toBe(true);
    expect(apContinueEffectVisible(120, true)).toBe(true);
  });

  it('isApContinue 为假时永不显示', () => {
    expect(apContinueEffectVisible(999, false)).toBe(false);
  });
});

describe('AP 継続描边层的透明度曲线', () => {
  it('上层 _01：0 → 峰值 → 0，寿命 0.25s', () => {
    expect(comboEffectUpperAlpha(0)).toBe(0);
    expect(comboEffectUpperAlpha(COMBO_EFFECT_UPPER_LIFE)).toBe(0);
    expect(comboEffectUpperAlpha(COMBO_EFFECT_UPPER_LIFE * 2)).toBe(0);
    // 峰值出现在 atime1 = 10156/65535 ≈ 0.155 处
    const peak = comboEffectUpperAlpha((10156 / 65535) * COMBO_EFFECT_UPPER_LIFE);
    expect(peak).toBeCloseTo(1, 3);
    // 上升段单调增
    expect(comboEffectUpperAlpha(0.02)).toBeGreaterThan(comboEffectUpperAlpha(0.01));
  });

  it('下层 _02：在 0.3529 与 0.1176 之间循环脉动', () => {
    const hi = 0.3529411852359772;
    const lo = 0.11764705926179886;
    expect(comboEffectLowerAlpha(0)).toBeCloseTo(hi, 6);
    expect(comboEffectLowerAlpha(COMBO_EFFECT_LOWER_LIFE * 0.5)).toBeCloseTo(lo, 6);
    expect(comboEffectLowerAlpha(COMBO_EFFECT_LOWER_LIFE)).toBeCloseTo(hi, 6);
    // 全周期都落在 [lo, hi]
    for (let t = 0; t < 1; t += 0.01) {
      const v = comboEffectLowerAlpha(t * COMBO_EFFECT_LOWER_LIFE);
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});

describe('AP 継続描边贴图切片', () => {
  it('10 个数字槽，1 是窄字形（70px），其余 90px', () => {
    expect(COMBO_EFFECT_DIGIT_RECT).toHaveLength(10);
    expect(comboEffectDigitWidth(1)).toBe(70);
    for (const d of [0, 2, 3, 4, 5, 6, 7, 8, 9]) expect(comboEffectDigitWidth(d)).toBe(90);
  });

  it('切片与数字精灵矩形一致，且首尾相接铺满 880px', () => {
    expect(COMBO_EFFECT_DIGIT_RECT[0].x).toBe(0);
    for (let d = 1; d < 10; d++) {
      const prev = COMBO_EFFECT_DIGIT_RECT[d - 1];
      expect(COMBO_EFFECT_DIGIT_RECT[d].x).toBe(prev.x + prev.w);
    }
    const last = COMBO_EFFECT_DIGIT_RECT[9];
    expect(last.x + last.w).toBe(COMBO_EFFECT_SHEET_W);
  });

  it('面片 85×109 居中在 90×120 槽内；1 铺满面片并改用预采样蒙版', () => {
    const b0 = comboEffectOutlineBox(0);
    expect(b0.width).toBeCloseTo(85, 6);
    expect(b0.left).toBeCloseTo(2.5, 6);
    expect(b0.top).toBeCloseTo(5.5, 6);
    expect(b0.height).toBeCloseTo(109, 6);
    expect(b0.image).toBe('sheet');
    const b1 = comboEffectOutlineBox(1);
    expect(b1.image).toBe('digit1');
    expect(b1.width).toBe(85);
    expect(b1.left).toBeCloseTo(2.5, 6);
    expect(b1.maskW).toBe(85);
    expect(b1.maskH).toBe(109);
    expect(b1.maskX).toBe(0);
    expect(comboEffectOutlineBox(2).maskX).toBeCloseTo(-160 * 85 / 90, 4);
    expect(comboEffectOutlineBox(9).maskX).toBeCloseTo(-790 * 85 / 90, 4);
  });
});

describe('AP 継続刷新与叠加', () => {
  it('isRefreshLoop = combo 位数变化', () => {
    expect(comboDigitCount(9)).toBe(1);
    expect(comboDigitCount(10)).toBe(2);
    expect(comboDigitCount(1000)).toBe(4);
    expect(comboEffectRefreshLoop(9, 10)).toBe(true);
    expect(comboEffectRefreshLoop(10, 11)).toBe(false);
    expect(comboEffectRefreshLoop(99, 100)).toBe(true);
    expect(comboEffectRefreshLoop(57, 0)).toBe(true);
  });

  it('同位粒子叠加：加法 a·n，Alpha 混合 1−(1−a)^n', () => {
    expect(additiveStack(0.3, 4)).toBeCloseTo(1.2, 6);
    expect(alphaBlendStack(0.5, 2)).toBeCloseTo(0.75, 6);
    expect(alphaBlendStack(0, 2)).toBe(0);
  });

  it('上层 OutLine_01 在 7/60s 激活', () => {
    expect(COMBO_EFFECT_UPPER_ACTIVATE_DELAY).toBeCloseTo(0.11666, 4);
  });

  it('上层描边缩放：Sprite0–2 同 root，Sprite3 自有曲线停在 1.6', () => {
    expect(comboEffectUpperOutlineScale(0, 0.5)).toBeCloseTo(comboFlashScale(0.5), 6);
    expect(comboEffectUpperOutlineScale(3, 0)).toBe(1);
    expect(comboEffectUpperOutlineScale(3, 0.7)).toBeCloseTo(1.6, 4);
    expect(comboEffectUpperOutlineScale(3, 0.78)).toBeCloseTo(1.6, 4);
  });
});

describe('combo 底光（ComboEffectBG_01）', () => {
  it('上层 alpha：0 → 0.5333@0.155 → 0（单次）', () => {
    expect(comboGlowUpperCurve(0)).toBe(0);
    expect(comboGlowUpperCurve(COMBO_GLOW_LIFE)).toBe(0);
    const peak = comboGlowUpperCurve((10156 / 65535) * COMBO_GLOW_LIFE);
    expect(peak).toBeCloseTo(0.5333333611488342, 4);
  });

  it('下层 alpha：0.3529 → 0.1647@0.5 → 0.3529（循环）', () => {
    const hi = 0.3529411852359772;
    const lo = 0.16470588743686676;
    expect(comboGlowLowerCurve(0)).toBeCloseTo(hi, 6);
    expect(comboGlowLowerCurve(COMBO_GLOW_LIFE * 0.5)).toBeCloseTo(lo, 6);
    expect(comboGlowLowerCurve(COMBO_GLOW_LIFE)).toBeCloseTo(hi, 6);
    for (let t = 0; t < 1; t += 0.02) {
      const v = comboGlowLowerCurve(t * COMBO_GLOW_LIFE);
      expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(v).toBeLessThanOrEqual(hi + 1e-9);
    }
  });
});
