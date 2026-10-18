import { test, expect } from '@playwright/test'

/** 最小 HLS 播放列表：1 个 init 段 + 1 个媒体分片。 */
const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:10',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:10,',
  'seg_000.m4s',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

// 谱面 22 + 曲目资料 12 + 音频 1 + 曲绘 200 + MV（播放列表 + init 100 + 分片 100）
const MV_TOTAL = 22 + 12 + 1 + 200 + PLAYLIST.length + 100 + 100

for (const view of ['llll', 'pjsk']) {
  test(`${view} 媒体大小未知时不显示不完整的总量`, async ({ page }) => {
    let requested = false
    await page.goto(`/?view=${view}&song=missing`)
    await expect(page.locator('#message')).toContainText('曲目加载失败', { timeout: 30000 })
    await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30000 })
    let release!: () => void
    const pending = new Promise<void>(done => { release = done })
    await page.route('**/assets/audio/**', async route => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ status: 405, body: '' }); return
      }
      requested = true
      await pending
      await route.fulfill({ status: 404, body: '' })
    })
    await page.locator('#song-search').fill('103103')
    await page.locator('[data-song-id="103103"]').click()
    try {
      await expect.poll(() => requested).toBe(true)
      await expect(page.locator('[data-resource-loading-size]')).toBeHidden()
      await expect(page.locator('#play')).toBeDisabled()
    } finally { release() }
  })
  test(`${view} 谱面与资料进入媒体阶段后保留累计字节和固定总量`, async ({ page }) => {
    await page.goto(`/?view=${view}&song=missing`)
    await expect(page.locator('#message')).toContainText('曲目加载失败', { timeout: 30000 })
    await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30000 })
    await page.getByRole('tab', { name: '显示与特效', exact: true }).click()
    await page.locator('#opt-mv').uncheck()
    const chart = JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [] })
    const credits = JSON.stringify({ songs: [] })
    let release!: () => void
    const pending = new Promise<void>(done => { release = done })
    await page.route('**/assets/chart/**', route => route.fulfill({
      contentType: 'application/json', headers: { 'content-length': String(Buffer.byteLength(chart)) },
      body: route.request().method() === 'HEAD' ? '' : chart,
    }))
    await page.route('**/song-credits.json', route => route.fulfill({
      contentType: 'application/json', headers: { 'content-length': String(Buffer.byteLength(credits)) },
      body: route.request().method() === 'HEAD' ? '' : credits,
    }))
    for (const [kind, size] of [['audio', 100], ['jacket', 200]] as const) {
      await page.route(`**/assets/${kind}/**`, async route => {
        if (route.request().method() === 'HEAD') {
          await route.fulfill({ headers: { 'content-length': String(size) }, body: '' }); return
        }
        await pending
        await route.fulfill({ status: 404, body: '' })
      })
    }
    await page.locator('#song-search').fill('103103')
    await page.locator('[data-song-id="103103"]').click()
    try {
      const loaded = Buffer.byteLength(chart) + Buffer.byteLength(credits)
      await expect(page.locator('[data-resource-loading-size]')).toHaveText(`(已下载 ${loaded} B / ${loaded + 300} B)`)
      await expect(page.locator('#play')).toBeDisabled()
    } finally { release() }
    await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 30000 })
  })
  test(`${view} 曲目资料请求期间显示对应加载状态`, async ({ page }) => {
    let release!: () => void
    const pending = new Promise<void>(done => { release = done })
    await page.route('**/song-credits.json', async route => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({ headers: { 'content-length': '12' }, body: '' }); return
      }
      await pending
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ songs: [] }) })
    })
    await page.goto(`/?view=${view}&song=103103&difficulty=MASTER`)
    try {
      await expect(page.locator('[data-resource-loading-detail]')).toHaveText('正在读取曲目资料…', { timeout: 30000 })
      await expect(page.locator('#play')).toBeDisabled()
    } finally { release() }
    await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 30000 })
  })
  test(`${view} 状态提示与实际预览共用一次官方谱面下载`, async ({ page }) => {
    const charts: string[] = []
    await page.route('**/assets/chart/**', async route => {
      if (route.request().method() !== 'HEAD') charts.push(new URL(route.request().url()).pathname)
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
      }) })
    })
    await page.route('**/assets/audio/**', route => route.fulfill({ status: 404, body: '' }))
    await page.route('**/assets/jacket/**', route => route.fulfill({ status: 404, body: '' }))
    await page.route('**/assets/mv/**', route => route.fulfill({ status: 404, body: '' }))
    await page.goto(`/?view=${view}&song=103103&difficulty=MASTER`)
    await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 30000 })
    await expect(page.locator('[data-resource-loading]')).toBeHidden()
    expect(charts).toEqual(['/assets/chart/rhythmgame_chart_103103_04.bytes'])
  })
  test(`${view} 曲绘下载失败不能计为已下载的曲绘字节`, async ({ page }) => {
    await page.goto(`/?view=${view}&song=missing`)
    await expect(page.locator('#message')).toContainText('曲目加载失败', { timeout: 30000 })
    await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30000 })
    await page.route('**/assets/chart/**', route => route.fulfill({ contentType: 'application/json',
      body: route.request().method() === 'HEAD' ? '' : '{"Notes":[],"Bpms":[]}', headers: { 'content-length': '22' } }))
    await page.route('**/song-credits.json', route => route.fulfill({ contentType: 'application/json',
      body: route.request().method() === 'HEAD' ? '' : '{"songs":[]}', headers: { 'content-length': '12' } }))
    let release!: () => void
    const pending = new Promise<void>(done => { release = done })
    await page.route('**/assets/audio/**', route => route.fulfill(route.request().method() === 'HEAD'
      ? { headers: { 'content-length': '1' }, body: '' } : { status: 404, body: '' }))
    await page.route('**/assets/jacket/**', route => route.fulfill(route.request().method() === 'HEAD'
      ? { headers: { 'content-length': '200' }, body: '' } : { status: 404, body: '' }))
    await page.route('**/assets/mv/**', async route => {
      const request = route.request();
      if (request.url().endsWith('.m3u8')) {
        // 播放列表要放行：体积统计靠它拿到分片清单。
        await route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: PLAYLIST });
        return;
      }
      if (request.method() === 'HEAD') {
        await route.fulfill({ headers: { 'content-length': '100' }, body: '' });
        return;
      }
      await pending;
      await route.fulfill({ status: 404, body: '' });
    });
    await page.locator('#song-search').fill('103103')
    await page.locator('[data-song-id="103103"]').click()
    try {
      await expect(page.locator('[data-resource-loading-detail]')).toContainText('MV')
      // MV 总量 = 播放列表本身 + init + 1 个分片（各 100 B）。
      await expect(page.locator('[data-resource-loading-size]')).toHaveText(`(已下载 34 B / ${MV_TOTAL} B)`)
    } finally { release() }
  })

  test(`${view} 官方谱面下载未完成时显示来源加载遮罩`, async ({ page }) => {
    let release!: () => void
    let requested = false
    const pending = new Promise<void>(done => { release = done })
    await page.route('**/assets/chart/**', async route => {
      requested = true
      await pending
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
      }) })
    })
    await page.goto(`/?view=${view}&song=103103&difficulty=MASTER`)
    try {
      await expect.poll(() => requested).toBe(true)
      await expect(page.locator('[data-resource-loading-title]')).toHaveText('正在读取谱面来源', { timeout: 30000 })
      await expect(page.locator('[data-resource-loading]')).toBeVisible()
      await expect(page.locator('#play')).toBeDisabled()
    } finally { release() }
    await expect(page.locator('#chart-name')).toContainText('フォーチュン', { timeout: 30000 })
  })
}
