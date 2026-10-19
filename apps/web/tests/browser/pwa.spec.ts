import { expect, test } from '@playwright/test'

test('开发服务器不注册 service worker', async ({ page }) => {
  await page.goto('/?song=missing')
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 })
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)
})
