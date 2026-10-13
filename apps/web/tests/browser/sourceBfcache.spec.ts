import { chromium, test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 真实页面缓存返回保留本地谱并能继续打开文件`, async () => {
    test.setTimeout(90000)
    const browser = await chromium.launch({ ignoreDefaultArgs: ['--disable-back-forward-cache'] })
    const page = await browser.newPage()
    try {
      await page.addInitScript(() => {
        ;(window as any).__pageShows = []
        window.addEventListener('pageshow', event => (window as any).__pageShows.push(event.persisted))
      })
      const session = await page.context().newCDPSession(page)
      await session.send('Page.enable')
      const reasons: unknown[] = []
      session.on('Page.backForwardCacheNotUsed', event => reasons.push(event))
      await page.goto(`http://127.0.0.1:5179/?view=${view}&chart=/missing.json`)
      await expect(page.locator('#source-status')).toContainText('来源加载失败')
      await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
      await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
      await page.goto('http://127.0.0.1:5179/cache-away')
      await page.goBack()
      const restored = await page.evaluate(() => (window as any).__pageShows.includes(true))
      const delegateDisabled = reasons.some(event => (event as any).notRestoredExplanations
        .some((item: any) => item.reason === 'BackForwardCacheDisabledForDelegate'))
      test.skip(!restored && delegateDisabled, 'Chromium 自动化 delegate 禁用 BFCache，真实缓存恢复未验证')
      expect(restored, JSON.stringify(reasons)).toBe(true)
      await expect(page.locator('#chart-name')).toHaveText('custom-chart.json')
      await page.locator('#chart-file').setInputFiles({ name: 'after-cache.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })) })
      await expect(page.locator('#chart-name')).toHaveText('after-cache.json')
      await expect(page.locator('#play')).toBeEnabled()
    } finally { await browser.close() }
  })
}
