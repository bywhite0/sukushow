import { expect, test, type Page } from '@playwright/test'
import { startProductionServer } from './server'

let server: Awaited<ReturnType<typeof startProductionServer>>
test.beforeAll(async () => { server = await startProductionServer() })
test.afterAll(async () => { await server.close() })

const localChart = {
  name: 'offline-chart.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    Notes: [{ Uid: 1, just: '1', Flags: 160, holds: [] }],
    Bpms: [{ Time: 0, Bpm: 120 }],
  })),
}

async function workerReady(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

async function openLocalChart(page: Page) {
  // Match the normal independent-file workflow, without inheriting a catalog song's media.
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await page.locator('#chart-file').setInputFiles(localChart)
  await expect(page.locator('#chart-name')).toHaveText(localChart.name, { timeout: 60_000 })
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 60_000 })
  await expect(page.locator('#play')).toBeEnabled()
}

test('生产 manifest 与图标满足安装要求，预缓存不下载曲库媒体', async ({ page, request }) => {
  await page.goto('/?chart=/fixture-missing.json')
  await workerReady(page)
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({
    id: '/', start_url: '/', scope: '/', display: 'standalone',
    name: 'sukushow · 谱面放映室', short_name: 'sukushow',
  })
  for (const icon of manifest.icons) {
    const dimensions = await page.evaluate(async (src) => {
      const image = await createImageBitmap(await (await fetch(src)).blob())
      const size = `${image.width}x${image.height}`
      image.close()
      return size
    }, icon.src)
    expect(dimensions).toBe(icon.sizes)
  }
  const session = await page.context().newCDPSession(page)
  const { installabilityErrors } = await session.send('Page.getInstallabilityErrors')
  expect(installabilityErrors).toEqual([])
  const urls = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.includes('precache'))
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(entry => entry.url)))).flat()
  })
  expect(urls.some(url => /\/wasm\/.*\.wasm/.test(url))).toBe(true)
  expect(urls.some(url => /\/assets\/(?:audio|mv|chart|jacket)\//.test(url))).toBe(false)
  expect(urls.some(url => /\/assets\/mmw\//.test(url))).toBe(false)
})

test('离线刷新应用并切换已加载的两种模式，仍可打开本地谱面', async ({ page, context }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/?chart=/fixture-missing.json')
  await workerReady(page)
  // Requests made before the first worker takes control are deliberately not promised offline.
  await page.reload()
  await openLocalChart(page)
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  await expect(page.locator('#chart-name')).toHaveText(localChart.name, { timeout: 60_000 })
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 60_000 })
  await expect(page.locator('#play')).toBeEnabled()
  await expect.poll(() => page.evaluate(async () => Boolean(
    await (await caches.open('sukushow-renderer-assets-v1')).match('/assets/mmw/font/NotoSansCJKSC-Black.ttf'),
  ))).toBe(true)

  const failedGets: string[] = []
  page.on('requestfailed', request => {
    if (request.method() === 'GET' && !request.url().endsWith('/fixture-missing.json')) failedGets.push(request.url())
  })
  await context.setOffline(true)
  await page.goto('/?view=llll&chart=/fixture-missing.json')
  await openLocalChart(page)
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  await expect(page.locator('#chart-name')).toHaveText(localChart.name, { timeout: 60_000 })
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 60_000 })
  await expect(page.locator('#play')).toBeEnabled()
  await page.locator('#play').click()
  await expect(page.locator('#play')).toContainText('暂停')
  await page.locator('#play').click()
  expect(failedGets).toEqual([])
  expect(pageErrors).toEqual([])
})

test('新版本等待用户确认，其他标签页更新也保留当前本地谱面', async ({ page, context }) => {
  await page.goto('/?chart=/fixture-missing.json')
  await workerReady(page)
  await openLocalChart(page)
  await page.evaluate(() => { document.documentElement.dataset.pwaSession = 'preserved' })

  const other = await context.newPage()
  await other.goto('/?song=missing')
  await workerReady(other)
  await other.evaluate(() => { document.documentElement.dataset.pwaSession = 'updating' })
  server.newRelease()
  await other.evaluate(async () => { await (await navigator.serviceWorker.ready).update() })
  await expect(page.locator('.pwa-update')).toBeVisible()
  await expect(other.locator('.pwa-update')).toBeVisible()
  await expect(page.locator('#chart-name')).toHaveText(localChart.name)
  expect(await page.evaluate(() => document.documentElement.dataset.pwaSession)).toBe('preserved')
  await page.locator('[data-pwa-dismiss]').click()
  await expect(page.locator('.pwa-update')).toBeHidden()

  await other.locator('[data-pwa-reload]').click()
  await expect(other.locator('html')).not.toHaveAttribute('data-pwa-session', 'updating')
  await expect(page.locator('.pwa-update')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset.pwaSession)).toBe('preserved')
  await expect(page.locator('#chart-name')).toHaveText(localChart.name)
  await expect(page.locator('#play')).toBeEnabled()

  await page.locator('[data-pwa-reload]').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-pwa-session', 'preserved')
})
