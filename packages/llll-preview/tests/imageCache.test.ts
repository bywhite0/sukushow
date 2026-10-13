import { afterEach, expect, it, vi } from 'vitest';
import { image, preloadImages, releaseImages } from '../src/canvasKit';

afterEach(() => vi.unstubAllGlobals());

it('释放曲绘缓存后移除图片来源，再次请求重新加载', async () => {
  const created: any[] = [];
  vi.stubGlobal('Image', class {
    naturalWidth = 2;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    decode = async () => {};
    removeAttribute() { this.src = ''; }
    constructor() { created.push(this); }
  });
  const loaded = preloadImages(['blob:cover']);
  created[0].onload();
  await loaded;
  expect(image('blob:cover')).toBe(created[0]);
  releaseImages(['blob:cover']);
  expect(created[0].src).toBe('');
  expect(image('blob:cover')).toBeNull();
  expect(created).toHaveLength(2);
  releaseImages(['blob:cover']);
});

it('释放尚未加载的曲绘也结束等待，重复释放安全', async () => {
  vi.stubGlobal('Image', class {
    src = '';
    removeAttribute() { this.src = ''; }
  });
  const pending = preloadImages(['blob:pending']);
  releaseImages(['blob:pending']);
  releaseImages(['blob:pending']);
  await pending;
});
