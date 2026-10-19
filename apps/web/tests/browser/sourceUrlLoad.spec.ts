import { test, expect } from '@playwright/test'

for (const declared of [true, false]) {
  test(`URL 超限响应被拒绝（声明长度：${declared}）`, async ({ page }) => {
    await page.route(url => url.pathname === '/large.json', route => route.fulfill({
      contentType: 'application/json',
      headers: declared ? { 'content-length': String(16 * 1024 * 1024 + 1) } : {},
      body: Buffer.alloc(16 * 1024 * 1024 + 1, 32),
    }))
    await page.goto('/?chart=/large.json')
    await expect(page.locator('#source-status')).toContainText('超过 16 MiB')
    await expect(page.locator('#play')).toBeDisabled()
  })
}

test('迟到 URL 响应不能覆盖已打开的本地谱', async ({ page }) => {
  let release!: () => void
  await page.route(url => url.pathname === '/slow.json', async route => {
    await new Promise<void>(done => { release = done })
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Notes: [], Bpms: [] }) })
  })
  await page.goto('/?chart=/slow.json&title=旧URL标题')
  await expect.poll(() => typeof release).toBe('function')
  await page.locator('#chart-file').setInputFiles({ name: 'new-local.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#chart-name')).toHaveText('new-local.json')
  const response = page.waitForResponse(url => new URL(url.url()).pathname === '/slow.json')
  release()
  await (await response).finished()
  await expect(page.locator('#source-status')).toBeEmpty()
  await expect(page.locator('#chart-name')).toHaveText('new-local.json')
})

test('LLLL 显式谱面 URL 加载真实谱面并应用标题和偏移', async ({ page }) => {
  await page.route(url => url.pathname === '/explicit.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({
      Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
    }),
  }))
  await page.goto('/?chart=/explicit.json&title=URL谱面&offset=125')
  await expect(page.locator('#chart-name')).toHaveText('URL谱面')
  await expect(page.locator('#play')).toBeEnabled()
  await expect(page.locator('#offset')).toHaveValue('125')
})

test('显式 URL 下载失败不回退默认歌', async ({ page }) => {
  const charts: string[] = []
  page.on('request', request => { if (request.url().includes('/assets/chart/')) charts.push(request.url()) })
  await page.route(url => url.pathname === '/explicit.json', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/?chart=/explicit.json')
  await expect(page.locator('#source-status')).toContainText('404')
  await expect(page.locator('#play')).toBeDisabled()
  expect(charts).toEqual([])
})
