import { describe, expect, it } from 'vitest';
import {
  TMP_HUD_STROKES,
  TMP_OUTLINE_MATERIALS,
  tmpOutlineCssPx,
  tmpOutlineCssPxRounded,
} from '../src/tmpOutline';

describe('tmpOutlineCssPx', () => {
  it('matches shader OutlineWidth×ScaleRatioA×GradientScale×(fs/pointSize)', () => {
    // ScoreLabel 20 / IngameScorePink: 0.4×0.8×5×(20/32) = 1
    expect(tmpOutlineCssPx(20, TMP_OUTLINE_MATERIALS.colorOutline04)).toBeCloseTo(1, 5);
    // RankLetters 28: 0.4×0.8×5×(28/32) = 1.4
    expect(tmpOutlineCssPx(28, TMP_OUTLINE_MATERIALS.colorOutline04)).toBeCloseTo(1.4, 5);
    // Mental/Tech label 24: 1.2
    expect(tmpOutlineCssPx(24, TMP_OUTLINE_MATERIALS.colorOutline04)).toBeCloseTo(1.2, 5);
    // APValue OutLineWhite 32: 0.319×0.8×5 = 1.276
    expect(tmpOutlineCssPx(32, TMP_OUTLINE_MATERIALS.outlineWhite)).toBeCloseTo(1.276, 5);
    expect(tmpOutlineCssPxRounded(32, TMP_OUTLINE_MATERIALS.outlineWhite)).toBe(1.3);
    expect(tmpOutlineCssPx(20, TMP_OUTLINE_MATERIALS.none)).toBe(0);
  });

  it('exports HUD stroke table for CSS sync', () => {
    expect(TMP_HUD_STROKES.scoreLabel).toBe(1);
    expect(TMP_HUD_STROKES.rankLetter).toBe(1.4);
    expect(TMP_HUD_STROKES.mentalLabel).toBe(1.2);
    expect(TMP_HUD_STROKES.apValue).toBe(1.3);
  });
});
