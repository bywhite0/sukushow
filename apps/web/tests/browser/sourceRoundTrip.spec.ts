import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'
import { oneSecondWav } from './audioFixture'

for (const start of ['llll', 'pjsk']) {
  test(`${start} 播放中切模式及返回都保持暂停`, async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(`/?view=${start}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled()
    await page.locator('#play').click()
    await expect(page.locator('#play')).toContainText('暂停', { timeout: 15000 })
    for (const view of [start === 'llll' ? 'pjsk' : 'llll', start]) {
      await page.locator(`.mode-tab[data-view="${view}"]`).click()
      await expect(page.locator('#chart-name')).toHaveText('custom-chart.json', { timeout: 60000 })
      await expect(page.locator('#play')).toBeEnabled()
      await expect(page.locator('#play')).toContainText('播放')
      const time = () => page.evaluate(view => view === 'llll'
        ? Number(document.querySelector('#chart-canvas')!.getAttribute('data-time'))
        : (window as any).__LLL_PJSK__.player.getStateSnapshot().currentTimeSec, view)
      const before = await time()
      await page.waitForTimeout(250)
      expect(await time()).toBe(before)
      if (view === 'pjsk') expect(await page.evaluate(() => (window as any).__LLL_PJSK__.player.getStateSnapshot().transportState)).not.toBe('playing')
    }
  })

  test(`${start} 起点往返保留自制谱、元数据和真实媒体`, async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(`/?view=${start}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
    await page.locator('#edit-metadata').click()
    await page.locator('#metadata-dialog [name="title"]').fill('跨模式自制谱')
    await page.locator('#metadata-dialog [name="scoreCreator"]').fill('测试谱师')
    await page.locator('#metadata-dialog button[type="submit"]').click()
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 2; canvas.height = 2
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ff0000'
      context.fillRect(0, 0, 2, 2)
      const blob = await new Promise<Blob>(done => canvas.toBlob(value => done(value!), 'image/png'))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    await page.locator('#cover-file').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    const wav = oneSecondWav()
    await page.locator('#audio-file').setInputFiles({ name: 'one-second.wav', mimeType: '', buffer: wav })
    await expect(page.locator('[data-media-kind="audio"] [data-media-status]')).toHaveText('one-second.wav')
    await page.locator('#audio-file').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid audio') })
    await expect(page.locator('#source-status')).toContainText('文件读取失败')
    await expect(page.locator('[data-media-kind="audio"] [data-media-status]')).toHaveText('one-second.wav')
    for (const view of [start, start === 'llll' ? 'pjsk' : 'llll', start]) {
      await page.locator(`.mode-tab[data-view="${view}"]`).click()
      await expect(page.locator('#chart-name')).toHaveText('跨模式自制谱', { timeout: 60000 })
      await expect(page.locator('#play')).toBeEnabled()
      await expect(page.locator('[data-resource-loading]')).toBeHidden()
      await expect(page.locator('[data-media-kind="cover"] [data-media-status]')).toHaveText('red.png')
      await expect(page.locator('[data-media-kind="audio"] [data-media-status]')).toHaveText('one-second.wav')
      if (view === 'llll') {
        expect(await page.evaluate(() => (window as any).__LPW__.player.audioDuration)).toBe(1)
      } else {
        expect(await page.evaluate(() => (window as any).__LLL_PJSK__.getChart().notes.length)).toBe(6)
      }
      await page.locator('#edit-metadata').click()
      await expect(page.locator('#metadata-dialog [name="scoreCreator"]')).toHaveValue('测试谱师')
      await page.keyboard.press('Escape')
    }
  })
}
