import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 偏移调整经过媒体更新和模式往返仍保留`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
    await page.locator('#offset').fill('250')
    await page.locator('#offset').dispatchEvent('change')
    await expect(page.locator('#play')).toBeEnabled()
    await page.locator('#edit-metadata').click()
    await expect(page.getByLabel('音频偏移（毫秒）', { exact: true })).toHaveValue('250')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '媒体', exact: true }).click()
    await page.locator('[data-media-kind="audio"] [data-media-clear]').click()
    await expect(page.locator('#play')).toBeEnabled()
    for (const next of [view === 'llll' ? 'pjsk' : 'llll', view]) {
      await page.locator(`.mode-tab[data-view="${next}"]`).click()
      await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
      await expect(page.locator('#offset')).toHaveValue('250')
    }
  })
}
