import { test, expect } from '@playwright/test'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 清除并恢复歌曲音频与 MV 实际更新播放器`, async ({ page }) => {
    test.setTimeout(90000)
    await page.goto(`/?view=${view}&song=103103&difficulty=MASTER`)
    await expect(page.locator('#play')).toBeEnabled({ timeout: 60000 })
    await expect(page.locator('[data-resource-loading]')).toBeHidden()
    const snapshot = () => page.evaluate(view => {
      const hook = view === 'llll' ? (window as any).__LPW__ : (window as any).__LLL_PJSK__
      const duration = view === 'llll' ? hook.player.audioDuration : hook.player.getAudioSources().bgm?.duration ?? null
      return { duration, video: hook.musicVideo.useVideoBackground }
    }, view)
    await expect.poll(snapshot).toMatchObject({ video: true })
    const initial = await snapshot()
    expect(initial.duration).toBeGreaterThan(0)
    await page.getByRole('button', { name: '媒体', exact: true }).click()
    for (const kind of ['audio', 'mv']) {
      await page.locator(`[data-media-kind="${kind}"] [data-media-clear]`).click()
      await expect(page.locator('[data-resource-loading]')).toBeHidden()
    }
    await expect.poll(snapshot).toEqual({ duration: null, video: false })
    await page.locator('[data-media-kind="audio"] [data-media-inherit]').click()
    await expect.poll(snapshot).toEqual({ duration: initial.duration, video: false })
    await page.locator('[data-media-kind="mv"] [data-media-inherit]').click()
    await expect.poll(snapshot).toEqual(initial)
    await expect(page.locator('#play')).toBeEnabled()
    await expect(page.locator('#chart-name')).toContainText('フォーチュン')
  })
}
