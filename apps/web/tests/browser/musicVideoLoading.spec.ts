import { expect, test } from '@playwright/test';

test('MV 资源加入曲目加载进度并在就绪后隐藏加载层', async ({ page, request }) => {
  const list = await (await request.get('/song-list.json')).json();
  const song = list.songs.find((entry: any) => entry.id === '103103');
  const chart = await request.get(`/assets/chart/${song.charts.MASTER}`);
  const mv = await request.get('/assets/mv/103103/index.m3u8');
  const mp4 = await request.get('/assets/mv/103103.mp4');
  const hasMv = (await mv.text()).startsWith('#EXTM3U')
    || (mp4.ok() && (mp4.headers()['content-type'] ?? '').startsWith('video/'));
  test.skip(!chart.ok() || !hasMv, '本地曲目谱面 / MV 尚未解包');
  await page.goto('/?song=103103&difficulty=MASTER');
  // 加载层初始就是隐藏的，先等曲目真正加载完，否则会误判成「已经就绪」。
  await expect(page.locator('#message')).toContainText('已加载', { timeout: 30_000 });
  await expect(page.locator('[data-resource-loading]')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#message')).toContainText('MV ✓');
});
