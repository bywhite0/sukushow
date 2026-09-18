/** Rhythm game user options — defaults from 4.12.0 `RhythmGameOptionValue` OptionRange
 * getters in libil2cpp.so (ctor VA 0x44A2C2C stores each field = Range.First).
 *
 * Int ranges call OptionRange<int>(min, max, first) as (w1, w2, w3).
 * Bool ranges call OptionRange<bool>(first) as w1.
 *
 * EXCLUDED from preview UI (user): noteJudgement, musicJudgement.
 */

export type FastSlowOption = 0 | 1 | 2;
/** 0 Off / 1 UnderGreat / 2 UnderPerfect */
export type JudgementOutputOption = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** 0 Off / 1 Add (realtime) / 2 Sub (estimate remaining as PP) */
export type TechnicalScoreDisplayOption = 0 | 1 | 2;
/** 0 Off / 1 Two … 5 Six */
export type GridCountOption = 0 | 1 | 2 | 3 | 4 | 5;
/** 0 FPS60 / 1 FPS120 */
export type TargetFpsOption = 0 | 1;
/** NoteJudgementTypes: Miss=0 … PerfectPlus=5 */
export type NoteJudgementType = 0 | 1 | 2 | 3 | 4 | 5;

export type OptionRangeInt = { min: number; max: number; first: number };
export type OptionRangeBool = { first: boolean };

/** Authoritative OptionRange table (4.12.0). */
export const RG_OPTION_RANGES = {
  noteSpeed: { min: 10, max: 200, first: 50 } satisfies OptionRangeInt,
  noteStartZ: { min: 0, max: 100, first: 0 } satisfies OptionRangeInt,
  enableSameTimeLine: { first: true } satisfies OptionRangeBool,
  enableFastSlow: { min: 0, max: 2, first: 0 } satisfies OptionRangeInt,
  enablePerfectPlus: { first: false } satisfies OptionRangeBool,
  enableApContinue: { first: true } satisfies OptionRangeBool,
  enableMusicVideo: { first: true } satisfies OptionRangeBool,
  laneDarkness: { min: 0, max: 130, first: 80 } satisfies OptionRangeInt,
  enableRhythmSkillView: { first: true } satisfies OptionRangeBool,
  enableSkillCutin: { first: true } satisfies OptionRangeBool,
  gridCount: { min: 0, max: 5, first: 0 } satisfies OptionRangeInt,
  isMirror: { first: false } satisfies OptionRangeBool,
  laneWidth: { min: 80, max: 120, first: 100 } satisfies OptionRangeInt,
  targetFPS: { min: 0, max: 1, first: 0 } satisfies OptionRangeInt,
  backgroundDarkness: { min: 0, max: 100, first: 0 } satisfies OptionRangeInt,
  judgementOutput: { min: 0, max: 6, first: 0 } satisfies OptionRangeInt,
  judgementY: { min: 1, max: 10, first: 5 } satisfies OptionRangeInt,
  fastSlowY: { min: 1, max: 10, first: 5 } satisfies OptionRangeInt,
  technicalScoreDisplayType: { min: 0, max: 2, first: 0 } satisfies OptionRangeInt,
  enableFeverDisplay: { first: true } satisfies OptionRangeBool,
} as const;

/** ConfigResolver: Speed = noteSpeed × 0.1 */
export function noteSpeedToFallSpeed(noteSpeed: number): number {
  return noteSpeed * 0.1;
}

export function fallSpeedToNoteSpeed(speed: number): number {
  return Math.round(speed * 10);
}

/** LaneWidth float = option / 100; mesh base unit 0.15 × that scale. */
export function laneWidthScale(laneWidth: number): number {
  return laneWidth / 100;
}

/** Darkness alpha 0..1 from option (LaneDarkness max 130). */
export function darknessAlpha(value: number, max = 100): number {
  return Math.max(0, Math.min(1, value / max));
}

/** TargetFPSOptions → Hz (ConfigResolver: 60x+60). */
export function targetFpsHz(opt: TargetFpsOption): number {
  return 60 * opt + 60;
}

/** GridCountOptions → number of lane *sections* (Off=0, Two=2 … Six=6). Dividers = sections − 1. */
export function gridLaneCount(opt: GridCountOption): number {
  return opt === 0 ? 0 : opt + 1;
}

/**
 * Dump Judge at (0, −270) / Condition at (0, −210) when option First=5.
 * Step ±1 moves ±30px (preview mapping; option is 1..10).
 */
export function judgementLayoutY(optionY: number, baseY: number): number {
  const o = Math.max(1, Math.min(10, Math.trunc(optionY)));
  return baseY + (o - 5) * 30;
}

export const RG_OPTION_DEFAULTS = {
  /** Fall speed (ConfigResolver.Speed); First noteSpeed 50 → 5.0 */
  speed: noteSpeedToFallSpeed(RG_OPTION_RANGES.noteSpeed.first),
  noteStartZ: RG_OPTION_RANGES.noteStartZ.first,
  enableSameTimeLine: RG_OPTION_RANGES.enableSameTimeLine.first,
  enablePerfectPlus: RG_OPTION_RANGES.enablePerfectPlus.first,
  enableApContinue: RG_OPTION_RANGES.enableApContinue.first,
  enableMusicVideo: RG_OPTION_RANGES.enableMusicVideo.first,
  laneDarkness: RG_OPTION_RANGES.laneDarkness.first,
  enableRhythmSkillView: RG_OPTION_RANGES.enableRhythmSkillView.first,
  enableSkillCutin: RG_OPTION_RANGES.enableSkillCutin.first,
  gridCount: RG_OPTION_RANGES.gridCount.first as GridCountOption,
  isMirror: RG_OPTION_RANGES.isMirror.first,
  laneWidth: RG_OPTION_RANGES.laneWidth.first,
  targetFPS: RG_OPTION_RANGES.targetFPS.first as TargetFpsOption,
  backgroundDarkness: RG_OPTION_RANGES.backgroundDarkness.first,
  fastSlowThreshold: RG_OPTION_RANGES.enableFastSlow.first as FastSlowOption,
  judgementOutput: RG_OPTION_RANGES.judgementOutput.first as JudgementOutputOption,
  judgementY: RG_OPTION_RANGES.judgementY.first,
  fastSlowY: RG_OPTION_RANGES.fastSlowY.first,
  technicalScoreDisplay: RG_OPTION_RANGES.technicalScoreDisplayType.first as TechnicalScoreDisplayOption,
  enableFeverDisplay: RG_OPTION_RANGES.enableFeverDisplay.first,
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

/** NoteConditionTypes: None=0, Fast=1, Slow=2, Flick=3 */
export type NoteConditionType = 0 | 1 | 2 | 3;

const CONDITION = [
  null,
  'ui_sc2_ingame_hantei_fast',
  'ui_sc2_ingame_hantei_slow',
  'ui_sc2_ingame_hantei_flick',
] as const;

const CONDITION_FB = ['', 'FAST', 'SLOW', 'FLICK'] as const;

/**
 * AutoPlay / exact timing: ToCondition(diff==0) ⇒ Slow (RHYTHM_GAME_ANALYSIS).
 * Callers must still gate with shouldShowFastSlow; when gated off, use 0.
 */
export function autoPlayConditionType(): NoteConditionType {
  return 2;
}

export function conditionSprite(
  condition: NoteConditionType,
): { name: string; fallback: string } | null {
  if (condition === 0) return null;
  const c = Math.max(1, Math.min(3, condition)) as 1 | 2 | 3;
  return { name: CONDITION[c]!, fallback: CONDITION_FB[c] };
}
