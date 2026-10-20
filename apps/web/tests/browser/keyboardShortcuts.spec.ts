import { test, expect, type Page } from '@playwright/test'
import { openChartFixture } from './chartFixture'

const playButton = (page: Page) => page.getByRole('button', { name: '播放', exact: true })
const pauseButton = (page: Page) => page.getByRole('button', { name: '暂停', exact: true })
/** 跳过开场过场，让 Space 的播放 / 暂停语义稳定。 */
const seekTo = (page: Page, seconds: number) =>
  page.locator('#timeline').evaluate((element: HTMLInputElement, value: number) => {
    element.value = String(value)
    element.dispatchEvent(new Event('input'))
  }, seconds)

test('鼠标点过的按钮不抢 Space：快捷键照常播放与暂停', async ({ page }) => {
  await openChartFixture(page)
  await expect(playButton(page)).toBeEnabled()
  // 点「回到开头」后焦点留在按钮上：Space 应该播放，而不是再点一次按钮。
  await page.locator('#restart').click()
  await expect(page.locator('#restart')).toBeFocused()
  await seekTo(page, 5)
  await page.keyboard.press('Space')
  await expect(pauseButton(page)).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('#restart')).not.toBeFocused()
  await page.keyboard.press('Space')
  await expect(playButton(page)).toBeVisible({ timeout: 15_000 })
})

test('键盘聚焦的按钮仍由 Space 激活', async ({ page }) => {
  await openChartFixture(page)
  const recordToggle = page.locator('[data-record-toggle]')
  await recordToggle.click()
  await expect(recordToggle).toHaveAttribute('aria-expanded', 'false')
  // 先用鼠标点，再用 Tab 把焦点移回来：此时是键盘焦点，Space 属于按钮自己。
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(recordToggle).toBeFocused()
  await page.keyboard.press('Space')
  await expect(recordToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(playButton(page)).toBeVisible()
})

test('界面文字不可选中，输入框保留原生选择', async ({ page }) => {
  await openChartFixture(page)
  const title = page.locator('#chart-name')
  const box = (await title.boundingBox())!
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
  await title.dblclick()
  expect(await page.evaluate(() => String(getSelection()))).toBe('')
  expect(await title.evaluate(element => getComputedStyle(element).userSelect)).toBe('none')

  // 输入框里仍然可以正常选中文本。
  await expect(page.locator('#browse-library')).toBeEnabled()
  await page.locator('#browse-library').click()
  const search = page.locator('#song-search')
  await search.fill('dream believers')
  await search.dblclick()
  const selection = await search.evaluate((element: HTMLInputElement) => ({
    start: element.selectionStart ?? 0,
    end: element.selectionEnd ?? 0,
    userSelect: getComputedStyle(element).userSelect,
  }))
  expect(selection.end).toBeGreaterThan(selection.start)
  expect(selection.userSelect).toBe('text')
})
