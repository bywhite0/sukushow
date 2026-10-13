import { test, expect } from '@playwright/test'

for (const [button, input] of [['open-cover', 'cover-file'], ['open-mv', 'mv-file']]) {
  test(`${button} 打开对应本地文件选择器`, async ({ page }) => {
    await page.goto('/?song=missing')
    await page.getByRole('button', { name: '媒体', exact: true }).click()
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 })
    await page.locator(`#${button}`).click()
    expect(await (await chooser).element().getAttribute('id')).toBe(input)
  })
}

for (const view of ['llll', 'pjsk']) {
  test(`${view} 文件入口由共享壳层持有且一次点击只打开一次选择器`, async ({ page }) => {
    await page.goto(`/?view=${view}&song=missing`)
    await expect.poll(() => page.evaluate(view => view === 'llll'
      ? Boolean((window as any).__LPW__)
      : Boolean((window as any).__LLL_PJSK__), view)).toBe(true)
    for (const [button, input] of [['open-chart', 'chart-file'], ['open-audio', 'audio-file']]) {
      if (button === 'open-audio') await page.getByRole('button', { name: '媒体', exact: true }).click()
      const calls = await page.locator(`#${input}`).evaluate((node, button) => {
        let calls = 0
        const original = (node as HTMLInputElement).click
        ;(node as HTMLInputElement).click = () => { calls++ }
        document.getElementById(button)!.click()
        ;(node as HTMLInputElement).click = original
        return calls
      }, button)
      expect(calls).toBe(1)
    }
  })
}

test('曲绘解码失败在工具栏显示错误，不需要打开元数据对话框', async ({ page }) => {
  await page.goto('/?song=missing')
  await expect(page.locator('#source-status')).toContainText('来源加载失败')
  await page.locator('#cover-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') })
  await expect(page.locator('#source-status')).toContainText('文件读取失败')
  await expect(page.locator('#metadata-dialog')).not.toBeVisible()
  await expect(page.locator('#cover-file')).toHaveValue('')
})
