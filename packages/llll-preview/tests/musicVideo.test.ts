import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicVideo, type MusicVideoLoadProgress } from '../src/musicVideo';

// hls.js 用假实现替身：只关心「有没有挂载、有没有销毁、致命错误是否上报」。
const { hlsInstances } = vi.hoisted(() => ({ hlsInstances: [] as FakeHls[] }));

class FakeHls {
  static supported = true;
  static isSupported = () => FakeHls.supported;
  destroyed = false;
  loadedSource = '';
  attachedMedia: unknown = null;
  private handlers = new Map<string, (event: string, data: { fatal?: boolean }) => void>();
  constructor(public readonly config?: Record<string, unknown>) { hlsInstances.push(this); }
  destroy() { this.destroyed = true; }
  loadSource(url: string) { this.loadedSource = url; }
  attachMedia(media: unknown) { this.attachedMedia = media; }
  on(event: string, callback: (event: string, data: { fatal?: boolean }) => void) {
    this.handlers.set(event, callback);
  }
  emit(event: string, data: { fatal?: boolean }) { this.handlers.get(event)?.(event, data); }
}

vi.mock('hls.js', () => ({ default: FakeHls }));

/** 模拟浏览器是否原生支持 HLS（Safari 与 Chrome 142+ 支持，Firefox / Edge 不支持）。 */
let nativeHls = false;

class FakeVideo extends EventTarget {
  src = '';
  muted = false;
  playsInline = false;
  preload = '';
  readyState = 0;
  videoWidth = 1920;
  videoHeight = 1088;
  duration = 30;
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  seeking = false;
  error: MediaError | null = null;
  buffered = { length: 0, start: () => 0, end: () => 0 } as TimeRanges;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute = vi.fn(() => { this.src = ''; });
  canPlayType = (type: string) => (nativeHls && type.includes('mpegurl') ? 'maybe' : '');
  frame(time: number) {
    this.currentTime = time;
    this.seeking = false;
    this.dispatchEvent(new Event('seeked'));
  }
  loaded() {
    this.readyState = 2;
    this.buffered = { length: 1, start: () => 0, end: () => this.duration } as TimeRanges;
    this.dispatchEvent(new Event('loadedmetadata'));
    this.dispatchEvent(new Event('loadeddata'));
  }
}

let videos: FakeVideo[];
const create = () => videos.at(-1)!;

beforeEach(() => {
  videos = [];
  hlsInstances.length = 0;
  nativeHls = false;
  FakeHls.supported = true;
  vi.stubGlobal('document', { createElement: () => {
    const video = new FakeVideo();
    videos.push(video);
    return video;
  } });
});
afterEach(() => vi.unstubAllGlobals());

