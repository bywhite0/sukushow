import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

export const CHART_FIXTURE_PATH = fileURLToPath(new URL('./fixtures/custom-chart.json', import.meta.url));

/** 独立来源不绑定默认歌曲，音符与媒体由测试明确提供。 */
export async function openChartFixture(page: Page) {
  await page.goto('/?chart=/fixture-missing.json');
  await expect(page.locator('#source-status')).toContainText('来源加载失败');
  await page.locator('#chart-file').setInputFiles(CHART_FIXTURE_PATH);
  await expect(page.locator('#chart-name')).toHaveText('custom-chart.json');
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
}
