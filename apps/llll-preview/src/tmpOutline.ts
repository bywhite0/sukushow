/** TMP SDF outline width helpers (design px, canvas scale 1).
 *
 * Font atlas (FOT-RODINPRO-B/EB SDF): pointSize 32, atlasPadding 4, _GradientScale 5.
 * outlinePx = (_OutlineWidth * _ScaleRatioA) * _GradientScale * (fontSize / pointSize)
 *
 * Preview paints outline via a dual DOM layer (see hud.ts `mountOutlinedText`):
 *   .hud-ol   — OutlineColor fill + `-webkit-text-stroke: 2×outlinePx`
 *   .hud-face — FaceColor, no stroke, `scale(0.96)` so counters keep 内描边
 * Outer ring tuned with 3×; face inset exposes inner-contour outline without fattening weight.
 *
 * FaceDilate (Ingame* 0.3 / OutLineWhite 0.362) is not modeled.
 */

export const TMP_FACE_POINT_SIZE = 32;
export const TMP_GRADIENT_SCALE = 5;
/** CSS underlayer stroke = factor × outlinePx (face covers inner half). */
export const TMP_UNDERLAYER_STROKE_FACTOR = 2;

export type TmpOutlineMaterial = {
  outlineWidth: number;
  scaleRatioA: number;
  gradientScale?: number;
  faceDilate?: number;
};

export const TMP_OUTLINE_MATERIALS = {
  colorOutline04: {
    outlineWidth: 0.4,
    scaleRatioA: 0.8,
    faceDilate: 0.3,
  } satisfies TmpOutlineMaterial,
  outlineWhite: {
    outlineWidth: 0.319,
    scaleRatioA: 0.8,
    faceDilate: 0.362,
  } satisfies TmpOutlineMaterial,
  none: { outlineWidth: 0, scaleRatioA: 0.8 } satisfies TmpOutlineMaterial,
} as const;

export function tmpOutlineCssPx(
  fontSize: number,
  material: TmpOutlineMaterial,
  pointSize: number = TMP_FACE_POINT_SIZE,
): number {
  if (fontSize <= 0 || material.outlineWidth <= 0) return 0;
  const gs = material.gradientScale ?? TMP_GRADIENT_SCALE;
  return material.outlineWidth * material.scaleRatioA * gs * (fontSize / pointSize);
}

export function tmpOutlineCssPxRounded(
  fontSize: number,
  material: TmpOutlineMaterial,
  pointSize: number = TMP_FACE_POINT_SIZE,
): number {
  const px = tmpOutlineCssPx(fontSize, material, pointSize);
  return Math.round(px * 10) / 10;
}

/** Underlayer `-webkit-text-stroke` width (= 2 × outlinePx). */
export function tmpOutlineUnderlayerStrokePx(
  fontSize: number,
  material: TmpOutlineMaterial,
  pointSize: number = TMP_FACE_POINT_SIZE,
): number {
  return tmpOutlineCssPxRounded(fontSize, material, pointSize) * 2;
}

/** Precomputed outlinePx used by style.css underlayer strokes (×2 there). */
export const TMP_HUD_STROKES = {
  scoreLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04),
  rankLetter: tmpOutlineCssPxRounded(28, TMP_OUTLINE_MATERIALS.colorOutline04),
  apLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04),
  voltageLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04),
  mentalLabel: tmpOutlineCssPxRounded(24, TMP_OUTLINE_MATERIALS.colorOutline04),
  techLabel: tmpOutlineCssPxRounded(24, TMP_OUTLINE_MATERIALS.colorOutline04),
  addScore: tmpOutlineCssPxRounded(24, TMP_OUTLINE_MATERIALS.colorOutline04),
  apValue: tmpOutlineCssPxRounded(32, TMP_OUTLINE_MATERIALS.outlineWhite),
  voltageValue: tmpOutlineCssPxRounded(32, TMP_OUTLINE_MATERIALS.outlineWhite),
} as const;
