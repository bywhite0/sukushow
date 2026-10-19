import { test, expect } from '@playwright/test'

async function mountPicker(page: import('@playwright/test').Page, fixtureCatalog = false) {
  await page.goto('/?song=missing')
  await page.evaluate(async fixtureCatalog => {
    const { createSongPicker } = await import('/src/songPicker.ts' as string)
    const list = await (await fetch('/song-list.json')).json()
    if (fixtureCatalog) {
      const base = list.songs.find((song: { id: string }) => song.id === '103103')
      list.songs = [
        { id: 'fixture-a', orderId: 10, title: 'Arc Zebra', category: 'UNIT', levels: { HARD: 10, MASTER: 26 }, hasChart: true },
        { id: 'fixture-b', orderId: 20, title: 'Arc Alpha', category: 'UNIT', levels: { HARD: 13, MASTER: 20 }, hasChart: true },
        { id: 'fixture-c', orderId: 30, title: 'Arc Delta', category: 'UNIT', levels: { HARD: 8, MASTER: 28 }, hasChart: true },
        { id: 'fixture-d', orderId: 40, title: 'Arc Echo', category: 'OTHER', levels: {}, hasChart: false },
        { id: 'fixture-e', orderId: 50, title: 'Arc Beta', category: 'UNIT', levels: {}, hasChart: false },
      ].map(song => ({
        ...base, ...song, furigana: song.title, hasJacket: false,
        difficulties: song.hasChart ? ['HARD', 'MASTER'] : [],
        charts: song.hasChart ? { HARD: 'fixture-hard.json', MASTER: 'fixture-master.json' } : {},
      }))
      list.total = 5
      list.withChart = 3
      list.withJacket = 0
    }
    const host = document.createElement('section')
    host.id = 'picker-test'
    const output = document.createElement('output')
    output.id = 'picker-selection'
    const picker = createSongPicker({ list, onChange: (songId: string, difficulty: string | null) => {
      output.textContent = JSON.stringify({ songId, difficulty })
    } })
    host.append(picker.root, output)
    document.body.replaceChildren(host)
    picker.select(fixtureCatalog ? 'fixture-b' : '103103', 'HARD', false)
  }, fixtureCatalog)
}

test('选中无谱歌曲清除旧难度，并保留无谱筛选', async ({ page }) => {
  await mountPicker(page)
  await page.locator('[data-picker-open]').click()
  await page.getByLabel('含无谱面').check()
  await page.locator('#song-search').fill('104119')
  await page.locator('.song-option[data-song-id="104119"]').click()
  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"104119","difficulty":null}')
  await expect(page.locator('#song-difficulty')).toBeHidden()
  await page.locator('[data-picker-open]').click()
  await expect(page.getByLabel('含无谱面')).toBeChecked()
  await expect(page.locator('#song-search')).toHaveValue('104119')
})

test('直接选择借谱版本保留可用难度，版本区域位于难度之前', async ({ page }) => {
  await mountPicker(page)
  await page.locator('[data-picker-open]').click()
  await page.getByLabel('含无谱面').check()
  await page.locator('#song-search').fill('103112')
  await page.locator('.song-option[data-song-id="103112"]').click()
  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"103112","difficulty":"HARD"}')
  await expect(page.locator('#song-difficulty [data-difficulty="HARD"]')).toHaveAttribute('aria-checked', 'true')
  expect(await page.locator('#song-versions').evaluate(node =>
    Boolean(node.compareDocumentPosition(document.querySelector('#song-difficulty')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)
})

test('难度支持方向键与 Home/End，键盘激活保留焦点', async ({ page }) => {
  await mountPicker(page)
  const selected = page.locator('#song-difficulty [aria-checked="true"]')
  await selected.focus()
  await page.keyboard.press('ArrowRight')
  await expect(selected).toHaveAttribute('data-difficulty', 'EXPERT')
  await expect(selected).toBeFocused()
  await page.keyboard.press('Home')
  await expect(selected).toHaveAttribute('data-difficulty', 'NORMAL')
  await page.keyboard.press('End')
  await expect(selected).toHaveAttribute('data-difficulty', 'MASTER')
  await page.keyboard.press('Space')
  await expect(selected).toBeFocused()
  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"103103","difficulty":"MASTER"}')
})

test('曲库组合筛选与排序，选曲后保留查询并恢复入口焦点', async ({ page }) => {
  await mountPicker(page, true)
  const open = page.locator('[data-picker-open]')
  const search = page.locator('#song-search')
  const options = page.locator('#song-listbox .song-option')
  const visibleIds = () => options.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.songId))

  await open.click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await search.fill('Arc')
  await page.locator('#song-category').selectOption({ label: 'UNIT' })
  await expect.poll(visibleIds).toEqual(['fixture-a', 'fixture-b', 'fixture-c'])
  await page.locator('#song-sort').selectOption('title')
  await expect.poll(visibleIds).toEqual(['fixture-b', 'fixture-c', 'fixture-a'])
  await page.locator('#song-sort').selectOption('level')
  await expect.poll(visibleIds).toEqual(['fixture-c', 'fixture-a', 'fixture-b'])
  await page.getByLabel('含无谱面').check()
  await expect.poll(visibleIds).toEqual(['fixture-c', 'fixture-a', 'fixture-b', 'fixture-e'])
  await page.locator('.song-option[data-song-id="fixture-a"]').click()

  await expect(page.locator('#picker-selection')).toHaveText('{"songId":"fixture-a","difficulty":"HARD"}')
  await expect(page.locator('#song-panel')).toBeHidden()
  await expect(page.locator('.picker')).toHaveAttribute('data-song-id', 'fixture-a')
  await expect(open).toBeFocused()
  await open.click()
  await expect(search).toHaveValue('Arc')
  await expect(page.locator('#song-category')).toHaveValue('UNIT')
  await expect(page.locator('#song-sort')).toHaveValue('level')
  await expect(page.getByLabel('含无谱面')).toBeChecked()
  await expect.poll(visibleIds).toEqual(['fixture-c', 'fixture-a', 'fixture-b', 'fixture-e'])
  await page.keyboard.press('Escape')
  await expect(page.locator('#song-panel')).toBeHidden()
  await expect(open).toBeFocused()
})
