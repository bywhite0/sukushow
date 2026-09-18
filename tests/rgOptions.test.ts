import { describe, expect, it } from 'vitest';
import {
  RG_OPTION_DEFAULTS,
  autoPlayJudgementType,
  judgementSprite,
  shouldShowFastSlow,
  shouldShowJudgement,
} from '../src/rgOptions';

describe('rgOptions defaults (4.12.0 OptionRange.First)', () => {
  it('matches extracted First values', () => {
    expect(RG_OPTION_DEFAULTS.enablePerfectPlus).toBe(false);
    expect(RG_OPTION_DEFAULTS.fastSlowThreshold).toBe(0);
    expect(RG_OPTION_DEFAULTS.judgementOutput).toBe(0);
    expect(RG_OPTION_DEFAULTS.technicalScoreDisplay).toBe(0);
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
});
