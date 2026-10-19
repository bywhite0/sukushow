import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 启动借谱版本的共享来源正确解析`, async ({ page }) => {
    await page.route('**/assets/chart/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] }),
    }))
    await page.goto(`/?view=${view}&song=103109&difficulty=HARD`)
    await expect(page.locator('#chart-name')).toHaveText('永遠のEuphoria')
    await expect(page.locator('#chart-difficulty')).toHaveText('HARD')
  })
}

test('曲库迟到不会覆盖已经打开的自制谱', async ({ page }) => {
  let release!: () => void
  await page.route('**/song-list.json', async route => {
    await new Promise<void>(done => { release = done })
    await route.continue()
  })
  await page.goto('/?song=104119')
  await expect.poll(() => typeof release).toBe('function')
  await page.locator('#chart-file').setInputFiles({
    name: 'local.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#edit-metadata')).toBeEnabled()
  release()
  await expect(page.locator('.picker')).toHaveAttribute('data-song-id', '104119')
  await expect(page.locator('#source-status')).not.toContainText('请打开自制谱')
  await expect(page.locator('#edit-metadata')).toBeEnabled()
})

test('启动无谱版本的共享来源不虚构 MASTER', async ({ page }) => {
  await page.goto('/?song=104119')
  await expect(page.locator('#source-status')).toContainText('暂无官方谱面，请打开自制谱')
})
