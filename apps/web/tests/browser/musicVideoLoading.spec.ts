import { expect, test } from '@playwright/test';

test('MV 资源加入曲目加载进度并在就绪后隐藏加载层', async ({ page, request }) => {
  const list = await (await request.get('/song-list.json')).json();
  const song = list.songs.find((entry: any) => entry.id === '103103');
  const chart = await request.get(`/assets/chart/${song.charts.MASTER}`);
  const mv = await request.get('/assets/mv/103103.mp4', { method: 'HEAD' });
  test.skip(!chart.ok() || !mv.ok(), '本地曲目谱面 / MV 尚未解包');
  await page.goto('/?song=103103&difficulty=MASTER');
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#message')).toContainText('MV ✓');
});
