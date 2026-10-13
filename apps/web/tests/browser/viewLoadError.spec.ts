import { test, expect } from '@playwright/test'

test('模式加载失败的错误文本不能被解析为 HTML', async ({ page }) => {
  await page.route(/\/src\/views\/pjsk\.ts(?:\?.*)?$/, route => route.fulfill({
    contentType: 'application/javascript',
    body: `throw new Error('<img src=x onerror="window.__injected=true">');`,
  }))
  await page.goto('/?view=pjsk&song=missing')
  await expect(page.locator('.load-error')).toBeVisible()
  await expect(page.locator('.load-error p')).toContainText('<img src=x')
  await expect(page.locator('.load-error img')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__injected)).toBeUndefined()
})
