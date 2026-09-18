/** TMP SDF outline → CSS -webkit-text-stroke width (design px, canvas scale 1).
 *
 * Font atlas (FOT-RODINPRO-B/EB SDF): pointSize 32, atlasPadding 4, _GradientScale 5.
 * Distance Field shader: outline = (_OutlineWidth * _ScaleRatioA) * scale,
 * with scale ≈ _GradientScale * (fontSize / pointSize) for 1:1 UI canvas.
 *
 * CSS stroke is centered on the glyph; with paint-order:stroke fill the fill covers
 * the inner half — same convention as prior hand-tuned ~1.2px for ScoreLabel.
 * FaceDilate is not modeled (thickens the face into the outline band in TMP).
 */

export const TMP_FACE_POINT_SIZE = 32;
export const TMP_GRADIENT_SCALE = 5;

export type TmpOutlineMaterial = {
  outlineWidth: number;
  scaleRatioA: number;
  gradientScale?: number;
};

/** assets.json material floats (duplicate mats share the same floats). */
export const TMP_OUTLINE_MATERIALS = {
  /** FOT-RODINPRO-B SDF SC2 IngameScorePink / APBlue / VoltageOrange / MentalCyan */
  colorOutline04: { outlineWidth: 0.4, scaleRatioA: 0.8 } satisfies TmpOutlineMaterial,
  /** FOT-RODINPRO-B SDF SC2 OutLineWhite (APValue / VoltageValue) */
  outlineWhite: { outlineWidth: 0.319, scaleRatioA: 0.8 } satisfies TmpOutlineMaterial,
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

/** Round for CSS: keep one decimal when needed (e.g. 1.276 → 1.3). */
export function tmpOutlineCssPxRounded(
  fontSize: number,
  material: TmpOutlineMaterial,
  pointSize: number = TMP_FACE_POINT_SIZE,
): number {
  const px = tmpOutlineCssPx(fontSize, material, pointSize);
  return Math.round(px * 10) / 10;
}

/** Precomputed design strokes used by style.css (keep in sync). */
export const TMP_HUD_STROKES = {
  scoreLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.0
  rankLetter: tmpOutlineCssPxRounded(28, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.4
  apLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.0
  voltageLabel: tmpOutlineCssPxRounded(20, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.0
  mentalLabel: tmpOutlineCssPxRounded(24, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.2
  techLabel: tmpOutlineCssPxRounded(24, TMP_OUTLINE_MATERIALS.colorOutline04), // 1.2
  apValue: tmpOutlineCssPxRounded(32, TMP_OUTLINE_MATERIALS.outlineWhite), // 1.3
  voltageValue: tmpOutlineCssPxRounded(32, TMP_OUTLINE_MATERIALS.outlineWhite), // 1.3
} as const;
