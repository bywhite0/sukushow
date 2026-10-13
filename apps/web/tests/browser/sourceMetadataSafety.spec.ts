import { test, expect } from '@playwright/test'
import { deflateRawSync } from 'node:zlib'
import { CHART_FIXTURE_PATH } from './chartFixture'

for (const view of ['llll', 'pjsk']) {
  test(`${view} 取消编辑和文件选择不改变谱面，特殊标题仅作为文本`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled()
    await page.locator('#edit-metadata').click()
    await page.getByLabel('曲名', { exact: true }).fill('不应保存的标题')
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('#chart-name')).toHaveText('custom-chart.json')
    await page.locator('#chart-file').setInputFiles([])
    await expect(page.locator('#chart-name')).toHaveText('custom-chart.json')
    await page.locator('#edit-metadata').click()
    await expect(page.getByLabel('曲名', { exact: true })).toHaveValue('custom-chart.json')
    const title = '<img src=x onerror=alert(1)> & 特殊标题'
    await page.getByLabel('曲名', { exact: true }).fill(title)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('#chart-name')).toHaveText(title)
    await expect(page.locator('#chart-name img')).toHaveCount(0)
    await expect(page.locator('#play')).toBeEnabled()
  })

  test(`${view} 曲绘验证期间保存标题，验证完成不回滚元数据`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled()
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 2; canvas.height = 2
      const blob = await new Promise<Blob>(done => canvas.toBlob(value => done(value!), 'image/png'))
      const decode = HTMLImageElement.prototype.decode
      HTMLImageElement.prototype.decode = async function () {
        if (this.src.startsWith('blob:')) {
          await new Promise<void>(done => { (window as any).__releaseCover = done })
          HTMLImageElement.prototype.decode = decode
        }
        return decode.call(this)
      }
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    await page.locator('#cover-file').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: Buffer.from(png) })
    await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseCover)).toBe('function')
    await page.locator('#edit-metadata').click()
    await page.getByLabel('曲名', { exact: true }).fill('验证中保存的标题')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('#chart-name')).toHaveText('验证中保存的标题')
    await page.evaluate(() => (window as any).__releaseCover())
    await expect(page.locator('[data-media-kind="cover"] [data-media-status]')).toHaveText('pending.png')
    await expect(page.locator('[data-resource-loading]')).toBeHidden()
    await expect(page.locator('#chart-name')).toHaveText('验证中保存的标题')
    await expect(page.locator('#play')).toBeEnabled()
  })

  test(`${view} 换谱后旧编辑器拒绝保存，不污染新谱元数据`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH)
    await expect(page.locator('#play')).toBeEnabled()
    await page.locator('#edit-metadata').click()
    await page.getByLabel('曲名', { exact: true }).fill('旧谱编辑内容')
    await page.locator('#chart-file').setInputFiles({ name: 'new.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })),
    })
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.locator('[data-metadata-error]')).toContainText('来源已变化')
    await expect(page.locator('#metadata-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#chart-name')).toHaveText('new.json')
    await page.locator('#edit-metadata').click()
    await expect(page.getByLabel('曲名', { exact: true })).toHaveValue('new.json')
  })

  test(`${view} 实际文件入口支持压缩 bytes 并可重选同一文件`, async ({ page }) => {
    await page.goto(`/?view=${view}&chart=/missing.json`)
    await expect(page.locator('#source-status')).toContainText('来源加载失败')
    const chart = { Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] }
    const file = { name: 'compressed.bytes', mimeType: 'application/octet-stream', buffer: deflateRawSync(JSON.stringify(chart)) }
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.locator('#chart-file').setInputFiles(file)
      await expect(page.locator('#chart-name')).toHaveText('compressed.bytes')
      await expect(page.locator('#play')).toBeEnabled()
      await expect(page.locator('#chart-file')).toHaveValue('')
    }
  })
}
