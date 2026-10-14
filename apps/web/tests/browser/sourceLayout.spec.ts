import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const width of [1440, 700, 320]) {
  test(`${width}px 来源控件与浮层不超出视口`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.goto('/?song=105101&difficulty=HARD')
    await expect(page.locator('#song-versions')).toBeVisible()
    const bounds = async (selector: string) => {
      await expect(page.locator(selector)).toBeVisible()
      const box = (await page.locator(selector).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
    }
    await bounds('#open-chart')
    await bounds('#media-toggle')
    expect((await page.locator('#song-search').boundingBox())!.width).toBeGreaterThanOrEqual(120)
    await page.getByRole('button', { name: /演唱版本/ }).click()
    await bounds('#song-version-panel')
    await page.keyboard.press('Escape')
    await page.locator('#media-toggle').click()
    await bounds('#media-panel')
    await expect(page.locator('#open-audio')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#edit-metadata')).toBeEnabled()
    await page.locator('#edit-metadata').click()
    await bounds('#metadata-dialog')
    expect(await page.locator('#metadata-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
    const input = page.locator('#metadata-dialog [name="title"]')
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(40)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('#edit-metadata')).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
