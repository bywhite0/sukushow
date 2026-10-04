import { expect, test } from '@playwright/test';

test('LLLL 舞台通过同一 3D 渲染器切换相机角度', async ({ page }) => {
  await page.goto('/?view=llll');
  const stage = page.locator('#stage');
  const glCanvas = page.locator('#chart-canvas');
  const stageCanvas = page.locator('#stage-canvas');

  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  const threeDAngle = Number(await glCanvas.getAttribute('data-camera-angle'));
  await expect(stageCanvas).toHaveAttribute('aria-hidden', 'false');

  // The visible stage is a 2D compositor target. Skip the idle intro before
  // checking that the existing LLLL edge line made it through the WebGL copy.
  await page.locator('#play').click();
  await expect.poll(() => stageCanvas.getAttribute('data-intro'), { timeout: 8_000 }).toBe('');
  const visibleStagePixels = () => stageCanvas.evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = Math.floor(i / 4 / canvas.width);
      if (y > canvas.height * 0.25 && data[i] > 220 && data[i + 1] < 100 && data[i + 2] > 120) count++;
    }
    return count;
  });
  await expect.poll(visibleStagePixels, { timeout: 2_000 }).toBeGreaterThan(100);

  await stage.locator('button[data-stage-mode="2d"]').click();
  await expect(stage).toHaveAttribute('data-stage-mode', '2d');
  await expect(stage.locator('button[data-stage-mode="2d"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '2d');
  const twoDAngle = Number(await glCanvas.getAttribute('data-camera-angle'));
  expect(twoDAngle).not.toBe(threeDAngle);
  expect(twoDAngle).toBeCloseTo(-Math.PI / 2, 3);
  await expect(stageCanvas).toHaveAttribute('aria-hidden', 'false');

  await stage.locator('button[data-stage-mode="3d"]').click();
  await expect(glCanvas).toHaveAttribute('data-camera-mode', '3d');
  await expect(stage).toHaveAttribute('data-stage-mode', '3d');
});
