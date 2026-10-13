import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  for (const scenario of ['invalid-song', 'invalid-difficulty', 'chart-404']) {
    test(`${view} ${scenario} 不请求默认或演示谱且禁止播放`, async ({ page }) => {
      const charts: string[] = []
      await page.route('**/assets/chart/**', async route => {
        if (route.request().method() === 'GET') charts.push(new URL(route.request().url()).pathname)
        await route.fulfill({ status: 404, body: 'missing chart' })
      })
      const query = scenario === 'invalid-song' ? 'song=not-found'
        : scenario === 'invalid-difficulty' ? 'song=104119&difficulty=MASTER'
        : 'song=103104&difficulty=HARD'
      await page.goto(`/?view=${view}&${query}`)
      if (scenario === 'chart-404') {
        await expect(page.locator('#message')).toContainText('曲目加载失败', { timeout: 60000 })
        expect(charts.length).toBeGreaterThan(0)
        expect(charts.every(path => path === '/assets/chart/rhythmgame_chart_103104_02.bytes')).toBe(true)
      } else {
        await expect(page.locator('#source-status')).toContainText('来源加载失败')
        expect(charts).toEqual([])
      }
      await expect(page.locator('#play')).toBeDisabled()
      await expect(page.locator('#demo')).toHaveCount(0)
    })
  }
}
