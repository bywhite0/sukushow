import { openChartFixture } from './chartFixture';
import { test, expect } from '@playwright/test';

// 首次点击要取回 7 张音符贴图再排版，给足时间。
test.setTimeout(90_000);

test('导出 SVG 在新标签页以 blob URL 打开自包含矢量谱面', async ({ page }) => {
  await openChartFixture(page);
  const button = page.locator('#export-svg');
  await expect(button).toBeEnabled();

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    button.click(),
  ]);
  // 新标签页直接指向 blob URL：不落盘、不经过服务端。
  await expect.poll(() => popup.url()).toMatch(/^blob:/);
  await expect(page.locator('#message')).toContainText('已在新标签页打开 SVG 谱面');

  const content = await popup.content();
  expect(content.startsWith('<svg')).toBe(true);
  // 标签页标题读根元素的 <title>，否则标签上只剩一串 UUID。
  expect(content).toContain('<title>custom-chart.json</title>');
  // 贴图内嵌成 data URI，单张 SVG 离开本页也能看。
  expect(content).toContain('data:image/png;base64,');
  // 长曲按目标长宽比切列，每列一个嵌套 <svg>；小节线来自谱面的 BPM / 拍号。
  expect(content).toContain('class="col"');
  expect(content).toContain('class="bar-line"');
  // 底部信息区：标题上方一行小字（难度 + 谱面预览），标题与演唱者同处一行。
  expect(content).toContain('class="meta-eyebrow"');
  expect(content).toContain('>谱面预览</text>');
});

test('窄屏下 SVG 导出独占一行，不挤出视口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await openChartFixture(page);
  const box = (await page.locator('#export-svg').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  // 窄屏两个导出按钮都只剩图标会分不清，SVG 这一行保留文字。
  await expect(page.locator('#export-svg > span')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('没有谱面时 SVG 导出不可用，PJSK 模式不提供该按钮', async ({ page }) => {
  await page.goto('/?chart=/fixture-missing.json');
  await expect(page.locator('#source-status')).toContainText('来源加载失败');
  await expect(page.locator('#export-svg')).toBeDisabled();

  await page.goto('/?view=pjsk&chart=/fixture-missing.json');
  await expect(page.locator('#source-status')).toContainText('来源加载失败');
  await expect(page.locator('#export-video')).toBeAttached();
  await expect(page.locator('#export-svg')).toHaveCount(0);
});
