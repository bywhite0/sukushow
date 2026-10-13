import { test, expect } from '@playwright/test'
import { oneSecondWav } from './audioFixture'

test('LLLL 卸载等待在途音频解码返回', async ({ page }) => {
  test.setTimeout(90000)
  await page.goto('/?chart=/unused.json')
  await page.locator('#chart-file').setInputFiles({ name: 'pending.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  await expect(page.locator('#play')).toBeEnabled()
  await page.evaluate(() => {
    const state = window as any
    const player = state.__LPW__.player
    const load = player.loadBuffer.bind(player)
    const dispose = player.dispose.bind(player)
    state.__decodeEntered = false
    state.__audioDisposed = false
    player.loadBuffer = async (bytes: ArrayBuffer) => {
      state.__decodeEntered = true
      await new Promise<void>(done => { state.__releaseDecode = done })
      return load(bytes)
    }
    player.dispose = () => { state.__audioDisposed = true; dispose() }
  })
  const wav = oneSecondWav()
  await page.locator('#audio-file').setInputFiles({ name: 'decode.wav', mimeType: 'audio/wav', buffer: wav })
  await expect.poll(() => page.evaluate(() => (window as any).__decodeEntered)).toBe(true)
  await page.locator('.mode-tab[data-view="pjsk"]').click()
  expect(await page.evaluate(() => (window as any).__audioDisposed)).toBe(false)
  await page.evaluate(() => (window as any).__releaseDecode())
  await expect.poll(() => page.evaluate(() => (window as any).__audioDisposed)).toBe(true)
  await expect(page.locator('#chart-name')).toHaveText('pending.json', { timeout: 60000 })
})

test('绑定自制谱时隐藏官方难度但保留 Another Vocal', async ({ page }) => {
  await page.route('**/assets/chart/**', route => route.fulfill({ status: 404, body: 'missing' }))
  await page.goto('/?song=103101&difficulty=HARD')
  await expect(page.locator('#song-versions')).toBeVisible()
  await page.locator('#chart-file').setInputFiles({ name: 'custom.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [], Bpms: [] })),
  })
  await expect(page.locator('#edit-metadata')).toBeEnabled()
  await expect(page.locator('#song-difficulty')).toBeHidden()
  await expect(page.locator('#song-versions')).toBeVisible()
})

test('LLLL 清除本地音频会清空播放器缓冲并保留谱面', async ({ page }) => {
  await page.goto('/?chart=/unused.json')
  await expect(page.locator('#chart-name')).toBeVisible()
  await page.locator('#chart-file').setInputFiles({
    name: 'audio-test.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
  })
  const wav = oneSecondWav()
  await page.locator('#audio-file').setInputFiles({ name: 'one-second.wav', mimeType: 'audio/wav', buffer: wav })
  const duration = () => page.evaluate(() => (window as unknown as { __LPW__: { player: { audioDuration: number | null } } }).__LPW__.player.audioDuration)
  await expect.poll(duration).toBe(1)
  await page.getByRole('button', { name: '媒体', exact: true }).click()
  await page.locator('[data-media-kind="audio"]').getByRole('button', { name: '清除', exact: true }).click()
  await expect.poll(duration).toBeNull()
  await expect(page.locator('#chart-name')).toHaveText('audio-test.json')
  await expect(page.locator('#play')).toBeEnabled()
})
