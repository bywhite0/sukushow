/**
 * 构建期图标 codegen：把用到的 Lucide 图标从 `@iconify-json/lucide` 抽成
 * `apps/web/src/icons.generated.ts`。
 *
 * 只生成清单里列出的图形，整套图标留在 devDependency 里；需要新图标时在 ICONS 里加名字，
 * 再跑 `pnpm icons`（`pnpm build` 会自动先跑一次）。
 *
 * Lucide 是 24×24 网格的纯描边图标，数据里每个图形都自带
 * `fill/stroke/stroke-width/stroke-linecap/stroke-linejoin`。这些表现属性统一
 * 交给 `src/icons.ts` 的包装层，生成时剥掉，线宽才能按尺寸调。
 *
 * 图标来源：Lucide（https://lucide.dev），ISC License。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

/** 站点用到的全部图标；顺序即生成文件里的顺序。 */
const ICONS = [
  // 播放控制
  'play',
  'pause',
  'skip-forward',
  'skip-back',
  // 面板与视图
  'panel-left-open',
  'panel-left-close',
  'panel-right-open',
  'panel-right-close',
  'focus',
  'maximize',
  'minimize',
  // 操作
  'search',
  'library-big',
  'list-music',
  'settings',
  'download',
  'file-code',
  'plus',
  'x',
  'check',
  // 导航
  'chevron-right',
  'chevron-down',
  'arrow-up-right',
  // 品牌与占位
  'palette',
  'database',
  'music',
  'github',
]

const outputUrl = new URL('../src/icons.generated.ts', import.meta.url)
// 依赖装在 apps/web，从该包解析。
const require = createRequire(new URL('../package.json', import.meta.url))
const { version: setVersion } = require('@iconify-json/lucide/package.json')
const { icons } = require('@iconify-json/lucide/icons.json')
const { height: gridSize = 24 } = require('@iconify-json/lucide/info.json')

const missing = ICONS.filter(name => !icons[name])
if (missing.length) {
  throw new Error(`@iconify-json/lucide 里没有这些图标：${missing.join(', ')}`)
}
const duplicated = ICONS.filter((name, index) => ICONS.indexOf(name) !== index)
if (duplicated.length) throw new Error(`ICONS 里有重复项：${duplicated.join(', ')}`)

/** 去掉图形自带的表现属性，颜色与线宽由包装层决定。 */
const stripPresentation = (body) =>
  body.replace(/\s(?:fill|stroke|stroke-width|stroke-linecap|stroke-linejoin)="[^"]*"/g, '')

/** 仓库风格是单引号；图形数据里没有单引号与反斜杠，直接包起来即可。 */
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

const entries = ICONS.map(name => {
  const body = stripPresentation(icons[name].body)
  if (body.includes('stroke=') || body.includes('fill=')) {
    throw new Error(`${name} 仍带有表现属性，请检查 Lucide 数据格式：${body}`)
  }
  return `  ${quote(name)}: ${quote(body)},`
})

const source = `/**
 * 由 \`apps/web/scripts/generate-ui-icons.mjs\` 生成；图形清单与生成逻辑都在该脚本里。
 *
 * 图标来自 Lucide ${setVersion}（https://lucide.dev），ISC License，共 ${ICONS.length} 个。
 * 网格 ${gridSize}×${gridSize}，纯描边；颜色与线宽由 \`icons.ts\` 的包装层控制。
 */

export const iconNames = [
${ICONS.map(name => `  ${quote(name)},`).join('\n')}
] as const

export type IconName = (typeof iconNames)[number]

export const iconBodies: Record<IconName, string> = {
${entries.join('\n')}
}
`

const previous = await readFile(outputUrl, 'utf8').catch(() => '')
if (previous !== source) await writeFile(outputUrl, source)
console.log(
  `icons.generated.ts: ${ICONS.length} 个 Lucide 图标（${previous === source ? '无变化' : '已更新'}）`,
)
