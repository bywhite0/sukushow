import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 自制谱继承媒体版本资料，制作署名在演唱下方直接展开`, async ({ page }) => {
    await page.route('**/song-credits.json', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ songs: [
        { id: '103101', lyricist: '作词甲', composer: '作曲乙', arranger: null, stringsArranger: '弦编丙', vocal: ['四人版甲', '四人版乙'] },
        { id: '105101', lyricist: '来源作词', composer: null, arranger: null, vocal: ['来源演唱'] },
      ] }),
    }))
    await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
    await page.goto(`/?view=${view}&song=103101&difficulty=HARD`)
    await expect(page.locator('.picker')).toHaveAttribute('data-song-id', '103101')
    await page.locator('#chart-file').setInputFiles({ name: 'credits.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
    })
    await page.locator('#edit-metadata').click()
    await expect(page.locator('#metadata-dialog [name="lyricist"]')).toHaveValue('作词甲')
    await expect(page.locator('#metadata-dialog [name="composer"]')).toHaveValue('作曲乙')
    await expect(page.locator('#metadata-dialog [name="arranger"]')).toHaveValue('弦编丙')
    await expect(page.locator('#metadata-dialog [name="vocal"]')).toHaveValue('四人版甲、四人版乙')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('#chart-artist')).toHaveText('四人版甲、四人版乙')
    const credits = page.locator('#track-credits')
    await expect(credits).toBeVisible()
    await expect(credits.locator('dd')).toHaveText(['作词甲', '作曲乙', '弦编丙'])
    expect(await credits.evaluate(node => node.previousElementSibling?.id)).toBe('chart-artist')
    await expect(credits.locator('details, summary')).toHaveCount(0)
  })
}
