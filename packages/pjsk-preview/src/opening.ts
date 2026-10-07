/**
 * 导出时间轴上写死的开场区间：HUD 开场卡片占输出时间轴的 [0, 4)，
 * 与 wasm 的 HUD_INTRO_DURATION_SEC 一致。
 */
export const EXPORT_OPENING = { startSec: 0, endSec: 4.0 } as const
