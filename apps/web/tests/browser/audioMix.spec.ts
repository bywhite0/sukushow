import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

/** 开发服务器以 /@fs/ 提供工作区包源码。 */
const MIX_MODULE_URL = `/@fs/${fileURLToPath(new URL('../../../../packages/export/src/audioMix.ts', import.meta.url)).replace(/\\/g, '/').replace(/^\/+/, '')}`;

test('分段混音与整段混音逐样本一致', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (url) => {
    const { mixFrameCount, mixSegments, renderMixSegment } = await import(url);
    const sampleRate = 48000;
    const tone = (seconds: number, freq: number) => {
      const buffer = new AudioBuffer({ numberOfChannels: 2, length: Math.round(seconds * sampleRate), sampleRate });
      for (let c = 0; c < 2; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < data.length; i += 1) data[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sampleRate + c);
      }
      return buffer;
    };
    const input = {
      startSec: 1.25,
      durationSec: 7.4,
      sampleRate,
      channels: 2,
      bgm: tone(20, 220),
      bgmStartSec: 0.5,
      bgmVolume: 0.8,
      soundVolume: 0.9,
      soundBuffers: new Map([['tap', tone(0.4, 880)], ['hold', tone(0.5, 330)]]),
      events: [
        // 起点前开始的单发音、跨段边界的单发音、中途截断的单发音、起点前开始且跨多段的循环音（素材 > 6000 帧，带护边循环点）
        { type: 'oneShot', key: 'tap', gain: 1, startSec: 1.0, endSec: -1, offsetSec: 0 },
        { type: 'oneShot', key: 'tap', gain: 0.7, startSec: 2.5, endSec: -1, offsetSec: 0 },
        { type: 'oneShot', key: 'tap', gain: 0.5, startSec: 4.0, endSec: 4.1, offsetSec: 0 },
        { type: 'loop', key: 'hold', gain: 0.6, startSec: 0.8, endSec: 6.9, offsetSec: 0 },
      ],
    };
    const total = mixFrameCount(input.durationSec, sampleRate);
    const whole = await renderMixSegment(input, 0, total);
    let maxDiff = 0;
    let frames = 0;
    // 非整秒段长，让段边界落在事件中间
    for (const { startFrame, frameCount } of mixSegments(total, Math.round(1.3 * sampleRate))) {
      const part = await renderMixSegment(input, startFrame, frameCount);
      for (let c = 0; c < 2; c += 1) {
        const a = whole.getChannelData(c);
        const b = part.getChannelData(c);
        for (let i = 0; i < frameCount; i += 1) maxDiff = Math.max(maxDiff, Math.abs(a[startFrame + i] - b[i]));
      }
      frames += frameCount;
    }
    let peak = 0;
    for (let c = 0; c < 2; c += 1) for (const value of whole.getChannelData(c)) peak = Math.max(peak, Math.abs(value));
    return { total, frames, maxDiff, peak };
  }, MIX_MODULE_URL);
  expect(result.frames).toBe(result.total);
  expect(result.peak).toBeGreaterThan(0.3);
  expect(result.maxDiff).toBeLessThan(1e-4);
});
