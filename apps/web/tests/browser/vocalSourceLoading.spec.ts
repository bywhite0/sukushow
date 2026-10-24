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
    await expect.poll(() => requested, { timeout: 60000 }).toContain('/assets/mv/103112/index.m3u8')
    // 三个资源各自并发解析，谁先到达不定，逐个轮询而不是拿到 MV 就断言。
    await expect.poll(() => requested, { timeout: 60000 }).toContain('/assets/audio/bgm_10311201.ogg')
    await expect.poll(() => requested.some(path => path.includes('/jacket/103112.')), { timeout: 60000 }).toBe(true)
    expect(requested).not.toContain('/assets/mv/105101/index.m3u8')
  })
  // 版本组到来源谱面的映射由 tests/songVersions.test.ts 穷举，这里只验证真实请求落到来源谱面。
  test(`${view} Another Vocal 103112 请求来源谱面而非目标版本不存在的谱面`, async ({ page }) => {
    test.setTimeout(90000)
    const charts: string[] = []
    await page.route('**/assets/chart/**', async route => {
      charts.push(new URL(route.request().url()).pathname)
      await route.fulfill({ status: 404, body: 'test chart missing' })
    })
    await page.goto(`/?view=${view}&song=103112&difficulty=HARD`)
    await expect.poll(() => charts, { timeout: 60000 }).toContain('/assets/chart/rhythmgame_chart_105101_02.bytes')
    expect(charts.every(path => path.includes('105101_02'))).toBe(true)
    await expect(page.locator('.picker')).toHaveAttribute('data-song-id', '103112')
  })
}
