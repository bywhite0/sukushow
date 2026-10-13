import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 媒体菜单独立清除及恢复三种资源，并支持键盘关闭`, async ({ page }) => {
    await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.goto(`/?view=${view}&song=103103`)
    const toggle = page.getByRole('button', { name: '媒体', exact: true })
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const kind of ['audio', 'cover', 'mv']) {
      const row = page.locator(`[data-media-kind="${kind}"]`)
      await expect(row.locator('[data-media-status]')).toHaveText('歌曲资源')
      await row.getByRole('button', { name: '清除', exact: true }).click()
      await expect(row.locator('[data-media-status]')).toHaveText('已清除')
    }
    await page.locator('[data-media-kind="cover"]').getByRole('button', { name: '恢复歌曲资源' }).click()
    await expect(page.locator('[data-media-kind="cover"] [data-media-status]')).toHaveText('歌曲资源')
    await expect(page.locator('[data-media-kind="audio"] [data-media-status]')).toHaveText('已清除')
    await page.keyboard.press('Escape')
    await expect(page.locator('#media-panel')).toBeHidden()
    await expect(toggle).toBeFocused()
  })
}

test('窄屏媒体菜单仍能打开文件且不撑宽页面', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?song=missing')
  await page.getByRole('button', { name: '媒体', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.locator('#open-audio').click()
  expect(await (await chooser).element().getAttribute('id')).toBe('audio-file')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
