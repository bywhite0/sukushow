/** 结算音频：与歌曲共用 AudioContext，音乐和 SE 分别接现有音量设置。 */
import { readResponseBytes, type DownloadProgress } from './resourceDownload';

export const RESULT_AUDIO_URLS = {
  bgm: '/assets/audio/bgm_rhythm_result_0001.ogg',
  title: '/se/se_rhythm_result_0001.wav',
  combo: '/se/se_rhythm_result_0002.wav',
  lamp: '/se/se_rhythm_result_0003.wav',
  count: '/se/se_ui_gaugeup_0001.wav',
} as const;

/** 原始 HCA 样本点，48 kHz；完整音轨来自外置 AWB。 */
export const RESULT_BGM_LOOP = { start: 165924 / 48000, end: 3491628 / 48000 } as const;
export type ResultSeCue = 'title' | 'combo' | 'lamp';
export type ResultAudioLoadProgress = DownloadProgress & { url: string };

/** 由结算编排驱动，跳过只停计数声，关闭结算停止全部输出。 */
export interface ResultAudioOutput {
  startBgm(): void;
  playSe(cue: ResultSeCue): void;
  startCount(): void;
  stopCount(): void;
  stop(): void;
}

export class ResultAudio implements ResultAudioOutput {
  private buffers = new Map<keyof typeof RESULT_AUDIO_URLS, AudioBuffer>();
  private musicGain: GainNode;
  private seGain: GainNode;
  private bgm: AudioBufferSourceNode | null = null;
  private count: AudioBufferSourceNode | null = null;
  private oneShots = new Set<AudioBufferSourceNode>();
  private ready: Promise<void> | null = null;
  private disposed = false;

  constructor(readonly context: AudioContext) {
    this.musicGain = context.createGain();
    this.seGain = context.createGain();
    this.musicGain.connect(context.destination);
    this.seGain.connect(context.destination);
  }

  load(onProgress?: (progress: ResultAudioLoadProgress) => void): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = Promise.all(Object.entries(RESULT_AUDIO_URLS).map(async ([key, url]) => {
      let downloadedBytes = 0;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const bytes = await readResponseBytes(response, (progress) => {
          downloadedBytes = progress.downloadedBytes;
          if (progress.phase === 'download') onProgress?.({ url, ...progress });
        });
        const buffer = await this.context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
        if (!this.disposed) this.buffers.set(key as keyof typeof RESULT_AUDIO_URLS, buffer);
      } catch {
        // 缺失或解码失败的结算音频只跳过对应输出。
      } finally {
        onProgress?.({ url, phase: 'ready', downloadedBytes });
      }
    })).then(() => undefined);
    return this.ready;
  }

  setMusicVolume(value: number): void { this.musicGain.gain.value = Math.max(0, Math.min(1, value)); }
  setSeVolume(value: number): void { this.seGain.gain.value = Math.max(0, Math.min(1, value)); }

  private source(key: keyof typeof RESULT_AUDIO_URLS, gain: GainNode): AudioBufferSourceNode | null {
    const buffer = this.buffers.get(key);
    if (!buffer) return null;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    return source;
  }

  startBgm(): void {
    if (this.disposed || this.bgm) return;
    const source = this.source('bgm', this.musicGain);
    if (!source) return;
    source.loop = true;
    source.loopStart = RESULT_BGM_LOOP.start;
    source.loopEnd = RESULT_BGM_LOOP.end;
    this.bgm = source;
    void this.context.resume();
    source.start();
  }

  playSe(cue: ResultSeCue): void {
    if (this.disposed) return;
    const source = this.source(cue, this.seGain);
    if (!source) return;
    this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); source.disconnect(); };
    source.start();
  }

  startCount(): void {
    if (this.disposed || this.count) return;
    const source = this.source('count', this.seGain);
    if (!source) return;
    // 原 cue 自带 0..3600 @48 kHz 循环；导出只含一个循环，不含解码器的重复与淡出。
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = 3600 / 48000;
    this.count = source;
    source.start();
  }

  private stopSource(source: AudioBufferSourceNode): void {
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  stopCount(): void {
    if (this.count) this.stopSource(this.count);
    this.count = null;
  }

  stop(): void {
    this.stopCount();
    if (this.bgm) this.stopSource(this.bgm);
    this.bgm = null;
    for (const source of this.oneShots) this.stopSource(source);
    this.oneShots.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.musicGain.disconnect();
    this.seGain.disconnect();
    this.buffers.clear();
  }
}
