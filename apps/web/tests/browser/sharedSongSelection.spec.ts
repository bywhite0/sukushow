import { test, expect } from '@playwright/test'

test('选择无谱歌曲后，共享来源提示跟随实际选择', async ({ page }) => {
  await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'test missing' }))
  await page.goto('/?song=103103&difficulty=MASTER')
  await expect(page.locator('#song-search')).toHaveValue('フォーチュンムービー')
  await page.locator('#song-search').click()
  await page.getByLabel('含无谱面').focus()
  await page.keyboard.press('Space')
  await page.locator('#song-search').fill('104119')
  await page.locator('#song-search').press('Enter')
  await expect(page.locator('#source-status')).toContainText('SAKURA')
  await expect(page.locator('#source-status')).toContainText('请打开自制谱')
  expect(new URL(page.url()).searchParams.has('difficulty')).toBe(false)
})
