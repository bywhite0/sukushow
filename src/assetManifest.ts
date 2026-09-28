/**
 * 静态资源清单：贴图 / 字体 / 音效。
 *
 * 路径口径与参考项目（sekai-mmw-preview-web）一致，资源本体在 public/assets/mmw。
 * 贴图分两组：
 *   - 轨道与音符（stage / notes / longNoteLine / touchLine / effect）
 *   - HUD overlay（overlay/**），整套 PJSK 的计分条 / 段位 / combo / 判定字等
 * HUD 贴图是 native 侧 initPlayer → rebuildOverlayResources 的硬依赖，缺一张即报错。
 */
export interface AssetEntry {
  key: string
  url: string
  kind: 'asset' | 'font' | 'sound'
}

const BASE = '/assets/mmw/'

const CORE_TEXTURES = [
  'background_overlay.png',
  'stage.png',
  'notes.png',
  'notes_01.png',
  'notes_02.png',
  'longNoteLine.png',
  'longNoteLine_01.png',
  'longNoteLine_02.png',
  'touchLine_eff.png',
  'touchLine_eff_01.png',
  'touchLine_eff_02.png',
  'effect.png',
]

const OVERLAY_TEXTURES = [
  'overlay/bggen/v3/base.png',
  'overlay/bggen/v3/bottom.png',
  'overlay/bggen/v3/center_cover.png',
  'overlay/bggen/v3/center_mask.png',
  'overlay/bggen/v3/side_cover.png',
  'overlay/bggen/v3/side_mask.png',
  'overlay/bggen/v3/windows.png',
  'overlay/score/bg.png',
  'overlay/score/fg.png',
  'overlay/score/bar.png',
  'overlay/life/v3/bg.png',
  'overlay/life/v3/normal.png',
  'overlay/combo/pt.png',
  'overlay/combo/pe.png',
  'overlay/judge/v3/1.png',
  'overlay/autolive.png',
  'overlay/start_grad.png',
  'overlay/custom-score/icon.png',
  'overlay/ap-native/all-perfect.png',
  'overlay/ap-native/all-perfect-line.png',
  'overlay/ap-native/flare.png',
  'overlay/ap-native/flash.png',
  'overlay/ap-native/sparkle.png',
  'overlay/fever-native/fever-pointer.png',
  'overlay/fever-native/super-fever-pointer.png',
  'overlay/fever-native/fever-gauge-color.png',
]

const RANKS = ['d', 'c', 'b', 'a', 's'] as const
const DIGIT_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'n', '+'] as const
const NUMERIC_CHARS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export const FONT_FILES = [
  'font/FOT-RodinNTLGPro-DB.ttf',
  'font/FOT-RodinNTLG Pro EB.otf',
  'font/NotoSansCJKSC-Black.ttf',
]

/** 音效 key 与 native 侧 SE_NAMES（mmw_port/Note.h）一一对应。
 *  allPerfect 是曲终 AP 结算音（native 侧在 apStartSec 触发），素材在 overlay/ap-native/。 */
export const SOUND_FILES: Record<string, string> = {
  perfect: 'sound/se_live_perfect.mp3',
  criticalTap: 'sound/se_live_critical.mp3',
  flick: 'sound/se_live_flick.mp3',
  flickCritical: 'sound/se_live_flick_critical.mp3',
  trace: 'sound/se_live_trace.mp3',
  traceCritical: 'sound/se_live_trace_critical.mp3',
  tick: 'sound/se_live_connect.mp3',
  tickCritical: 'sound/se_live_connect_critical.mp3',
  holdLoop: 'sound/se_live_long.mp3',
  holdLoopCritical: 'sound/se_live_long_critical.mp3',
  allPerfect: 'overlay/ap-native/all-perfect.m4a',
}

/** 生成完整清单（含程序化展开的段位 / 数字 / combo 贴图）。 */
export function buildAssetManifest(): AssetEntry[] {
  const urls = [...CORE_TEXTURES, ...OVERLAY_TEXTURES]

  for (const rank of RANKS) {
    urls.push(`overlay/score/rank/chr/${rank}.png`, `overlay/score/rank/txt/en/${rank}.png`)
  }
  for (const char of DIGIT_CHARS) {
    const stem = char === '+' ? 'plus' : char
    const shadowStem = char === '+' ? 'splus' : `s${char}`
    urls.push(`overlay/score/digit/${stem}.png`, `overlay/score/digit/${shadowStem}.png`)
  }
  for (const char of NUMERIC_CHARS) {
    urls.push(
      `overlay/combo/p${char}.png`,
      `overlay/combo/b${char}.png`,
      `overlay/life/v3/digit/${char}.png`,
      `overlay/life/v3/digit/s${char}.png`,
    )
  }

  return [
    ...urls.map((file) => ({ key: file, url: BASE + file, kind: 'asset' as const })),
    ...FONT_FILES.map((file) => ({ key: file, url: BASE + file, kind: 'font' as const })),
    ...Object.entries(SOUND_FILES).map(([key, file]) => ({ key, url: BASE + file, kind: 'sound' as const })),
  ]
}
