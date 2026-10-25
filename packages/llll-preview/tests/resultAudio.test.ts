import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultAudio, RESULT_AUDIO_URLS, RESULT_BGM_LOOP, type ResultAudioOutput, type ResultSeCue } from '../src/resultAudio';
import { ResultScreen, type ResultSnapshot } from '../src/resultScreen';

class AudioSpy implements ResultAudioOutput {
  events: string[] = [];
  counting = false;
  startBgm() { this.events.push('bgm'); }
  playSe(cue: ResultSeCue) { this.events.push(cue); }
  startCount() { this.counting = true; this.events.push('count'); }
  stopCount() { if (this.counting) this.events.push('stopCount'); this.counting = false; }
  stop() { this.stopCount(); this.events.push('stop'); }
}

const snapshot = (over: Partial<ResultSnapshot> = {}): ResultSnapshot => ({
  score: 1, technicalRaw: 101, userCombo: 1, judgements: [0, 0, 0, 0, 0, 1], conditions: [0, 0, 0],
  comboFlags: 3, remainMental: 1, scoreRank: 4, musicTitle: 'test', difficulty: 'MASTER', difficultyId: 4,
  difficultyLevel: 30, totalNoteCount: 1, enableFastSlow: true, ...over,
});

function advanceTo(screen: ResultScreen, phase: string) {
  for (let i = 0; i < 2000; i++) {
    if (screen.currentPhase === phase) return;
    screen.tick(1 / 60);
  }
  throw new Error('没有进入阶段：' + phase);
}

describe('结算声音编排', () => {
  it('BGM 在揭幕开始时播放，标题 SE 等待揭幕结束', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot(), {} as CanvasImageSource);
    expect(audio.events).toEqual(['stop', 'bgm']);
    screen.tick(0.299);
    expect(audio.events).not.toContain('title');
    screen.tick(0.002);
    expect(audio.events).toEqual(['stop', 'bgm', 'title']);
    advanceTo(screen, 'done');
    expect(audio.events.filter((e) => e === 'bgm')).toHaveLength(1);
    expect(audio.events.filter((e) => e === 'combo' || e === 'lamp')).toEqual(['combo', 'lamp']);
    screen.close();
    expect(audio.events.at(-1)).toBe('stop');
  });

  it('相邻计数重新起音；零值保持时长并静默', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot({ judgements: [0, 0, 0, 2, 0, 1] }));
    advanceTo(screen, 'score');
    expect(audio.counting).toBe(true);
    advanceTo(screen, 'technical');
    expect(audio.events.slice(-2)).toEqual(['stopCount', 'count']);
    advanceTo(screen, 'judgements');
    expect(audio.counting).toBe(true);
    screen.tick(0.201);
    expect(audio.counting).toBe(false);
    expect(screen.currentPhase).toBe('judgements');
    screen.tick(0.201);
    expect(audio.counting).toBe(true);
    expect(audio.events.slice(-2)).toEqual(['stopCount', 'count']);
  });

  it('全零成绩不发计数声，无旗标和灯更新时不发对应 SE', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot({ score: 0, technicalRaw: 0, userCombo: 0, judgements: [0, 0, 0, 0, 0, 0], comboFlags: 0, remainMental: 0 }));
    advanceTo(screen, 'score');
    screen.tick(0.49);
    expect(screen.currentPhase).toBe('score');
    expect(audio.counting).toBe(false);
    advanceTo(screen, 'done');
    expect(audio.events).toEqual(['stop', 'bgm', 'title']);
  });

  it('跳过停止计数但保留 BGM，不补发旗标和灯 SE', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot());
    advanceTo(screen, 'score');
    screen.skip();
    expect(audio.events.at(-1)).toBe('stopCount');
    expect(audio.events.filter((e) => e === 'stop')).toHaveLength(1);
    expect(audio.events).not.toContain('combo');
    expect(audio.events).not.toContain('lamp');
    screen.tick(10);
    expect(audio.events.filter((e) => e === 'bgm')).toHaveLength(1);
  });

  it('旗标 SE 已发出后跳过会保留单发音的自然尾音', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot());
    advanceTo(screen, 'comboFlag');
    const before = [...audio.events];
    screen.skip();
    expect(audio.events).toEqual(before);
    expect(audio.events.at(-1)).toBe('combo');
  });

  it('Rate 与 Increase 计数也逐段起停，完成后计数声停止', () => {
    const audio = new AudioSpy(), screen = new ResultScreen(audio);
    screen.open(snapshot({ rate: 305, rateIncrease: 5, playerRate: 8000, playerRateIncrease: 5 }));
    for (const phase of ['rate', 'rateInc', 'playerRate', 'playerRateInc']) {
      advanceTo(screen, phase);
      expect(audio.counting).toBe(true);
      expect(audio.events.slice(-2)).toEqual(['stopCount', 'count']);
    }
    advanceTo(screen, 'done');
    expect(audio.counting).toBe(false);
  });
});

