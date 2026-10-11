import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const native = readFileSync(new URL('../native/src/mmw_overlay_player.cpp', import.meta.url), 'utf8')

describe('PJSK Fever native 原包渲染契约', () => {
  it('native 加载原包 Fever frame、渐变、光束和文字 sprite', () => {
    expect(native).toContain('overlay/fever-native/tex-fever-v2.png')
    expect(native).toContain('overlay/fever-native/tex-fever-chance-v2.png')
    expect(native).toContain('overlay/fever-native/tex-super-fever-v2.png')
    expect(native).toContain('overlay/fever-native/eff-fever-grd.png')
    expect(native).toContain('overlay/fever-native/tex-fever-gradation-01.png')
    expect(native).toContain('overlay/fever-native/sprites/fever/')
    expect(native).toContain('overlay/fever-native/sprites/chance/')
    expect(native).toContain('overlay/fever-native/sprites/super/')
    expect(native).toContain('fever_sprite_fever_')
    expect(native).toContain('fever_sprite_chance_')
    expect(native).toContain('fever_sprite_super_')
    expect(native).toContain('overlay/fever-native/tex-fever-gauge-color-03.png')
  })

  it('Fever 主视觉不再调用字体或程序化边框几何', () => {
    const feverBody = native.slice(native.indexOf('void drawFeverOverlay('), native.indexOf('void drawOpeningIntroOverlay('))
    expect(feverBody).not.toContain('fonts.title->CalcTextSizeA')
    expect(feverBody).not.toContain('overlay->AddRectFilled')
    expect(feverBody).not.toContain('drawBeamGlow(overlay')
  })

  it('Fever frame 使用原包 9-slice SpriteRenderer 尺寸契约', () => {
    expect(native).toContain('drawNineSlice')
    expect(native).toContain('FEVER_FRAME_WIDTH_UNITS = 17.8f')
    expect(native).toContain('FEVER_FRAME_HEIGHT_UNITS = 10.0f')
    expect(native).toContain('FEVER_FRAME_BORDER_X_PX = 255.0f')
    expect(native).toContain('FEVER_FRAME_BORDER_Y_PX = 13.0f')
    expect(native).toContain('FEVER_FRAME_PPU = 108.0f')
  })
})
