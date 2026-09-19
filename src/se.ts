/**
 * SeResolver — preview port of RhythmGame.RhythmGameMain.SeResolver (SE_SYSTEM.md).
 * Cue sheet: `public/se/*.wav` exported from `rhythm.acb` (vgmstream).
 * User volume is an output-layer multiply (CRI category in original).
 */

import type { Chart, Note } from './chart';
import { noteJudgementTimes } from './chart';
import type { NoteJudgementType } from './rgOptions';

/** Binary cue ids inside rhythm.acb (not vgmstream stream index). */
export const SE_CUE = {
  flick: 4,
  hold: 5,
  bad: 6,
  good: 7,
  great: 8,
  perfect: 9,
  trace: 10,
  finish1: 11,
  finish2: 12,
  finish3: 13,
  finish4: 14,
  start: 21,
  touch: 22,
} as const;

const CUE_FILE: Record<number, string> = {
  [SE_CUE.flick]: 'se_rhythm_flick_0001',
  [SE_CUE.hold]: 'se_rhythm_hold_0001',
  [SE_CUE.bad]: 'se_rhythm_tap_bad_0001',
  [SE_CUE.good]: 'se_rhythm_tap_good_0001',
  [SE_CUE.great]: 'se_rhythm_tap_great_0001',
  [SE_CUE.perfect]: 'se_rhythm_tap_perfect_0001',
  [SE_CUE.trace]: 'se_rhythm_trace_0001',
  [SE_CUE.finish1]: 'se_rhythm_finish_0001',
  [SE_CUE.finish2]: 'se_rhythm_finish_0002',
  [SE_CUE.finish3]: 'se_rhythm_finish_0003',
  [SE_CUE.finish4]: 'se_rhythm_finish_0004',
  [SE_CUE.start]: 'se_rhythm_start_0001',
  [SE_CUE.touch]: 'se_rhythm_touch_0001',
};

/** AddSingle: `(uint)(type−1)<3 ? type+5 : 9` (Bad/Good/Great → 6/7/8, else Perfect). */
export function cueIndexForJudgement(type: NoteJudgementType): number {
  const u = (type - 1) >>> 0;
  return u < 3 ? type + 5 : SE_CUE.perfect;
}

export function cueFileName(index: number): string | undefined {
  return CUE_FILE[index];
}

/** |Δ| < 0.004 — ChartNoteLineComparer.IsSameTime. */
export const LINE_HASH_SAME_TIME = 0.004;

type LineEvent = { time: number; isStart: boolean; uid: number };

/**
 * ChartBuilder.AssignLineHashes / GetLines grouping:
 * non-hold → (Just, start, uid); hold head → head Just + (end, !start, tailUid);
 * groups with Count≥2 get Hash = trunc(keyTime × 1e7).
 */
export function buildLineHashTables(chart: Chart): {
  first: Map<number, number>;
  second: Map<number, number>;
} {
  const first = new Map<number, number>();
  const second = new Map<number, number>();
  const events: LineEvent[] = [];
  for (const note of chart.roots) {
    if (note.type !== 1) {
      events.push({ time: note.time, isStart: true, uid: note.uid });
      continue;
    }
    let tail = note;
    while (tail.next) tail = tail.next;
    const end = tail.holds.length ? tail.holds[tail.holds.length - 1]! : tail.end;
    events.push({ time: note.time, isStart: true, uid: note.uid });
    events.push({ time: end, isStart: false, uid: tail.uid });
  }
  events.sort((a, b) => a.time - b.time || a.uid - b.uid);

  const used = new Array(events.length).fill(false);
  for (let i = 0; i < events.length; i++) {
    if (used[i]) continue;
    const group = [i];
    used[i] = true;
    const keyTime = events[i]!.time;
    for (let j = i + 1; j < events.length; j++) {
      if (used[j]) continue;
      if (Math.abs(events[j]!.time - keyTime) < LINE_HASH_SAME_TIME) {
        group.push(j);
        used[j] = true;
      } else if (events[j]!.time - keyTime >= LINE_HASH_SAME_TIME) {
        break;
      }
    }
    if (group.length < 2) continue;
    if (group.some((gi) => events[gi]!.uid === 0)) continue;
    const hash = Math.trunc(keyTime * 1e7);
    if (hash < 1) continue;
    for (const gi of group) {
      const ev = events[gi]!;
      if (ev.isStart) first.set(ev.uid, hash);
      else second.set(ev.uid, hash);
    }
  }
  return { first, second };
}

export interface SeOutput {
  play(cueIndex: number, volume: number): void;
  startHold(volume: number): void;
  stopHold(): void;
  pauseHold(): void;
  resumeHold(): void;
  setTapVolume(v: number): void;
  setSeVolume(v: number): void;
  dispose(): void;
}

