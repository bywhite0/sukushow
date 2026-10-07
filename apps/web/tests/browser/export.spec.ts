import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

// 编码与资源预热会争用 GPU；总预算需覆盖下面的 60 秒条件等待。
test.setTimeout(120_000);

/** 开发服务器以 /@fs/ 提供工作区包源码；与应用导入的 @sukushow/llll-preview/se 是同一模块实例。 */
const SE_MODULE_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/llll-preview/src/se.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

async function prepare(page: Page) {
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#timeline').evaluate((node: HTMLInputElement) => {
    node.value = '5'; node.dispatchEvent(new Event('input'));
  });
  await page.locator('#rate').selectOption('2');
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '5.0000');
  await page.locator('#export-video').click();
  await page.locator('[name="resolution"]').selectOption('720p');
  await page.locator('[name="fps"]').selectOption('30');
  await page.locator('[name="opening"]').uncheck();
  await page.locator('[name="start"]').fill('2');
  await page.locator('[name="end"]').fill('2.2');
  await expect(page.locator('[data-start]')).toBeEnabled();
}

async function restored(page: Page) {
  await expect(page.locator('[data-cancel]')).toBeHidden();
  await page.locator('[data-close]').click();
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#rate')).toHaveValue('2');
  await expect(page.locator('#chart-canvas')).toHaveAttribute('data-time', '5.0000');
  await expect(page.locator('#stage-canvas')).not.toHaveClass(/exporting/);
}

test('30 fps 导出将音效推进到片段终点，下载后恢复预览', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async (url) => {
    const { CapturingSeOutput } = await import(url);
    const finish = CapturingSeOutput.prototype.finish;
    CapturingSeOutput.prototype.finish = function(end: number) {
      (window as any).__audioEnd = end;
      return finish.call(this, end);
    };
  }, SE_MODULE_URL);
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-progress-text]')).toContainText('6 帧 / 0.20 秒');
  expect(await page.evaluate(() => (window as any).__audioEnd)).toBeCloseTo(2.2, 9);
  const download = page.waitForEvent('download');
  await page.locator('[data-download]').click();
  expect((await download).suggestedFilename()).toMatch(/1280x720_30fps\.mp4$/);
  await restored(page);
});

test('取消导出后恢复位置、倍率及控件，允许重试', async ({ page }) => {
  await prepare(page);
  await page.locator('[name="end"]').fill('30');
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-cancel]')).toBeVisible();
  await page.locator('[data-cancel]').click();
  await expect(page.locator('[data-progress-text]')).toHaveText('已取消。', { timeout: 60_000 });
  await expect(page.locator('[data-download]')).toBeHidden();
  await restored(page);
  await page.locator('#export-video').click();
  await expect(page.locator('[data-start]')).toBeEnabled();
});

test('编码失败后恢复预览并显示失败原因', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    VideoEncoder.prototype.encode = (frame) => {
      (window as any).__failedFrame = frame;
      throw new Error('测试编码失败');
    };
  });
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-progress-text]')).toContainText('测试编码失败', { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__failedFrame.codedWidth)).toBe(0);
  await expect(page.locator('[data-download]')).toBeHidden();
  await restored(page);
});

test('音频编码失败时释放采样资源并恢复预览', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    AudioEncoder.prototype.encode = (data) => {
      (window as any).__failedAudio = data;
      throw new Error('测试音频编码失败');
    };
  });
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-progress-text]')).toContainText('测试音频编码失败', { timeout: 60_000 });
  expect(await page.evaluate(() => (window as any).__failedAudio.numberOfFrames)).toBe(0);
  await expect(page.locator('[data-download]')).toBeHidden();
  await restored(page);
});

test('空区间拒绝导出且不锁住预览', async ({ page }) => {
  await prepare(page);
  await page.locator('[name="end"]').fill('2');
  await page.locator('[data-start]').click();
  await expect(page.locator('[data-support]')).toContainText('导出区间为空');
  await restored(page);
});

test('包含开场时起点停在开场开头，取消勾选回到 0，再勾选拉回开场开头', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('就绪');
  await page.locator('#export-video').click();
  const opening = page.locator('[name="opening"]');
  const start = page.locator('[name="start"]');
  await expect(opening).toBeChecked();
  await expect(start).toHaveValue('-3.667');
  await expect(start).toHaveAttribute('min', '-3.667');
  await opening.uncheck();
  await expect(start).toHaveValue('0');
  await expect(start).toHaveAttribute('min', '0');
  await opening.check();
  await expect(start).toHaveValue('-3.667');
});
