import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 借谱版本使用自己的音频、曲绘和 MV`, async ({ page }) => {
    test.setTimeout(90000)
    const requested: string[] = []
    await page.route('**/assets/**', async route => {
      const path = new URL(route.request().url()).pathname
      requested.push(path)
      if (!/\/assets\/(chart|audio|jacket|mv)\//.test(path)) { await route.continue(); return }
      if (path.includes('/chart/')) {
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
        }) })
      } else await route.fulfill({ status: 404, body: 'test media unavailable' })
    })
    await page.goto(`/?view=${view}&song=103112&difficulty=HARD`)
    await expect.poll(() => requested, { timeout: 60000 }).toContain('/assets/mv/103112.mp4')
    expect(requested).toContain('/assets/audio/bgm_10311201.ogg')
    expect(requested.some(path => path.includes('/jacket/103112.'))).toBe(true)
    expect(requested).not.toContain('/assets/mv/105101.mp4')
  })
  for (const [songId, sourceId, title] of [
    ['103112', '105101', 'Dream Believers'],
    ['103109', '104106', '永遠のEuphoria'],
    ['405143', '405138', 'アイシイ（B.G.P. Ver.）'],
  ]) {
  test(`${view} Another Vocal ${songId} 请求来源谱面而非目标版本不存在的谱面`, async ({ page }) => {
    test.setTimeout(90000)
    const charts: string[] = []
    await page.route('**/assets/chart/**', async route => {
      charts.push(new URL(route.request().url()).pathname)
      await route.fulfill({ status: 404, body: 'test chart missing' })
    })
    await page.goto(`/?view=${view}&song=${songId}&difficulty=HARD`)
    await expect.poll(() => charts, { timeout: 60000 }).toContain(`/assets/chart/rhythmgame_chart_${sourceId}_02.bytes`)
    expect(charts.every(path => path.includes(`${sourceId}_02`))).toBe(true)
    await expect(page.locator('#song-search')).toHaveValue(title)
  })
  }
}
