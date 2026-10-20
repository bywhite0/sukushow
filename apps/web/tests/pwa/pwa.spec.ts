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

test('歌曲资源缓存默认关闭，开启后加载曲目写入缓存，可按分类清理并关闭', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?chart=/fixture-missing.json')
  await workerReady(page)
  // 第一次注册的页面没有被控制，刷新一次再操作。
  await page.reload()

  await page.getByRole('button', { name: '全局设置' }).click()
  const dialog = page.locator('#global-settings')
  await dialog.getByRole('button', { name: '缓存' }).click()
  const songToggle = dialog.locator('[data-cache-song]')
  const audioGroup = dialog.locator('[data-cache-group="audio"]')
  const chartGroup = dialog.locator('[data-cache-group="chart"]')
  const jacketGroup = dialog.locator('[data-cache-group="jacket"]')
  const clearAudio = dialog.locator('[data-cache-clear-group="audio"]')
  const songCaches = ['sukushow-song-audio-v1', 'sukushow-song-mv-v1', 'sukushow-song-chart-v1', 'sukushow-song-jacket-v1']
  const hasSongCaches = () => page.evaluate(async (names) => {
    const keys = await caches.keys()
    return names.every((name) => keys.includes(name))
  }, songCaches)
  await expect(songToggle).toBeEnabled()
  await expect(songToggle).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('sukushow:song-asset-cache:v1'))).toBeNull()
  expect(await hasSongCaches()).toBe(false)

  await songToggle.check()
  await expect(dialog.locator('[data-cache-status]')).toContainText('已启用歌曲资源缓存')
  // 开关开启会为四个分类各建一个空缓存。
  expect(await hasSongCaches()).toBe(true)

  // 加载一首带音频、曲绘与谱面但没有 MV 的曲目，资源请求会经过 Service Worker。
  await page.keyboard.press('Escape')
  await page.goto('/?song=103119&difficulty=MASTER')
  await expect(page.locator('#play')).toBeEnabled({ timeout: 90_000 })
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('sukushow-song-chart-v1')
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  }), { timeout: 30_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^\/assets\/chart\//)]))
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('sukushow-song-jacket-v1')
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  }), { timeout: 30_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^\/assets\/jacket\//)]))
  await expect.poll(() => page.evaluate(async () => {
    const cache = await caches.open('sukushow-song-audio-v1')
    return (await cache.keys()).map((request) => new URL(request.url).pathname)
  }), { timeout: 30_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/^\/assets\/audio\//)]))

  // 按分类清理：只清音频，谱面与曲绘保留；开关仍开启，音频缓存以空缓存的形式补回。
  await page.getByRole('button', { name: '全局设置' }).click()
  await dialog.getByRole('button', { name: '缓存' }).click()
  await expect.poll(async () => audioGroup.textContent(), { timeout: 30_000 }).not.toBe('0 B · 0 项')
  await expect.poll(async () => chartGroup.textContent(), { timeout: 30_000 }).not.toBe('0 B · 0 项')
  await expect.poll(async () => jacketGroup.textContent(), { timeout: 30_000 }).not.toBe('0 B · 0 项')
  await expect(clearAudio).toBeEnabled()
  await clearAudio.click()
  await expect(dialog.locator('[data-cache-status]')).toContainText('已清理歌曲音频缓存')
  await expect.poll(async () => audioGroup.textContent()).toBe('0 B · 0 项')
  const remaining = await page.evaluate(async () => {
    const audio = await caches.open('sukushow-song-audio-v1')
    const chart = await caches.open('sukushow-song-chart-v1')
    return { audio: (await audio.keys()).length, chart: (await chart.keys()).length }
  })
  expect(remaining.audio).toBe(0)
  expect(remaining.chart).toBeGreaterThan(0)

  // 关闭开关会删除四个分类的缓存并持久化。
  await songToggle.uncheck()
  await expect(dialog.locator('[data-cache-status]')).toContainText('已关闭歌曲资源缓存')
  await expect.poll(hasSongCaches).toBe(false)
  expect(await page.evaluate(() => localStorage.getItem('sukushow:song-asset-cache:v1'))).toBe('off')
})

test('缓存页关闭离线缓存会注销 Service Worker 并清空缓存，重新开启后再次注册', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json')
  await workerReady(page)
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0)

  await page.getByRole('button', { name: '全局设置' }).click()
  const dialog = page.locator('#global-settings')
  await dialog.getByRole('button', { name: '缓存' }).click()
  const toggle = dialog.locator('[data-cache-offline]')
  await expect(toggle).toBeEnabled()
  await expect(toggle).toBeChecked()
  await expect.poll(async () => dialog.locator('[data-cache-group="precache"]').textContent())
    .not.toBe('0 B · 0 项')

  await toggle.uncheck()
  await expect(dialog.locator('[data-cache-status]')).toContainText('已关闭离线缓存')
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('sukushow:offline-cache:v1'))).toBe('off')
  await expect(toggle).toBeEnabled()

  await toggle.check()
  await expect(dialog.locator('[data-cache-status]')).toContainText('已启用离线缓存')
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(1)
})
