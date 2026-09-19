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
    expect(comboFlashScale(0.7833 * 0.7)).toBeCloseTo(1.6, 5);
    expect(comboFlashScale(0.7833)).toBeCloseTo(1.7, 5);
  });
  it('alpha peaks mid-anim', () => {
    expect(comboFlashAlpha(0)).toBe(0);
    expect(comboFlashAlpha(0.4)).toBe(1);
    expect(comboFlashAlpha(0.7833)).toBe(0);
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
