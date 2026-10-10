import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicVideo, type MusicVideoLoadProgress } from '../src/musicVideo';

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
