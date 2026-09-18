import { describe, expect, it } from 'vitest';
import {
  RG_OPTION_DEFAULTS,
  RG_OPTION_RANGES,
  autoPlayConditionType,
  autoPlayJudgementType,
  conditionSprite,
  darknessAlpha,
  gridLaneCount,
  judgementLayoutY,
  judgementSprite,
  noteSpeedToFallSpeed,
  shouldShowFastSlow,
  shouldShowJudgement,
  targetFpsHz,
} from '../src/rgOptions';

describe('rgOptions defaults (4.12.0 OptionRange.First)', () => {
  it('matches extracted First values', () => {
    expect(RG_OPTION_DEFAULTS.enablePerfectPlus).toBe(false);
    expect(RG_OPTION_DEFAULTS.fastSlowThreshold).toBe(0);
    expect(RG_OPTION_DEFAULTS.judgementOutput).toBe(0);
    expect(RG_OPTION_DEFAULTS.technicalScoreDisplay).toBe(0);
    expect(RG_OPTION_DEFAULTS.speed).toBe(5);
    expect(RG_OPTION_DEFAULTS.noteStartZ).toBe(0);
    expect(RG_OPTION_DEFAULTS.laneWidth).toBe(100);
    expect(RG_OPTION_DEFAULTS.laneDarkness).toBe(80);
    expect(RG_OPTION_DEFAULTS.gridCount).toBe(0);
    expect(RG_OPTION_DEFAULTS.targetFPS).toBe(0);
    expect(RG_OPTION_DEFAULTS.judgementY).toBe(5);
    expect(RG_OPTION_DEFAULTS.fastSlowY).toBe(5);
    expect(RG_OPTION_DEFAULTS.enableApContinue).toBe(true);
    expect(RG_OPTION_DEFAULTS.enableFeverDisplay).toBe(true);
    expect(RG_OPTION_RANGES.noteSpeed).toEqual({ min: 10, max: 200, first: 50 });
    expect(noteSpeedToFallSpeed(50)).toBe(5);
    expect(targetFpsHz(0)).toBe(60);
    expect(targetFpsHz(1)).toBe(120);
    expect(gridLaneCount(0)).toBe(0);
    expect(gridLaneCount(3)).toBe(4);
    expect(darknessAlpha(80, 130)).toBeCloseTo(80 / 130);
    expect(judgementLayoutY(5, -270)).toBe(-270);
    expect(judgementLayoutY(6, -270)).toBe(-240);
  });

  it('gates judgement output with type < 6 - opt', () => {
    expect(shouldShowJudgement(5, 0)).toBe(true);
    expect(shouldShowJudgement(5, 1)).toBe(false);
    expect(shouldShowJudgement(4, 1)).toBe(true);
    expect(shouldShowJudgement(0, 6)).toBe(false);
  });

  it('maps AutoPlay type and PP remount sprite', () => {
    expect(autoPlayJudgementType(false)).toBe(4);
    expect(autoPlayJudgementType(true)).toBe(5);
    expect(judgementSprite(5, false).name).toContain('perfect');
    expect(judgementSprite(5, false).name).not.toContain('plus');
    expect(judgementSprite(5, true).name).toContain('perfect_plus');
  });

  it('gates FastSlow by threshold', () => {
    expect(shouldShowFastSlow(3, 0)).toBe(false);
    expect(shouldShowFastSlow(3, 1)).toBe(true);
    expect(shouldShowFastSlow(4, 1)).toBe(false);
    expect(shouldShowFastSlow(4, 2)).toBe(true);
  });

  it('AutoPlay exact timing maps to Slow condition', () => {
    expect(autoPlayConditionType()).toBe(2);
    expect(conditionSprite(0)).toBeNull();
    expect(conditionSprite(2)?.name).toBe('ui_sc2_ingame_hantei_slow');
    expect(conditionSprite(1)?.fallback).toBe('FAST');
  });
});
