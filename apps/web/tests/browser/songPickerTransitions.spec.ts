import { test, expect } from '@playwright/test'

async function mountPicker(page: import('@playwright/test').Page) {
  await page.goto('/?song=missing')
  await page.evaluate(async () => {
    const { createSongPicker } = await import('/src/songPicker.ts' as string)
    const list = await (await fetch('/song-list.json')).json()
    const host = document.createElement('section')
    host.id = 'picker-test'
    const output = document.createElement('output')
    output.id = 'picker-selection'
    const picker = createSongPicker({ list, onChange: (songId: string, difficulty: string | null) => {
      output.textContent = JSON.stringify({ songId, difficulty })
    } })
    host.append(picker.root, output)
    document.body.replaceChildren(host)
    picker.select('103103', 'HARD', false)
  })
}

test('选中无谱歌曲清除旧难度，并保留无谱筛选', async ({ page }) => {
  await mountPicker(page)
  await page.locator('#song-search').click()
  await page.getByLabel('含无谱面').check()
  await page.locator('#song-search').fill('104119')
  await page.locator('[data-song-id="104119"]').click()
  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"104119","difficulty":null}')
  await expect(page.locator('#song-difficulty')).toBeHidden()
  await page.locator('#song-search').click()
  await expect(page.getByLabel('含无谱面')).toBeChecked()
})

test('直接选择借谱版本保留可用难度，版本区域位于难度之前', async ({ page }) => {
  await mountPicker(page)
  await page.locator('#song-search').click()
  await page.getByLabel('含无谱面').check()
  await page.locator('#song-search').fill('103112')
  await page.locator('.song-option[data-song-id="103112"]').click()
  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"103112","difficulty":"HARD"}')
  await expect(page.locator('#song-difficulty [data-difficulty="HARD"]')).toHaveAttribute('aria-checked', 'true')
  expect(await page.locator('#song-versions').evaluate(node =>
    Boolean(node.compareDocumentPosition(document.querySelector('#song-difficulty')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)
})
