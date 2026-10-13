import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  for (const resource of ['chart', 'audio', 'mv']) {
    test(`${view} ${resource} 请求停滞仍能切换独立谱和模式`, async ({ page }) => {
      test.setTimeout(90000)
      let requested = false
      let release!: () => void
      const pending = new Promise<void>(done => { release = done })
      await page.route(`**/assets/${resource}/**`, async route => {
        if (route.request().method() === 'HEAD') {
          await route.fulfill({ headers: { 'content-length': '100' }, body: '' })
          return
        }
        requested = true
        await pending
        await route.fulfill({ status: 404, body: '' })
      })
      try {
        await page.goto(`/?view=${view}&song=103103`)
        await expect.poll(() => requested, { timeout: 60000 }).toBe(true)
        await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
        // 本地谱仍绑定原歌；显式清除媒体，使新来源不再依赖停滞请求。
        await page.getByRole('button', { name: '媒体', exact: true }).click()
        for (const kind of ['audio', 'cover', 'mv']) {
          await page.locator(`[data-media-kind="${kind}"] [data-media-clear]`).click()
        }
        await expect(page.locator('#chart-name')).toHaveText('フォーチュンムービー', { timeout: 60000 })
        await expect(page.locator('#play')).toBeEnabled()
        await page.locator(`.mode-tab[data-view="${view === 'llll' ? 'pjsk' : 'llll'}"]`).click()
        await expect(page.locator('#chart-name')).toHaveText('フォーチュンムービー', { timeout: 60000 })
        await expect(page.locator('#play')).toBeEnabled()
      } finally { release() }
    })
  }
}
