import { expect, test } from '@playwright/test';

test('曲终时刻之后显示 AllPerfect 横幅，拖回之前隐藏', async ({ page }) => {
  await page.goto('/?song=103119&difficulty=MASTER');
  await expect(page.locator('#chart-name')).toContainText('MASTER', { timeout: 20000 });
  const root = page.locator('.combo-result');
  await expect(root).toBeHidden();
  const info = await page.evaluate(async () => {
    const list = await (await fetch('/song-list.json')).json();
    const song = list.songs.find((s: { id: string | number }) => String(s.id) === '103119');
    const tl = document.getElementById('timeline') as HTMLInputElement;
    return { playTime: song.playTime as number, max: Number(tl.max) };
  });
  const finish = info.playTime / 1000;
  expect(info.max).toBeGreaterThanOrEqual(finish + 4 - 1e-6);
  const seek = async (t: number) => page.evaluate((v) => {
    const tl = document.getElementById('timeline') as HTMLInputElement;
    tl.value = String(v);
    tl.dispatchEvent(new Event('input', { bubbles: true }));
  }, t);
  await seek(finish + 1.2);
  await expect(root).toBeVisible();
  await expect(page.locator('.cr-fx')).toHaveCSS('mix-blend-mode', 'plus-lighter');
  await seek(finish - 1);
  await expect(root).toBeHidden();
  await page.locator('#tab-display').click();
  await page.locator('#opt-combo-result').selectOption('2');
  await expect(root).toHaveAttribute('data-kind', '2');
  await seek(finish + 1.2);
  await expect(root).toBeVisible();
  await page.reload();
  await expect(page.locator('#opt-combo-result')).toHaveValue('2');
  await expect(page.locator('.combo-result')).toHaveAttribute('data-kind', '2');
});
