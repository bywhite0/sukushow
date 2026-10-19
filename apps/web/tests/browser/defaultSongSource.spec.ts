import { test, expect } from '@playwright/test'

test('无参数启动实际请求フォーチュンムービー，而不是停在空状态', async ({ page }) => {
  const requested: string[] = []
  await page.route('**/assets/chart/**', async route => {
    requested.push(new URL(route.request().url()).pathname)
    await route.fulfill({ status: 404, body: 'missing test chart' })
  })
  await page.goto('/')
  await expect.poll(() => requested).toContain('/assets/chart/rhythmgame_chart_103103_04.bytes')
  await expect(page.locator('.picker')).toHaveAttribute('data-song-id', '103103')
  await expect(page.locator('#message')).toContainText('曲目加载失败')
  await expect(page.locator('#play')).toBeDisabled()
})

test('显式 URL 谱面不触发默认歌曲请求', async ({ page }) => {
  const requested: string[] = []
  page.on('request', request => {
    if (request.url().includes('/assets/chart/')) requested.push(request.url())
  })
  await page.goto('/?chart=/custom.bytes')
  await expect(page.locator('#browse-library')).toBeEnabled()
  await expect(page.locator('.picker')).toHaveAttribute('data-song-id', '')
  expect(requested).toEqual([])
})
