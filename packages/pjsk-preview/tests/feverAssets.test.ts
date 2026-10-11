import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FEVER_SPRITE_FILES, FEVER_TEXTURE_FILES, buildAssetManifest } from '../src/assetManifest'

const manifestPaths = () => new Set(buildAssetManifest().map((entry) => entry.url))
describe('PJSK Fever 原包资源', () => {
  it('manifest 引用的每个 Fever 文件都可随应用分发', () => {
    for (const file of [...FEVER_TEXTURE_FILES, ...FEVER_SPRITE_FILES]) {
      expect(existsSync(new URL(`../public/assets/mmw/${file}`, import.meta.url)), file).toBe(true)
    }
  })

  it('manifest 包含完整的 Fever 原包贴图集合', () => {
    const paths = manifestPaths()

    for (const file of FEVER_TEXTURE_FILES) {
      expect(paths.has(`/assets/mmw/${file}`), file).toBe(true)
    }
  })

  it('manifest 包含 Fever 与 SuperFever 的原包文字 sprite', () => {
    const paths = manifestPaths()

    for (const file of FEVER_SPRITE_FILES) {
      expect(paths.has(`/assets/mmw/${file}`), file).toBe(true)
    }
  })

  it('Fever 资源使用 PJSK live effect 命名，不混入 LLLL 资源', () => {
    expect(FEVER_TEXTURE_FILES.every((file) => file.startsWith('overlay/fever-native/'))).toBe(true)
    expect(FEVER_TEXTURE_FILES.some((file) => /line_fever|text_feverOK|gage_fever_lane/i.test(file))).toBe(false)
  })
})
