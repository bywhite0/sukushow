import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} Another Vocal 通过键盘选择并同步 URL 与难度`, async ({ page }) => {
    await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.goto(`/?view=${view}&song=105101&difficulty=HARD`)
    const version = page.locator('#song-versions [data-song-id="103112"]')
    await expect(version).toBeVisible()
    await version.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#song-search')).toHaveValue('Dream Believers')
    await expect(page.locator('#song-versions [data-song-id="103112"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#song-difficulty [data-difficulty="HARD"]')).toHaveAttribute('aria-checked', 'true')
    expect(new URL(page.url()).searchParams.get('song')).toBe('103112')
    const original = page.locator('#song-versions [data-song-id="105101"]')
    await original.focus()
    await page.keyboard.press('Space')
    await expect(original).toHaveAttribute('aria-pressed', 'true')
    expect(new URL(page.url()).searchParams.get('song')).toBe('105101')
  })
}
