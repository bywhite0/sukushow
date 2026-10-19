import { test, expect } from '@playwright/test'

test('PJSK 连续换谱时 session 不并发且最终显示最新谱面', async ({ page }) => {
  test.setTimeout(90000)
  const upload = async (name: string) => page.locator('#chart-file').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }],
    })),
  })
  await page.goto('/?view=pjsk&chart=/unused.json')
  await upload('initial.json')
  await expect(page.locator('#chart-name')).toHaveText('initial.json', { timeout: 60000 })
  await page.evaluate(() => {
    const state = window as any
    const player = state.__LLL_PJSK__.player
    const load = player.loadSession.bind(player)
    state.__sessionCalls = []; state.__activeSessions = 0; state.__maxSessions = 0
    player.loadSession = async (options: any) => {
      state.__sessionCalls.push(options.metadata.title)
      state.__activeSessions++
      state.__maxSessions = Math.max(state.__maxSessions, state.__activeSessions)
      try {
        if (options.metadata.title === 'older.json') await new Promise<void>(done => { state.__releaseOlder = done })
        return await load(options)
      } finally { state.__activeSessions-- }
    }
  })
  await upload('older.json')
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseOlder)).toBe('function')
  await upload('latest.json')
  await expect(page.locator('#chart-file')).toHaveValue('')
  expect(await page.evaluate(() => (window as any).__sessionCalls)).toEqual(['older.json'])
  await page.evaluate(() => (window as any).__releaseOlder())
  await expect(page.locator('#chart-name')).toHaveText('latest.json')
  expect(await page.evaluate(() => (window as any).__maxSessions)).toBe(1)
  expect(await page.evaluate(() => (window as any).__sessionCalls)).toEqual(['older.json', 'latest.json'])
})

test('PJSK 卸载等待在途初始化完成后才销毁播放器', async ({ page }) => {
  test.setTimeout(90000)
  await page.addInitScript(() => {
    const state = window as any
    const fetchResource = window.fetch.bind(window)
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = String(args[0])
      if (url.includes('/wasm/') && url.endsWith('.wasm') && args[1]?.method !== 'HEAD') {
        state.__wasmRequested = true
        await new Promise<void>(done => { state.__releaseWasm = done })
      }
      return fetchResource(...args)
    }
  })
  await page.goto('/?view=pjsk&chart=/unused.json')
  await expect.poll(() => page.evaluate(() => typeof (window as any).__LLL_PJSK__)).toBe('object')
  await page.evaluate(() => {
    const state = window as any
    const player = state.__LLL_PJSK__.player
    const dispose = player.dispose.bind(player)
    state.__playerDisposed = false
    player.dispose = () => { state.__playerDisposed = true; dispose() }
  })
  await expect.poll(() => page.evaluate(() => (window as any).__wasmRequested)).toBe(true)
  await page.locator('.mode-tab[data-view="llll"]').click()
  expect(await page.evaluate(() => (window as any).__playerDisposed)).toBe(false)
  await page.evaluate(() => (window as any).__releaseWasm())
  await expect.poll(() => page.evaluate(() => (window as any).__playerDisposed), { timeout: 60000 }).toBe(true)
  await expect(page.locator('#stage-canvas')).toBeVisible()
})

test('PJSK 卸载等待在途 session 返回后才销毁播放器', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/?view=pjsk&chart=/unused.json')
  await page.locator('#chart-file').setInputFiles({ name: 'first.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#chart-name')).toHaveText('first.json', { timeout: 60000 })
  await page.evaluate(() => {
    const state = window as any
    const player = state.__LLL_PJSK__.player
    const load = player.loadSession.bind(player)
    const dispose = player.dispose.bind(player)
    state.__sessionEntered = false
    state.__playerDisposed = false
    player.loadSession = async (options: any) => {
      state.__sessionEntered = true
      await new Promise<void>(done => { state.__releaseSession = done })
      return load(options)
    }
    player.dispose = () => { state.__playerDisposed = true; dispose() }
  })
  await page.locator('#chart-file').setInputFiles({ name: 'second.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 2, just: '2', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect.poll(() => page.evaluate(() => (window as any).__sessionEntered)).toBe(true)
  await page.locator('.mode-tab[data-view="llll"]').click()
  expect(await page.evaluate(() => (window as any).__playerDisposed)).toBe(false)
  await page.evaluate(() => (window as any).__releaseSession())
  await expect.poll(() => page.evaluate(() => (window as any).__playerDisposed)).toBe(true)
  await expect(page.locator('#chart-name')).toHaveText('second.json')
})

test('切到 PJSK 保留共享自制谱标题', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/?chart=/unused.json')
  await expect(page.locator('#chart-name')).toBeVisible()
  await page.locator('#chart-file').setInputFiles({ name: 'shared-custom.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#play')).toBeEnabled()
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  await expect(page.locator('#chart-name')).toHaveText('shared-custom.json', { timeout: 60000 })
  await expect(page.locator('#play')).toBeEnabled()
  await page.evaluate(() => {
    const hook = (window as any).__LLL_PJSK__
    const load = hook.player.loadSession.bind(hook.player)
    hook.player.loadSession = async (options: any) => {
      ;(window as any).__receivedMetadata = options.metadata
      if (options.coverBytes) {
        const image = await createImageBitmap(new Blob([options.coverBytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        ;(window as any).__receivedCover = { width: image.width, height: image.height,
          alpha: [...context.getImageData(0, 0, image.width, image.height).data].filter((_, index) => index % 4 === 3) }
        image.close()
      }
      return load(options)
    }
    const fever = hook.player.setFeverWindow.bind(hook.player)
    hook.player.setFeverWindow = (start: number, end: number) => {
      ;(window as any).__receivedFever = [start, end]
      return fever(start, end)
    }
  })
  await page.locator('#edit-metadata').click()
  await page.locator('#metadata-dialog [name="scoreCreator"]').fill('自制谱师')
  await page.locator('#metadata-dialog [name="feverStart"]').fill('10')
  await page.locator('#metadata-dialog [name="feverEnd"]').fill('20')
  await page.locator('#metadata-dialog [name="title"]').fill('PJSK 更新标题')
  await page.locator('#metadata-dialog button[type="submit"]').click()
  await expect(page.locator('#chart-name')).toHaveText('PJSK 更新标题')
  expect(await page.evaluate(() => (window as any).__receivedMetadata)).toMatchObject({ customScoreInfo: true, scoreCreator: '自制谱师', scoreTitle: 'PJSK 更新标题' })
  expect(await page.evaluate(() => (window as any).__receivedFever)).toEqual([10, 20])
  expect(await page.evaluate(() => (window as any).__receivedCover)).toEqual({ width: 1, height: 1, alpha: [0] })
})