/** Web Audio one-shots + looping hold. Shares context with BGM when provided. */
export class WebAudioSeOutput implements SeOutput {
  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly master: GainNode;
  private readonly tapGain: GainNode;
  private readonly seGain: GainNode;
  private holdSource: AudioBufferSourceNode | null = null;
  private holdGain: GainNode | null = null;
  private loadPromise: Promise<void> | null = null;
  private disposed = false;
  private ownContext: boolean;

  constructor(readonly context: AudioContext, ownContext = false) {
    this.ownContext = ownContext;
    this.master = context.createGain();
    this.tapGain = context.createGain();
    this.seGain = context.createGain();
    this.tapGain.connect(this.master);
    this.seGain.connect(this.master);
    this.master.connect(context.destination);
    this.tapGain.gain.value = 1;
    this.seGain.gain.value = 1;
  }

  static create(context?: AudioContext): WebAudioSeOutput {
    if (context) return new WebAudioSeOutput(context, false);
    return new WebAudioSeOutput(new AudioContext(), true);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      await Promise.all(
        Object.entries(CUE_FILE).map(async ([idx, name]) => {
          const i = Number(idx);
          try {
            const res = await fetch(`/se/${name}.wav`);
            if (!res.ok) return;
            const buf = await this.context.decodeAudioData(await res.arrayBuffer());
            this.buffers.set(i, buf);
          } catch {
            /* missing cue is non-fatal in preview */
          }
        }),
      );
    })();
    return this.loadPromise;
  }

  private busFor(cueIndex: number): GainNode {
    if (cueIndex === SE_CUE.start || (cueIndex >= SE_CUE.finish1 && cueIndex <= SE_CUE.finish4)) {
      return this.seGain;
    }
    return this.tapGain;
  }

  play(cueIndex: number, volume: number): void {
    if (this.disposed) return;
    const buf = this.buffers.get(cueIndex);
    if (!buf) return;
    void this.context.resume();
    const src = this.context.createBufferSource();
    const g = this.context.createGain();
    g.gain.value = Math.max(0, volume);
    src.buffer = buf;
    src.connect(g);
    g.connect(this.busFor(cueIndex));
    src.start();
  }

  startHold(volume: number): void {
    if (this.disposed || this.holdSource) return;
    const buf = this.buffers.get(SE_CUE.hold);
    if (!buf) return;
    void this.context.resume();
    const src = this.context.createBufferSource();
    const g = this.context.createGain();
    g.gain.value = Math.max(0, volume);
    src.buffer = buf;
    src.loop = true;
    src.connect(g);
    g.connect(this.tapGain);
    src.start();
    this.holdSource = src;
    this.holdGain = g;
  }

  stopHold(): void {
    if (!this.holdSource) return;
    try {
      this.holdSource.stop();
    } catch {
      /* already stopped */
    }
    this.holdSource.disconnect();
    this.holdGain?.disconnect();
    this.holdSource = null;
    this.holdGain = null;
  }

  pauseHold(): void {
    if (this.holdGain) this.holdGain.gain.value = 0;
  }

  resumeHold(): void {
    if (this.holdGain) this.holdGain.gain.value = 1;
  }

  setTapVolume(v: number): void {
    this.tapGain.gain.value = Math.max(0, Math.min(1, v));
  }

  setSeVolume(v: number): void {
    this.seGain.gain.value = Math.max(0, Math.min(1, v));
  }

  dispose(): void {
    this.disposed = true;
    this.stopHold();
    this.master.disconnect();
    if (this.ownContext) void this.context.close();
  }
}

export function createWebAudioSeOutput(context?: AudioContext): WebAudioSeOutput {
  return WebAudioSeOutput.create(context);
}

export class SeResolver {
  private readonly unitMap: Array<Set<number>> = [new Set(), new Set(), new Set()];
  private currentFrame = 0;
  private holdCount = 0;
  private holdPlayback = false;
  defaultSourceVolume = 1;

  constructor(private readonly output: SeOutput) {}

  /** MainLogic frame head. */
  process(): void {
    this.currentFrame = (this.currentFrame + 1) % 3;
    this.unitMap[this.currentFrame]!.clear();
    this.holdCount = 0;
  }

  getVolume(lineHash: number): number {
    const vol = this.defaultSourceVolume;
    if (lineHash < 1) return vol;
    const cur = this.unitMap[this.currentFrame]!;
    if (cur.has(lineHash)) return vol;
    const prev1 = this.unitMap[(this.currentFrame + 2) % 3]!;
    const prev2 = this.unitMap[(this.currentFrame + 1) % 3]!;
    if (prev1.has(lineHash) || prev2.has(lineHash)) return vol * 1.5;
    return vol;
  }

