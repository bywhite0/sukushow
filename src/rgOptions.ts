/** Rhythm game user options — defaults from 4.12.0 `RhythmGameOptionValue..ctor`
 *  (`libil2cpp.so` VA 0x44A2C2C): each field = corresponding `OptionRange.First`.
 *
 *  Ranges (min, max, first):
 *  - FastSlow / EnableFastSlow: (0, 2, 0) → Off
 *  - PerfectPlus: First=false
 *  - JudgementOutput: (0, 6, 0) → All
 *  - TechnicalScoreDisplayType: (0, 2, 0) → Off
 *
 *  Enums: `FastSlowOptions`, `JudgementOutputOptions`, `TechnicalScoreDisplayOptions`
 *  in DummyDLL `RhythmGame.Common`.
 */

export type FastSlowOption = 0 | 1 | 2;
/** 0 Off / 1 UnderGreat / 2 UnderPerfect */
export type JudgementOutputOption = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** 0 Off / 1 Add (realtime) / 2 Sub (estimate remaining as PP) */
export type TechnicalScoreDisplayOption = 0 | 1 | 2;

/** NoteJudgementTypes: Miss=0 … PerfectPlus=5 */
export type NoteJudgementType = 0 | 1 | 2 | 3 | 4 | 5;

export const RG_OPTION_DEFAULTS = {
  enablePerfectPlus: false,
  /** ConfigResolver.FastSlowThreshold ← OptionValue.enableFastSlow */
  fastSlowThreshold: 0 as FastSlowOption,
  judgementOutput: 0 as JudgementOutputOption,
  technicalScoreDisplay: 0 as TechnicalScoreDisplayOption,
} as const;

const HANTEI = [
  'ui_sc2_ingame_hantei_miss',
  'ui_sc2_ingame_hantei_bad',
  'ui_sc2_ingame_hantei_good',
  'ui_sc2_ingame_hantei_great',
  'ui_sc2_ingame_hantei_perfect',
  'ui_sc2_ingame_hantei_perfect_plus',
] as const;

const HANTEI_FB = ['MISS', 'BAD', 'GOOD', 'GREAT', 'PERFECT', 'PERFECT+'] as const;

/** ScoreResolver: show judgement sprite only when `type < 6 - judgementOutput`. */
export function shouldShowJudgement(
  type: NoteJudgementType,
  judgementOutput: JudgementOutputOption,
): boolean {
  return type < 6 - judgementOutput;
}

/** AutoPlay preview hit type: PP when EnablePerfectPlus, else Perfect. */
export function autoPlayJudgementType(enablePerfectPlus: boolean): NoteJudgementType {
  return enablePerfectPlus ? 5 : 4;
}

/**
 * Sprite for a judgement type. PerfectPlus + !EnablePerfectPlus → perfect sprite
 * (binary: `type == PP && !ShouldPerfectPlus ⇒ judgementSprites[4]`).
 */
export function judgementSprite(
  type: NoteJudgementType,
  enablePerfectPlus: boolean,
): { name: string; fallback: string } {
  let t: number = type;
  if (t === 5 && !enablePerfectPlus) t = 4;
  t = Math.max(0, Math.min(5, t));
  return { name: HANTEI[t], fallback: HANTEI_FB[t] };
}

/** FastSlow condition gate: Off→never; UnderGreat→type<=3; UnderPerfect→type<=4. */
export function shouldShowFastSlow(
  type: NoteJudgementType,
  fastSlowThreshold: FastSlowOption,
): boolean {
  if (fastSlowThreshold === 0) return false;
  if (fastSlowThreshold === 1) return type <= 3;
  return type <= 4;
}