describe('MusicVideo', () => {
  it('loads only when enabled and releases the previous song on change or disable', () => {
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103103.mp4');
    expect(videos).toHaveLength(0);
    mv.setEnabled(true);
    expect(create().src).toBe('/assets/mv/103103.mp4');
    expect(create().muted).toBe(true);
    expect(create().playsInline).toBe(true);
    const previous = create();
    mv.setUrl('/assets/mv/103106.mp4');
    expect(previous.pause).toHaveBeenCalled();
    expect(previous.src).toBe('');
    expect(create().src).toBe('/assets/mv/103106.mp4');
    mv.setEnabled(false);
    expect(create().src).toBe('');
    expect(mv.frame(1)).toBeNull();
    mv.dispose();
  });

  it('reports MV loading and exposes a permanent video-background mode after success', async () => {
    const progress: MusicVideoLoadProgress[] = [];
    const mv = new MusicVideo(() => {});
    mv.setEnabled(true);
    const ready = mv.setUrl('/assets/mv/103103.mp4', 0, 30, (state) => progress.push(state), 100);
    expect(mv.useVideoBackground).toBe(false);
    create().loaded();
    expect(await ready).toBe(true);
    expect(mv.useVideoBackground).toBe(true);
    expect(progress.at(-1)).toEqual({ phase: 'ready', downloadedBytes: 100, totalBytes: 100 });
    mv.dispose();
  });

  it('keeps video-background mode while the current frame is unavailable', async () => {
    const mv = new MusicVideo(() => {});
    mv.setEnabled(true);
    const ready = mv.setUrl('/assets/mv/103103.mp4', 2, 3);
    create().loaded();
    expect(await ready).toBe(true);
    expect(mv.frame(1.5)).toBeNull();
    expect(mv.useVideoBackground).toBe(true);
    mv.dispose();
  });

  it('does not change video loading state when a movie frame is unavailable after success', async () => {
    const mv = new MusicVideo(() => {});
    mv.setEnabled(true);
    const ready = mv.setUrl('/assets/mv/103103.mp4', 2, 3);
    create().loaded();
    expect(await ready).toBe(true);
    expect(mv.useVideoBackground).toBe(true);
    mv.dispose();
  });

  it('syncs playing, pause, preroll and rate to the music clock without audio', () => {
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103103.mp4');
    mv.setEnabled(true);
    const video = create();
    video.loaded();
    mv.sync(-1, true, 1);
    expect(video.play).not.toHaveBeenCalled();
    mv.sync(0, true, 1.5);
    expect(video.playbackRate).toBe(1.5);
    expect(video.play).toHaveBeenCalledTimes(1);
    video.currentTime = 2;
    mv.sync(10, false, 1);
    expect(video.pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(10);
    video.frame(10);
    expect(mv.frame(10)).toBe(video);
    mv.dispose();
  });

  it('uses the original movie track start instead of chart zero for preview and export', async () => {
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103106.mp4', 2.133333, 3);
    mv.setEnabled(true);
    const video = create();
    video.loaded();
    mv.sync(2, true, 1);
    expect(video.play).not.toHaveBeenCalled();
    expect(mv.frame(2)).toBeNull();
    mv.sync(3, false, 1);
    expect(video.currentTime).toBeCloseTo(.866667, 5);
    video.frame(.866667);
    expect(mv.frame(3)).toBe(video);
    mv.beginExport();
    const pending = mv.seekFrame(4);
    expect(video.currentTime).toBeCloseTo(1.866667, 5);
    video.frame(1.866667);
    expect(await pending).toBe(video);
    expect(mv.frame(5.2)).toBeNull();
    expect(await mv.seekFrame(5.2)).toBeNull();
    mv.dispose();
  });

  it('returns fallback when unavailable or failed and invalidates when frames become ready', () => {
    const refresh = vi.fn();
    const mv = new MusicVideo(refresh);
    mv.setUrl('/assets/mv/103103.mp4');
    mv.setEnabled(true);
    const video = create();
    expect(mv.frame(0)).toBeNull();
    video.loaded();
    expect(refresh).toHaveBeenCalled();
    expect(mv.frame(0)).toBe(video);
    video.dispatchEvent(new Event('error'));
    expect(mv.frame(0)).toBeNull();
    expect(mv.useVideoBackground).toBe(true);
    mv.dispose();
  });

  it('waits for the target video frame on export, handles preroll and restores live sync', async () => {
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103103.mp4');
    mv.setEnabled(true);
    const video = create();
    video.loaded();
    mv.beginExport();
    expect(await mv.seekFrame(-1)).toBeNull();
    video.currentTime = 2;
    const frame = mv.seekFrame(10);
    expect(video.currentTime).toBe(10);
    video.frame(10);
    expect(await frame).toBe(video);
    mv.endExport();
    mv.sync(5, true, 1);
    expect(video.play).toHaveBeenCalled();
    mv.dispose();
  });

  it('stops waiting for stalled decoding and falls back to the normal background', async () => {
    vi.useFakeTimers();
    try {
      const mv = new MusicVideo(() => {});
      mv.setEnabled(true);
      mv.setUrl('/assets/mv/stalled.mp4');
      const pending = mv.seekFrame(3);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await pending).toBeNull();
      expect(await mv.seekFrame(4)).toBeNull();
      mv.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pending export seek immediately without disabling live MV', async () => {
    const mv = new MusicVideo(() => {});
    mv.setEnabled(true);
    mv.setUrl('/assets/mv/103103.mp4');
    const video = create();
    const controller = new AbortController();
    const pending = mv.seekFrame(3, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    video.loaded();
    expect(mv.frame(0)).toBe(video);
    mv.dispose();
  });

  it('does not wait forever if a missing or replaced MV fails during export', async () => {
    const mv = new MusicVideo(() => {});
    mv.setEnabled(true);
    mv.setUrl('/assets/mv/missing.mp4');
    const video = create();
    const frame = mv.seekFrame(2);
    video.dispatchEvent(new Event('error'));
    expect(await frame).toBeNull();
    expect(mv.frame(2)).toBeNull();
    mv.setUrl('/assets/mv/next.mp4');
    const pending = mv.seekFrame(3);
    mv.setUrl(null);
    expect(await pending).toBeNull();
    mv.dispose();
  });
});

describe('MusicVideo HLS', () => {
  it('优先用 hls.js，即使浏览器自称支持原生 HLS', async () => {
    // Chrome 142+ 自称支持 HLS，但对 206 分块会 DEMUXER_ERROR_COULD_NOT_PARSE，
    // 所以顺序必须是 hls.js 在前。
    nativeHls = true;
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103103/index.m3u8');
    mv.setEnabled(true);
    await vi.waitFor(() => expect(hlsInstances).toHaveLength(1));
    expect(hlsInstances[0]!.loadedSource).toBe('/assets/mv/103103/index.m3u8');
    expect(create().src).toBe('');
    mv.dispose();
  });

  it('hls.js 不支持时退回原生（Safari / iOS 走这条路）', async () => {
    nativeHls = true;
    FakeHls.supported = false;
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/104119/index.m3u8');
    mv.setEnabled(true);
    await vi.waitFor(() => expect(create().src).toBe('/assets/mv/104119/index.m3u8'));
    expect(hlsInstances).toHaveLength(0);
    mv.dispose();
  });

  it('hls.js 与原生都不可用时判定加载失败', async () => {
    nativeHls = false;
    FakeHls.supported = false;
    const mv = new MusicVideo(() => {});
    const loaded = mv.setUrl('/assets/mv/405206/index.m3u8');
    mv.setEnabled(true);
    await expect(loaded).resolves.toBe(false);
    mv.dispose();
  });

  it('原生不支持时用 hls.js 挂载（Firefox / Edge 走这条路）', async () => {
    nativeHls = false;
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/204105/index.m3u8');
    mv.setEnabled(true);
    await vi.waitFor(() => expect(hlsInstances).toHaveLength(1));
    const hls = hlsInstances[0]!;
    expect(hls.loadedSource).toBe('/assets/mv/204105/index.m3u8');
    expect(hls.attachedMedia).toBe(create());
    mv.dispose();
    expect(hls.destroyed).toBe(true);
  });

  it('hls.js 报致命错误时判定加载失败', async () => {
    nativeHls = false;
    const mv = new MusicVideo(() => {});
    const loaded = mv.setUrl('/assets/mv/204104/index.m3u8');
    mv.setEnabled(true);
    await vi.waitFor(() => expect(hlsInstances).toHaveLength(1));
    hlsInstances[0]!.emit('hlsError', { fatal: true });
    await expect(loaded).resolves.toBe(false);
    mv.dispose();
  });

  it('切换曲目时销毁上一首的 hls 实例', async () => {
    nativeHls = false;
    const mv = new MusicVideo(() => {});
    mv.setUrl('/assets/mv/103103/index.m3u8');
    mv.setEnabled(true);
    await vi.waitFor(() => expect(hlsInstances).toHaveLength(1));
    const first = hlsInstances[0]!;
    mv.setUrl('/assets/mv/103106/index.m3u8');
    expect(first.destroyed).toBe(true);
    await vi.waitFor(() => expect(hlsInstances).toHaveLength(2));
    mv.dispose();
  });
});
