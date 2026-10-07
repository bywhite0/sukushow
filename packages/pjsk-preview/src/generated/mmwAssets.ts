/** Runtime texture manifest for the unified web app. */
export const mmwTextureUrls = {
  background: '/assets/mmw/background_overlay.png',
  stage: '/assets/mmw/stage.png',
  notes: '/assets/mmw/notes.png',
  longNoteLine: '/assets/mmw/longNoteLine.png',
  touchLine: '/assets/mmw/touchLine_eff.png',
  effect: '/assets/mmw/effect.png',
} as const

export const mmwAtlases = {
  stage: [{ x1: 0, y1: 0, x2: 2048, y2: 2840 }],
} as const
