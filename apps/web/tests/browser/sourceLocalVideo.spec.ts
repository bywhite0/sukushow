import { test, expect } from '@playwright/test'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 本地视频使用实际时长且静音，失败替换保留旧媒体`, async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
    const video = await page.evaluate(async () => {
      if (!MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) return null
      const canvas = document.createElement('canvas')
      canvas.width = 64; canvas.height = 64
      const context = canvas.getContext('2d')!
      const stream = canvas.captureStream(10)
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
      const chunks: Blob[] = []
      recorder.ondataavailable = event => chunks.push(event.data)
      const stopped = new Promise<void>(done => { recorder.onstop = () => done() })
      recorder.start()
      for (let frame = 0; frame < 8; frame++) {
        context.fillStyle = frame % 2 ? '#ff0000' : '#0000ff'
        context.fillRect(0, 0, 64, 64)
        await new Promise(done => setTimeout(done, 100))
      }
      recorder.stop()
      await stopped
      stream.getTracks().forEach(track => track.stop())
      const blob = new Blob(chunks, { type: 'video/webm' })
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    test.skip(!video, '浏览器不支持 VP8 MediaRecorder')
    await page.locator('#mv-file').setInputFiles({ name: 'local.webm', mimeType: 'video/webm', buffer: Buffer.from(video!) })
    await expect(page.locator('[data-media-kind="mv"] [data-media-status]')).toHaveText('local.webm')
    await page.locator('[data-inspector-toggle]').click()
    await page.getByRole('tab', { name: '显示与特效', exact: true }).click()
    await page.locator('#opt-mv').check()
    await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30000 })
    const state = await page.evaluate(view => {
      const hook = view === 'llll' ? (window as any).__LPW__ : (window as any).__LLL_PJSK__
      const controller = hook.musicVideo
      return { duration: controller.video?.duration, muted: controller.video?.muted }
    }, view)
    expect(state.muted).toBe(true)
    expect(state.duration).toBeGreaterThan(0)
    expect(Number.isFinite(state.duration)).toBe(true)
    await page.locator('#mv-file').setInputFiles({ name: 'broken.webm', mimeType: 'video/webm', buffer: Buffer.from('invalid video') })
    await expect(page.locator('#source-status')).toContainText('文件读取失败')
    await expect(page.locator('[data-media-kind="mv"] [data-media-status]')).toHaveText('local.webm')
    await expect(page.locator('#play')).toBeEnabled()
  })
}
