import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 历史 URL 加载失败后不能播放此前谱面`, async ({ page }) => {
    await page.route(url => url.pathname === '/good.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [],
    }) }))
    await page.route(url => url.pathname === '/bad.json', route => route.fulfill({ status: 404, body: '' }))
    await page.goto(`/?view=${view}&chart=/good.json`)
    await expect(page.locator('#chart-name')).toHaveText('good.json', { timeout: 60000 })
    await page.evaluate(view => {
      history.pushState(null, '', `/?view=${view}&chart=/bad.json`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, view)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await expect(page.locator('#play')).toBeDisabled()
    await expect(page.locator('#chart-name')).not.toHaveText('good.json')
  })
}

test('启动 URL 在历史切换后返回不能覆盖新的 URL 来源', async ({ page }) => {
  let release!: () => void
  const body = JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })
  await page.route(url => url.pathname === '/boot-old.json', async route => {
    await new Promise<void>(done => { release = done })
    await route.fulfill({ contentType: 'application/json', body })
  })
  await page.route(url => url.pathname === '/history-new.json', route => route.fulfill({ contentType: 'application/json', body }))
  await page.goto('/?chart=/boot-old.json')
  await expect.poll(() => typeof release).toBe('function')
  await page.evaluate(() => {
    history.pushState(null, '', '/?chart=/history-new.json')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/boot-old.json')
  release()
  await (await oldResponse).finished()
  await expect(page.locator('#chart-name')).toHaveText('history-new.json')
})

test('连续 URL 历史切换只应用最后选择，不受响应顺序影响', async ({ page }) => {
  const releases = new Map<string, () => void>()
  await page.route(url => ['/older.json', '/newer.json'].includes(url.pathname), async route => {
    await new Promise<void>(done => releases.set(new URL(route.request().url()).pathname, done))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
    }) })
  })
  await page.goto('/?chart=/unused.json')
  for (const filename of ['older.json', 'newer.json']) {
    await page.evaluate(name => {
      history.pushState(null, '', `/?chart=/${name}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, filename)
    await expect.poll(() => releases.has(`/${filename}`)).toBe(true)
  }
  releases.get('/older.json')!()
  await expect(page.locator('#chart-name')).not.toHaveText('older.json')
  releases.get('/newer.json')!()
  await expect(page.locator('#chart-name')).toHaveText('newer.json')
})

test('仅模式历史变化保留当前独立自制谱，不重新加载 URL 来源', async ({ page }) => {
  let requests = 0
  await page.route(url => url.pathname === '/original.json', route => {
    requests++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
    }) })
  })
  await page.goto('/?chart=/original.json')
  await expect(page.locator('#chart-name')).toHaveText('original.json')
  await page.locator('#chart-file').setInputFiles({ name: 'replacement.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 2, just: '2', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#chart-name')).toHaveText('replacement.json')
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  await expect(page.locator('#chart-name')).toHaveText('replacement.json', { timeout: 60000 })
  await page.goBack()
  await expect(page.locator('#stage-canvas')).toBeVisible()
  await expect(page.locator('#chart-name')).toHaveText('replacement.json')
  expect(requests).toBe(1)
})

test('后退和前进同步歌曲来源与选择器', async ({ page }) => {
  await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/?song=104119')
  await expect(page.locator('#song-search')).toHaveValue('Dream Believers（SAKURA Ver.）')
  await page.evaluate(() => {
    history.pushState(null, '', '/?song=203111')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.locator('#song-search')).toHaveValue('ツバサ・ラ・リベルテ')
  await expect(page.locator('#source-status')).toContainText('ツバサ・ラ・リベルテ')
  await page.goBack()
  await expect(page.locator('#song-search')).toHaveValue('Dream Believers（SAKURA Ver.）')
  await expect(page.locator('#source-status')).toContainText('SAKURA')
  await page.goForward()
  await expect(page.locator('#song-search')).toHaveValue('ツバサ・ラ・リベルテ')
})
