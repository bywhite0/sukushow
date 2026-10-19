import { test, expect } from '@playwright/test'

test('自制谱编辑器读取实际标题并保留已保存元数据', async ({ page }) => {
  await page.goto('/?chart=/unused.json')
  await expect(page.locator('#chart-name')).toBeVisible()
  await page.locator('#chart-file').setInputFiles({ name: 'my-chart.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })) })
  await expect(page.locator('#chart-name')).toHaveText('my-chart.json')
  await page.locator('#edit-metadata').focus()
  await page.locator('#edit-metadata').press('Enter')
  await expect(page.locator('#metadata-dialog [name="title"]')).toHaveValue('my-chart.json')
  await page.locator('#metadata-dialog [name="title"]').fill('我的谱面')
  await page.locator('#metadata-dialog [name="scoreCreator"]').fill('谱师')
  await page.locator('#metadata-dialog button[type="submit"]').click()
  await expect(page.locator('#chart-name')).toHaveText('我的谱面')
  await page.locator('#edit-metadata').focus()
  await page.locator('#edit-metadata').press('Enter')
  await expect(page.locator('#metadata-dialog [name="title"]')).toHaveValue('我的谱面')
  await expect(page.locator('#metadata-dialog [name="scoreCreator"]')).toHaveValue('谱师')
})

test('没有自制谱时不可编辑元数据', async ({ page }) => {
  await page.goto('/?chart=/unused.json')
  await expect(page.locator('#edit-metadata')).toBeDisabled()
})
