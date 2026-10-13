import { test, expect } from '@playwright/test'

test('LLLL 切到无谱歌曲清除旧合成画面和时间状态', async ({ page }) => {
  await page.goto('/?song=103103&difficulty=MASTER')
  await expect(page.locator('#play')).toBeEnabled()
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '2'; node.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '2.0000')
  await page.locator('#song-search').click()
  await page.getByLabel('含无谱面').check()
  await page.locator('#song-search').fill('104119')
  await page.locator('[data-song-id="104119"]').click()
  await expect(page.locator('#play')).toBeDisabled()
  await expect(page.locator('#timeline')).toBeDisabled()
  await expect(page.locator('#chart-name')).toContainText('SAKURA')
  await expect(page.locator('#audio-name')).toContainText('未加载音频')
  await expect(page.locator('#stage-canvas')).not.toHaveAttribute('data-intro', /.+/)
  await expect.poll(() => page.locator('#stage-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    return data.some(value => value !== 0)
  })).toBe(false)
})

test('PJSK 无谱状态禁止走带和快捷键调用未初始化播放器', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?view=pjsk&song=missing')
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await expect(page.locator('#chart-name')).toHaveText('未加载谱面')
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '1'; node.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#timeline')).toBeDisabled()
  await expect(page.locator('#restart')).toBeDisabled()
  await expect(page.locator('#play')).toBeDisabled()
  expect(errors).toEqual([])
})

test('LLLL 无效歌曲不加载演示谱，保留可用页面与空状态', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?view=llll&song=missing&difficulty=MASTER')
  await expect(page.locator('#message')).toContainText('曲目加载失败', { timeout: 60000 })
  await expect(page.locator('#play')).toBeDisabled()
  await expect(page.locator('#export-video')).toBeDisabled()
  await expect(page.locator('#chart-name')).not.toContainText('演示')
  await expect(page.locator('#demo')).toHaveCount(0)
  expect(errors).toEqual([])
})
