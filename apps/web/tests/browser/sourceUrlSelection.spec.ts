import { test, expect } from '@playwright/test'

test('官方选曲清除显式谱面 URL 的所有别名并保留无关参数', async ({ page }) => {
  await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/?llllChart=/unused.json&config=%7B%22chart%22%3A%22%2Funused.json%22%7D&keep=yes')
  await page.locator('#song-search').fill('103103')
  await page.locator('#song-search').press('Enter')
  await expect.poll(() => new URL(page.url()).searchParams.get('song')).toBe('103103')
  const params = new URL(page.url()).searchParams
  expect(params.has('llllChart')).toBe(false)
  expect(params.has('config')).toBe(false)
  expect(params.get('keep')).toBe('yes')
})
