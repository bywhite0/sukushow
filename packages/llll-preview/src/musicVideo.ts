import type { Transport } from './transport';

export type MusicVideoLoadProgress = {
  phase: 'download' | 'ready';
  downloadedBytes: number;
  totalBytes?: number;
};

/** 静音 MV 只提供画面；音乐和走带仍由 AudioPlayer 控制。 */
export class MusicVideo {
  private video: HTMLVideoElement | null = null;
  private url: string | null = null;
  private start = 0;
  private clipDuration = Infinity;
  private enabled = false;
  private exporting = false;
  private failed = false;
  private videoBackground = false;
  private loadPromise: Promise<boolean> | null = null;
  private resolveLoad: ((loaded: boolean) => void) | null = null;
  private disposeVideo: (() => void) | null = null;
  private loadProgress: ((progress: MusicVideoLoadProgress) => void) | null = null;
  private loadTotalBytes: number | undefined;
  private readonly waiters = new Set<() => void>();

  constructor(private readonly invalidate: () => void) {}

  get useVideoBackground(): boolean {
    return this.videoBackground;
  }

  setUrl(
    url: string | null,
    start = 0,
    clipDuration = Infinity,
    onProgress?: (progress: MusicVideoLoadProgress) => void,
    totalBytes?: number,
  ): Promise<boolean> {
    if (this.url === url && this.start === start && this.clipDuration === clipDuration) {
      onProgress?.({
        phase: this.videoBackground ? 'ready' : 'download',
        downloadedBytes: this.videoBackground ? (totalBytes ?? 0) : 0,
        totalBytes,
      });
      return this.loadPromise ?? Promise.resolve(this.videoBackground);
    }
    this.url = url;
    this.start = start;
    this.clipDuration = clipDuration;
    this.loadProgress = onProgress ?? null;
    this.loadTotalBytes = totalBytes;
    return this.open();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled && this.url) void this.open();
    else if (!enabled) void this.open();
  }

  private readonly notify = (): void => {
    for (const waiter of this.waiters) waiter();
    this.invalidate();
  };

  private readonly onError = (): void => {
    this.finishLoad(false);
  };

  private reportProgress(phase: 'download' | 'ready', downloadedBytes: number): void {
    this.loadProgress?.({
      phase,
      downloadedBytes,
      totalBytes: this.loadTotalBytes,
    });
  }

  private finishLoad(loaded: boolean): void {
    this.failed = !loaded;
    if (loaded) this.videoBackground = true;
    const downloadedBytes = loaded ? (this.loadTotalBytes ?? 0) : 0;
    this.reportProgress('ready', downloadedBytes);
    this.resolveLoad?.(loaded);
    this.resolveLoad = null;
    this.notify();
  }

  private open(): Promise<boolean> {
    this.disposeVideo?.();
    this.disposeVideo = null;
    this.resolveLoad?.(false);
    this.resolveLoad = null;
    this.video = null;
    this.loadPromise = null;
    this.failed = false;
    this.videoBackground = false;
    this.notify();
    if (!this.enabled || !this.url) {
      this.loadPromise = Promise.resolve(false);
      return this.loadPromise;
    }

    const video = document.createElement('video');
    let settled = false;
    this.loadPromise = new Promise<boolean>((resolve) => {
      this.resolveLoad = resolve;
    });
    const settle = (loaded: boolean): void => {
      if (settled || this.video !== video) return;
      settled = true;
      this.finishLoad(loaded);
    };
    const onProgress = (): void => {
      let downloadedBytes = 0;
      if (video.duration > 0 && video.buffered.length > 0) {
        downloadedBytes = Math.round((video.buffered.end(video.buffered.length - 1) / video.duration) * (this.loadTotalBytes ?? 0));
      }
      this.reportProgress('download', downloadedBytes);
    };
    const onLoadedData = (): void => settle(true);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('progress', onProgress);
    video.addEventListener('seeked', this.notify);
    video.addEventListener('error', this.onError);
    this.disposeVideo = () => {
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('seeked', this.notify);
      video.removeEventListener('error', this.onError);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
    this.reportProgress('download', 0);
    video.src = this.url;
    this.video = video;
    video.load();
    this.invalidate();
    return this.loadPromise;
  }

  private ready(video: HTMLVideoElement): boolean {
    return !this.failed && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
  }

  frame(time: number): HTMLVideoElement | null {
    const video = this.video;
    if (!video || !this.ready(video) || video.seeking) return null;
    const movieTime = time - this.start;
    const inRange = movieTime >= 0 && movieTime < this.clipDuration && movieTime < video.duration;
    if (!inRange) return null;
    return Math.abs(video.currentTime - movieTime) < .2 ? video : null;
  }

  sync(time: number, playing: boolean, rate: Transport['rate']): void {
    const video = this.video;
    if (!video || this.exporting || this.failed) return;
    const movieTime = time - this.start;
    const active = this.ready(video) && movieTime >= 0 && movieTime < this.clipDuration && movieTime < video.duration;
    if (!active || !playing) {
      if (!video.paused) video.pause();
    }
    if (!active) return;
    if (video.playbackRate !== rate) video.playbackRate = rate;
    if (Math.abs(video.currentTime - movieTime) > (playing ? .2 : .04) && !video.seeking) video.currentTime = movieTime;
    if (playing && video.paused) void video.play().catch(() => { if (this.video === video) this.notify(); });
  }

  beginExport(): void {
    this.exporting = true;
    this.video?.pause();
  }

  async seekFrame(time: number, signal?: AbortSignal): Promise<HTMLVideoElement | null> {
    const video = this.video;
    const movieTime = time - this.start;
    if (!video || this.failed || signal?.aborted || movieTime < 0 || movieTime >= this.clipDuration) return null;
    while (this.video === video && !this.failed && !this.ready(video)) {
      if (!await this.wait(video, signal)) return null;
    }
    if (this.video !== video || this.failed || signal?.aborted || movieTime >= video.duration) return null;
    if (video.seeking || Math.abs(video.currentTime - movieTime) > .001) {
      video.currentTime = movieTime;
      do {
        if (!await this.wait(video, signal)) return null;
      } while (this.video === video && !this.failed && video.seeking);
    }
    return this.video === video && this.ready(video) && !signal?.aborted ? video : null;
  }

  private wait(video: HTMLVideoElement, signal?: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal?.aborted) { resolve(false); return; }
      const done = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', done);
        this.waiters.delete(done);
        resolve(this.video === video && !this.failed && !signal?.aborted);
      };
      const timeout = setTimeout(() => {
        this.failed = true;
        done();
        this.invalidate();
      }, 15_000);
      this.waiters.add(done);
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  endExport(): void {
    this.exporting = false;
    this.notify();
  }

  dispose(): void {
    this.enabled = false;
    void this.open();
  }
}