  private playImpl(index: number, vol: number): void {
    this.output.play(index, vol);
  }

  addSingle(type: NoteJudgementType, lineHash: number): void {
    const seIndex = cueIndexForJudgement(type);
    const vol = this.getVolume(lineHash);
    this.playImpl(seIndex, vol);
    if (lineHash >= 1) this.unitMap[this.currentFrame]!.add(lineHash);
  }

  addFlick(lineHash: number): void {
    const vol = this.getVolume(lineHash);
    this.playImpl(SE_CUE.flick, vol);
    if (lineHash >= 1) this.unitMap[this.currentFrame]!.add(lineHash);
  }

  addTrace(): void {
    this.playImpl(SE_CUE.trace, this.defaultSourceVolume);
  }

  addEmptyTouch(): void {
    this.playImpl(SE_CUE.touch, this.defaultSourceVolume);
  }

  addHold(): void {
    this.holdCount++;
  }

  /** MainLogic frame tail. */
  applyHold(): void {
    if (this.holdCount >= 1 && !this.holdPlayback) {
      this.output.startHold(this.defaultSourceVolume);
      this.holdPlayback = true;
    } else if (this.holdCount === 0 && this.holdPlayback) {
      this.output.stopHold();
      this.holdPlayback = false;
    }
  }

  playStart(): void {
    this.playImpl(SE_CUE.start, this.defaultSourceVolume);
  }

  /** ComboResultSeNames: AP→0004 … Finish→0001 (index 0..3). */
  playFinish(kind: 0 | 1 | 2 | 3): void {
    const ids = [SE_CUE.finish4, SE_CUE.finish3, SE_CUE.finish2, SE_CUE.finish1] as const;
    this.playImpl(ids[kind]!, this.defaultSourceVolume);
  }

  clear(): void {
    this.currentFrame = 0;
    for (const s of this.unitMap) s.clear();
    if (this.holdPlayback) {
      this.output.stopHold();
      this.holdPlayback = false;
    }
    this.holdCount = 0;
  }

  pause(): void {
    if (this.holdPlayback) this.output.pauseHold();
  }

  resume(): void {
    if (this.holdPlayback) this.output.resumeHold();
  }
}

export type AutoPlaySeHit = {
  noteType: number;
  lineHash: number;
  isHoldTail: boolean;
};

/** Collect AutoPlay SE events in (previousTime, time]. */
export function collectAutoPlaySeHits(
  chart: Chart,
  previousTime: number,
  time: number,
  hashes: { first: Map<number, number>; second: Map<number, number> },
): AutoPlaySeHit[] {
  const out: AutoPlaySeHit[] = [];
  for (let i = 0; i < chart.notes.length; i++) {
    const note = chart.notes[i]!;
    const times = noteJudgementTimes(note, chart.bpms);
    if (!times.length) continue;
    const last = times[times.length - 1]!;
    for (let j = 0; j < times.length; j++) {
      const t = times[j]!;
      if (!(previousTime < t && time >= t)) continue;
      const isHoldTail = note.type === 1 && t === last;
      let lineHash = 0;
      if (isHoldTail) {
        let tail: Note = note;
        while (tail.next) tail = tail.next;
        lineHash = hashes.second.get(tail.uid) ?? 0;
      } else {
        lineHash = hashes.first.get(note.uid) ?? 0;
      }
      out.push({ noteType: note.type, lineHash, isHoldTail });
    }
  }
  return out;
}

/** Active hold windows for AutoPlay AddHold (head Just ≤ time < end). */
export function countActiveHolds(chart: Chart, time: number): number {
  let n = 0;
  for (const note of chart.roots) {
    if (note.type !== 1) continue;
    let tail = note;
    while (tail.next) tail = tail.next;
    const end = tail.holds.length ? tail.holds[tail.holds.length - 1]! : tail.end;
    if (note.time <= time && time < end) n++;
  }
  return n;
}

/**
 * AutoPlay SE dispatch (NOTE_STATE_MACHINES):
 * Single/Hold samples → AddSingle; Flick → AddFlick; AutoTrace → AddSingle (not AddTrace).
 */
export function dispatchAutoPlaySe(
  se: SeResolver,
  hits: AutoPlaySeHit[],
  judgement: NoteJudgementType,
  activeHolds: number,
): void {
  for (const h of hits) {
    if (h.noteType === 2) se.addFlick(h.lineHash);
    else se.addSingle(judgement, h.lineHash);
  }
  for (let i = 0; i < activeHolds; i++) se.addHold();
}
