/** Pure HUD FX helpers (AP/Voltage rings, combo flash, AP増加). RE: PLAN §31/35/46/47 + HUD_LAYOUT. */

/** Fractional part in [0, 1) for Image.Filled Radial360 fillAmount. Exact integers → 0. */
export function radialFillAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const f = value - Math.trunc(value);
  return f < 0 ? f + 1 : f;
}

/** Cross-100 / 200 / … trigger: floor(prev/100) != floor(cur/100) and cur >= 100. */
export function shouldComboHundredFlash(prevCombo: number, curCombo: number): boolean {
  if (curCombo < 100) return false;
  return Math.trunc(prevCombo / 100) !== Math.trunc(curCombo / 100);
}

/** ComboAnimation 0.7833s — scale 1→1.6@0.7→1.7 (piecewise linear on normalized t). */
export function comboFlashScale(age: number, duration = 0.7833): number {
  if (age <= 0) return 1;
  if (age >= duration) return 1.7;
  const t = age / duration;
  if (t <= 0.7) return 1 + (1.6 - 1) * (t / 0.7);
  return 1.6 + (1.7 - 1.6) * ((t - 0.7) / 0.3);
}

/** Alpha curve for ComboAnimation: fade in then out over duration. */
export function comboFlashAlpha(age: number, duration = 0.7833): number {
  if (age <= 0 || age >= duration) return 0;
  const t = age / duration;
  if (t < 0.15) return t / 0.15;
  if (t > 0.75) return (1 - t) / 0.25;
  return 1;
}

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** APIncreaseAnimation 0.75s — scale 1→1.5 via smoothstep(t/(7/12)). */
export function apRateFlashScale(age: number, duration = 0.75): number {
  if (age <= 0) return 1;
  const peakAt = (7 / 12) * duration; // 7/12 of full timeline in RE uses t/(7/12) with t in seconds of anim
  // RE: scale = lerp(1, 1.5, smoothstep(t / (7/12))) with t in [0, duration], clamped.
  const u = smoothstep(age / (7 / 12));
  return 1 + 0.5 * Math.min(1, u);
}

/** APIncreaseAnimation alpha 1→0 via 1−smoothstep(t/0.75). */
export function apRateFlashAlpha(age: number, duration = 0.75): number {
  if (age <= 0) return 1;
  if (age >= duration) return 0;
  return 1 - smoothstep(age / duration);
}

export const AP_RATE_FLASH_RGB = { r: 1, g: 0.2275, b: 0.6 } as const;
export const COMBO_FLASH_DURATION = 0.7833;
export const AP_RATE_FLASH_DURATION = 0.75;

/** ScoreAddTween @0x486177C — duration 0.2, u=min(age,0.2)*5. */
export const SCORE_ADD_TWEEN = 0.2;
/** scoreAddHideTime = t + 0.7 (same as judgement hide). */
export const SCORE_ADD_LIFE = 0.7;
/** Prefab rest anchored X (level56); tween end is 304. */
export const SCORE_ADD_REST_X = 305.8;
export const SCORE_ADD_REST_Y = -52;
/** Preview: shift whole float a bit left of binary X. */
export const SCORE_ADD_X_NUDGE = -40;

/** Anchored X: -48*u*(u-2)+256 (u in [0,1]). */
export function scoreAddTweenX(age: number): number {
  const u = Math.min(Math.max(age, 0), SCORE_ADD_TWEEN) * 5;
  return -48 * u * (u - 2) + 256;
}

/** Color.a: -0.4*u*(u-2)+0.6 → 0.6 at birth, 1 at u=1. */
export function scoreAddTweenAlpha(age: number): number {
  const u = Math.min(Math.max(age, 0), SCORE_ADD_TWEEN) * 5;
  return -0.4 * u * (u - 2) + 0.6;
}
