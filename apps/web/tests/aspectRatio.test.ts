import { describe, expect, it } from 'vitest';
import { ASPECT_PRESETS, aspectRatioOf, fitAspect, isAspectId } from '../src/views/llll/aspectRatio';
import { sanitizePreviewSettings, DEFAULT_PREVIEW_SETTINGS } from '../src/views/llll/settingsPersist';

describe('fitAspect', () => {
  it('区域更宽时按高度定尺寸', () => {
    expect(fitAspect(1600, 600, 4 / 3)).toEqual({ width: 800, height: 600 });
  });
  it('区域更窄时按宽度定尺寸', () => {
    expect(fitAspect(900, 900, 16 / 9)).toEqual({ width: 900, height: 506 });
  });
  it('结果不超出区域，且比例误差在 1px 内', () => {
    for (const p of ASPECT_PRESETS) {
      if (p.ratio === null) continue;
      for (const [w, h] of [[1234, 567], [390, 320], [1920, 1080], [1000, 1000]]) {
        const f = fitAspect(w, h, p.ratio);
        expect(f.width).toBeLessThanOrEqual(w);
        expect(f.height).toBeLessThanOrEqual(h);
        expect(Math.abs(f.width - f.height * p.ratio)).toBeLessThanOrEqual(p.ratio + 1);
      }
    }
  });
  it('无效输入给 0', () => {
    expect(fitAspect(0, 100, 2)).toEqual({ width: 0, height: 0 });
    expect(fitAspect(100, 100, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('比例预设', () => {
  it('ID 与比例一致', () => {
    expect(aspectRatioOf('free')).toBeNull();
    expect(aspectRatioOf('19.5:9')).toBeCloseTo(19.5 / 9, 12);
    expect(aspectRatioOf('4:3')).toBeCloseTo(4 / 3, 12);
    expect(isAspectId('20:9')).toBe(true);
    expect(isAspectId('21:9')).toBe(false);
  });
  it('设置里持久化，非法值回落到自由', () => {
    expect(DEFAULT_PREVIEW_SETTINGS.aspectRatio).toBe('free');
    expect(sanitizePreviewSettings({ aspectRatio: '16:10' }).aspectRatio).toBe('16:10');
    expect(sanitizePreviewSettings({ aspectRatio: '3:2' }).aspectRatio).toBe('free');
  });
});