class Source {
  buffer: AudioBuffer | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class Context {
  destination = {};
  sources: Source[] = [];
  gains: { gain: { value: number }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
  createGain() { const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }; this.gains.push(gain); return gain; }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  decodeAudioData = vi.fn(async () => ({ duration: 73 } as AudioBuffer));
  resume = vi.fn(async () => undefined);
}

afterEach(() => vi.unstubAllGlobals());

describe('结算 Web Audio 输出', () => {
  it('按原始样本循环，共用时钟但独立调整音乐和 SE 音量，关闭清理所有输出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]))));
    const context = new Context(), audio = new ResultAudio(context as unknown as AudioContext);
    await audio.load();
    audio.setMusicVolume(0.7); audio.setSeVolume(0.3);
    expect(context.gains.map((g) => g.gain.value)).toEqual([0.7, 0.3]);
    audio.startBgm(); audio.startBgm();
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({ loop: true, loopStart: RESULT_BGM_LOOP.start, loopEnd: RESULT_BGM_LOOP.end });
    expect(context.sources[0]!.connect).toHaveBeenCalledWith(context.gains[0]);
    audio.startCount(); audio.startCount();
    expect(context.sources).toHaveLength(2);
    expect(context.sources[1]).toMatchObject({ loop: true, loopStart: 0, loopEnd: 0.075 });
    expect(context.sources[1]!.connect).toHaveBeenCalledWith(context.gains[1]);
    audio.playSe('combo');
    audio.stopCount();
    expect(context.sources[1]!.stop).toHaveBeenCalledTimes(1);
    expect(context.sources[0]!.stop).not.toHaveBeenCalled();
    expect(context.sources[2]!.stop).not.toHaveBeenCalled();
    audio.dispose();
    expect(context.sources.every((s) => s.stop.mock.calls.length === 1 && s.disconnect.mock.calls.length === 1)).toBe(true);
    expect(context.gains.every((g) => g.disconnect.mock.calls.length === 1)).toBe(true);
    audio.startBgm();
    expect(context.sources).toHaveLength(3);
  });

  it('音频缺失时完成加载并静默跳过对应输出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const context = new Context();
    const audio = new ResultAudio(context as unknown as AudioContext);
    const progress = vi.fn();
    await expect(audio.load(progress)).resolves.toBeUndefined();
    for (const url of Object.values(RESULT_AUDIO_URLS)) {
      expect(progress).toHaveBeenCalledWith({ url, phase: 'ready', downloadedBytes: 0 });
    }
    const screen = new ResultScreen(audio);
    screen.open(snapshot());
    advanceTo(screen, 'done');
    screen.close();
    expect(context.sources).toHaveLength(0);
  });

  it.each(['HTTP 错误', '请求失败', '解码失败'])('%s 只影响对应音频，其余声音正常播放', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === RESULT_AUDIO_URLS.bgm) {
        if (failure === 'HTTP 错误') return new Response(null, { status: 404 });
        if (failure === '请求失败') throw new TypeError('Failed to fetch');
        return new Response(new Uint8Array([0]));
      }
      return new Response(new Uint8Array([1, 2]));
    }));
    const context = new Context();
    context.decodeAudioData.mockImplementation(async (bytes?: ArrayBuffer) => {
      if (bytes && new Uint8Array(bytes)[0] === 0) throw new DOMException('无效音频', 'EncodingError');
      return { duration: 73 } as AudioBuffer;
    });
    const audio = new ResultAudio(context as unknown as AudioContext);
    const progress = vi.fn();
    await expect(audio.load(progress)).resolves.toBeUndefined();
    const ready = progress.mock.calls.map(([entry]) => entry).filter(entry => entry.phase === 'ready');
    expect(ready).toHaveLength(Object.keys(RESULT_AUDIO_URLS).length);
    expect(ready.find(entry => entry.url === RESULT_AUDIO_URLS.bgm)).toMatchObject({
      downloadedBytes: failure === '解码失败' ? 1 : 0,
    });
    audio.startBgm();
    expect(context.sources).toHaveLength(0);
    audio.playSe('title');
    audio.playSe('combo');
    audio.playSe('lamp');
    audio.startCount();
    expect(context.sources).toHaveLength(4);
    expect(context.sources.every(source => source.start.mock.calls.length === 1)).toBe(true);
    audio.dispose();
  });
});
