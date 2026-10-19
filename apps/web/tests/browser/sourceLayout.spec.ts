import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  for (const width of [1440, 700, 320]) {
    test(`${view} ${width}px 曲库与来源浮层不超出视口`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height: 800 })
      await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
      await page.goto(`/?view=${view}&song=105101&difficulty=HARD`)
      await expect(page.locator('[data-record-toggle]')).toBeVisible()
      if (width <= 900) await expect(page.locator('.now-playing')).toBeHidden()
      const bounds = async (selector: string, floating = false) => {
        await expect(page.locator(selector)).toBeVisible()
        const box = (await page.locator(selector).boundingBox())!
        expect(box.x, selector).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width, selector).toBeLessThanOrEqual(width + 1)
        if (floating) {
          expect(box.y, selector).toBeGreaterThanOrEqual(0)
          expect(box.y + box.height, selector).toBeLessThanOrEqual(801)
        }
      }
      await bounds('#open-chart')
      await bounds('#media-toggle')

      await page.locator('#browse-library').click()
      await bounds('#song-panel', true)
      expect((await page.locator('#song-search').boundingBox())!.width).toBeGreaterThanOrEqual(120)
      await expect(page.locator('#song-listbox [role="option"]').first()).toBeVisible()
      if (width <= 900) {
        await expect(page.locator('.now-playing')).toBeHidden()
        const panel = (await page.locator('#song-panel').boundingBox())!
        const transport = (await page.locator('.transport').boundingBox())!
        expect(panel.y + panel.height).toBeLessThanOrEqual(transport.y + 1)
      }
      await page.keyboard.press('Escape')
      await expect(page.locator('#song-panel')).toBeHidden()
      await expect(page.locator('#browse-library')).toBeFocused()

      if (width <= 900) await page.locator('[data-record-toggle]').click()
      await expect(page.locator('.now-playing #song-picker-mount')).toBeVisible()
      await expect(page.locator('#song-versions')).toBeVisible()
      await page.getByRole('button', { name: /演唱版本/ }).click()
      await bounds('#song-version-panel', true)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: /演唱版本/ })).toBeFocused()

      await page.locator('#media-toggle').click()
      await bounds('#media-panel', true)
      await expect(page.locator('#open-audio')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
      await expect(page.locator('#edit-metadata')).toBeEnabled()
      await page.locator('#edit-metadata').click()
      await bounds('#metadata-dialog', true)
      expect(await page.locator('#metadata-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
      const input = page.locator('#metadata-dialog [name="title"]')
      expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(40)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect(page.locator('#edit-metadata')).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}
