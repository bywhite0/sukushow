import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 独立本地谱清除旧 URL 来源但保留无关参数`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json&title=旧标题&offset=125&keep=yes`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#chart-name')).toHaveText('custom-chart.json', { timeout: 30000 })
    const params = new URL(page.url()).searchParams
    expect(params.has('chart')).toBe(false)
    expect(params.has('song')).toBe(false)
    expect(params.has('difficulty')).toBe(false)
    expect(params.has('title')).toBe(false)
    expect(params.has('offset')).toBe(false)
    expect(params.get('keep')).toBe('yes')
    expect(params.get('view')).toBe(view)
  })
}

for (const view of ['llll', 'pjsk']) {
  test(`${view} 页面缓存恢复保留自制谱和文件控件`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    await page.locator('#chart-file').setInputFiles({ name: 'restored.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
    })
    await expect(page.locator('#chart-name')).toHaveText('restored.json', { timeout: 60000 })
    await expect(page.locator('#play')).toBeEnabled()
  })
}

test('快速模式往返等待旧视图卸载，不清空新视图', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/?view=pjsk&chart=/missing.json')
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
  await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
  await page.evaluate(() => {
    const state = window as any
    const player = state.__LLL_PJSK__.player
    const load = player.loadSession.bind(player)
    player.loadSession = async (options: any) => {
      await new Promise<void>(done => { state.__releaseSession = done })
      return load(options)
    }
  })
  await page.locator('#chart-file').setInputFiles({ name: 'latest.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseSession)).toBe('function')
  await page.locator('.mode-tab[data-view="llll"]').click()
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  await page.evaluate(() => (window as any).__releaseSession())
  await expect(page.locator('#chart-name')).toHaveText('latest.json', { timeout: 60000 })
  await expect(page.locator('#play')).toBeEnabled()
  await expect(page.locator('#chart-canvas')).toBeVisible()
})

test('页面离开释放共享本地曲绘，重复离开不重复撤销', async ({ page }) => {
  await page.goto('/?chart=/missing.json')
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
  await expect(page.locator('#play')).toBeEnabled()
  const png = await page.evaluate(async () => {
    const revoked: string[] = []
    ;(window as any).__revoked = revoked
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url) }
    const canvas = document.createElement('canvas')
    canvas.width = 1; canvas.height = 1
    const blob = await new Promise<Blob>(done => canvas.toBlob(value => done(value!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.locator('#cover-file').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: Buffer.from(png) })
  await expect(page.locator('[data-media-kind="cover"] [data-media-status]')).toHaveText('cover.png')
  await expect(page.locator('[data-resource-loading]')).toBeHidden()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect.poll(() => page.evaluate(() => (window as any).__revoked.length)).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  expect(await page.evaluate(() => (window as any).__revoked.length)).toBe(1)
})
