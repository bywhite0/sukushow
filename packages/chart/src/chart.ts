/**
 * 原格式谱面解析。
 *
 * 游戏的谱面文件都是 raw-deflate 压缩的 JSON，字段见 `parseChart`。也接受未压缩的 JSON 文本，
 * 供前端打开本地 `.json`（解压后或手写的谱面）。
 * 解压用 fflate 的同步实现，浏览器与 Node 都能直接调用。
 */

import { Inflate } from 'fflate';

export interface Note {
  uid: number;
  /** 判定时刻（秒）。 */
  time: number;
  /** 最后一个 hold 端点（无 hold 时等于 time）。 */
  end: number;
  /** hold 端点数组，升序。 */
  holds: number[];
  /** 0 Single / 1 Hold / 2 Flick / 3 Trace。 */
  type: number;
  l: number;
  r: number;
  l2: number;
  r2: number;
  /** 串链后继 / 前驱（同 (l,r) 桶内按 Uid 递增 + float32 容差）。 */
  next?: Note;
  prev?: Note;
}

/** 同时押组：同一判定时刻的音符（含 Hold 的头与尾）。 */
export interface Line {
  time: number;
  points: { note: Note; tail: boolean }[];
}

export interface Bpm { time: number; bpm: number }
export interface Beat { numerator: number; denominator: number; time: number }

export interface Chart {
  notes: Note[];
  /** 链首（无 prev 的音符）。 */
  roots: Note[];
  /** 同时押组（只保留点数 > 1 的）。 */
  lines: Line[];
  bpms: Bpm[];
  beats: Beat[];
  offset: number;
  /**
   * 谱面总时长（秒）：末音符终点 + 2 秒余量。
   *
   * 这是没有曲目元数据时的兜底。节奏游戏的曲终取 `Musics.PlayTime / 1000`（见 `songTiming`）。
   */
  duration: number;
  /**
   * 最大连击数——口径同 `chartAllNoteSize`。
   *
   * 非 Hold 每个算 1；Hold **只算链首**，链首本身 1 + 判定航点数：单段 Hold 用 JSON
   * 的 `holds`，多段链用 `getHolds` 按半拍重采样。链中节点不计（它们由链首的航点覆盖）。
   *
   * 全量 616 张实测与 `MusicScores.yaml` 的 `MaxCombo` **全部一致**（`getHolds` 按原版 float32 口径，
   * 见其注释）。标注仍优先用权威 `MaxCombo`，此值供无主数据时兜底与自检。
   */
  maxCombo: number;
}

const MAX_BYTES = 16 * 1024 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('谱面字段必须是对象');
  return value as Record<string, unknown>;
}

export function number(value: unknown, label: string): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) throw new Error(`${label} 必须是数字`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} 必须是有限数`);
  return n;
}

function parseNote(value: unknown): Note {
  const v = object(value);
  const uid = number(v.Uid, 'Uid'), time = number(v.just, 'just'), f = number(v.Flags, 'Flags');
  if (!Number.isInteger(uid) || uid < 0 || uid > 65535 || !Number.isInteger(f) || f < 0 || f > 0xfffffff || time < 0 || time > 86400) throw new Error('音符编号、时间或 Flags 越界');
  const type = f & 15, r = (f >>> 4) & 63, r2 = (f >>> 10) & 63, l = (f >>> 16) & 63, l2 = (f >>> 22) & 63;
  if (type > 3 || [l, r, l2, r2].some(x => x > 59) || l > r || (type === 1 && l2 > r2)) throw new Error('音符类型或轨道范围无效');
  if (v.holds !== undefined && !Array.isArray(v.holds)) throw new Error('holds 必须是数组');
  const holds = ((v.holds ?? []) as unknown[]).map(x => number(x, 'holds'));
  if (holds.some((x, i) => x < (i ? holds[i - 1] : time) || x > 86400) || (type === 1 && !holds.length)) throw new Error('Hold 端点不得倒序或早于起点');
  return { uid, time, end: holds.at(-1) ?? time, holds, type, l, r, l2, r2 };
}

/**
 * 取 Time ≤ t 的最后一段；早于首段则取首段（读谱/出图用的宽松口径）。
 *
 * 注意：判定航点重采样**不用它**——原版 `RhythmGameConsts.Get` 早于首段时回落到**最后一段**，
 * 见 `bpmGetF32`。
 */
export function bpmAt(bpms: Bpm[], time: number): number {
  if (!bpms.length) return 120;
  let cur = bpms[0].bpm;
  for (let i = 0; i < bpms.length; i++) {
    if (time >= bpms[i].time) cur = bpms[i].bpm;
    else break;
  }
  return cur;
}

/** 拍号段：取 Time ≤ t 的最后一段。 */
export function beatAt(beats: Beat[], time: number): Beat {
  const fallback: Beat = { numerator: 4, denominator: 4, time: 0 };
  if (!beats.length) return fallback;
  let cur = beats[0];
  for (const b of beats) {
    if (time >= b.time) cur = b;
    else break;
  }
  return cur;
}

const f32 = Math.fround;

/**
 * `RhythmGameConsts.LooseEquals` @0x485CF1C：单精度 `fabd(x, y) < 9.9999997e-5f`
 * （容差字面量 @0x1AA0E84 = 0x38D1B717）。串链与航点重采样共用。
 * 原版在 C# float 域比较，故两侧压回 float32、差值也压回 float32 再比；
 * 用 double 容差会漏连（|Δ| 恰好落在 1e-4 两侧）。
 */
const LOOSE_EPSILON = f32(0.0001);
const looseEquals = (a: number, b: number): boolean => f32(Math.abs(f32(a) - f32(b))) < LOOSE_EPSILON;

/** 同时押分组容差：4 ms。 */
export const SIMULTANEOUS_WINDOW = 0.004;

export function parseChart(input: unknown): Chart {
  const data = object(input);
  if (!Array.isArray(data.Notes) || !Array.isArray(data.Bpms)) throw new Error('需要 Notes 和 Bpms 数组');
  if (data.Notes.length > 50000) throw new Error('谱面超过 50000 个音符');

  const notes = data.Notes.map(parseNote);
  const ids = new Set<number>();
  for (const n of notes) {
    if (ids.has(n.uid)) throw new Error(`重复 Uid：${n.uid}`);
    ids.add(n.uid);
  }

  const bpms = data.Bpms.map(v => {
    const b = object(v), time = number(b.Time, 'BPM 时间'), bpm = number(b.Bpm, 'BPM');
    if (Math.abs(time) > 86400 || bpm <= 0 || bpm > 10000) throw new Error('BPM 无效');
    return { time, bpm };
  }).sort((a, b) => a.time - b.time);

  const beats: Beat[] = Array.isArray(data.Beats) ? (data.Beats as unknown[]).map(v => {
    const b = object(v);
    return { numerator: number(b.Numerator, '拍号分子'), denominator: number(b.Denominator, '拍号分母'), time: number(b.Time, '拍号时间') };
  }).sort((a, b) => a.time - b.time) : [];

  const offset = data.Offset === undefined ? 0 : number(data.Offset, 'Offset');

  // ChartResolver.Prepare @0x48694A4 Pass1：按数组顺序对每个 unit 取
  // FirstOrDefault(units, IsCombine(prev, x))，命中即 prev.Next = x; x.Prev = prev（后写覆盖，允许汇合，
  // Prev 只作非根标记）。IsCombine @0x485CFFC：两者 Type==Hold、x.Uid > prev.Uid、prev.L2==x.L1、
  // prev.R2==x.R1、LooseEquals(prev.Holds[^1], x.Just)。**不看段长**：零长段（holds[^1]==just，
  // 链中的横向瞬移点）照样串进链里。按 (l,r) 分桶只是加速，桶内仍保持数组顺序。
  const starts = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.type !== 1) continue;
    const key = `${n.l}/${n.r}`;
    const bucket = starts.get(key) ?? [];
    bucket.push(n);
    starts.set(key, bucket);
  }
  for (const n of notes) {
    if (n.type !== 1) continue;
    const next = starts.get(`${n.l2}/${n.r2}`)?.find(x => x.uid > n.uid && looseEquals(n.end, x.time));
    if (next) { n.next = next; next.prev = n; }
  }

  const roots = notes.filter(n => !n.prev);
  const groups: Line[] = [];
  const add = (note: Note, tail: boolean, time: number) => {
    let g = groups.find(g => Math.abs(g.time - time) < SIMULTANEOUS_WINDOW);
    if (!g) { g = { time, points: [] }; groups.push(g); }
    g.points.push({ note, tail });
  };
  for (const root of roots) {
    add(root, false, root.time);
    if (root.type !== 1) continue;
    let tail = root;
    while (tail.next) tail = tail.next;
    add(tail, true, tail.end);
  }
  const lines = groups.filter(g => g.points.length > 1 && g.points.every(p => p.note.uid !== 0));

  // 最大连击：非 Hold 各 1；Hold 只算链首（1 + 判定航点），链中节点不计。
  let maxCombo = 0;
  for (const root of roots) {
    if (root.type !== 1) { maxCombo++; continue; }
    let tail = root;
    while (tail.next) tail = tail.next;
    maxCombo += 1 + (tail === root ? root.holds.length : getHolds(root.time, tail.end, bpms).length);
  }

  return { notes, roots, lines, bpms, beats, offset, duration: Math.max(1, ...notes.map(n => n.end + 2)), maxCombo };
}

/** 解 raw-deflate 压缩的谱面；以 `{` 开头的按未压缩的 JSON 文本处理。 */
export function decodeChart(bytes: Uint8Array): Chart {
  if (bytes.byteLength > MAX_BYTES) throw new Error('谱面文件超过 16 MiB');
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  const text = head.startsWith('{') ? new TextDecoder().decode(bytes) : inflateRaw(bytes);
  return parseChart(JSON.parse(text.replace(/^\ufeff/, '')));
}

/**
 * `RhythmGameConsts.Get(bpms, time)` @0x485D410，float32 口径：
 * 顺序扫相邻两段，返回首个 `prev.StartTime <= time && cur.StartTime > time` 的 prev；
 * 扫完没命中（含 time 早于首段）返回**最后一段**。Bpm 为 int（`ChartBpmUnit.Bpm`）。
 */
function bpmGetF32(bpms: Bpm[], time: number): number {
  if (!bpms.length) return 120; // 原版返回 null 后 NRE；这里兜底
  for (let i = 0; i + 1 < bpms.length; i++) {
    if (f32(bpms[i].time) <= time && f32(bpms[i + 1].time) > time) return bpms[i].bpm;
  }
  return bpms[bpms.length - 1].bpm;
}

/**
 * 多段链的判定点（不含起点）——`RhythmGameConsts.GetHolds` @0x485D11C（4.12.0 逐指令核对），
 * **全部 float32 运算**：
 * ```
 * holds.Clear();
 * if (start < end) do {
 *   start += (60f / (float)Get(bpms, start).Bpm) * 0.5f;   // fdiv / fmul / fadd 均为单精度
 *   if (start > end) break;
 *   if (LooseEquals(start, end)) break;                     // fabd(single) < 9.9999997e-5f
 *   holds.Add(start);
 * } while (start < end);
 * if (holds.Count > 0 && (long)(|end − holds[^1]| * 10000f) <= 1) holds.RemoveAt(^1);  // fcvtzs 截断
 * holds.Add(end);
 * ```
 * start/end 来自 `Just` / `Holds`（`Single.Parse` 的 float）。此前这里用 double 累加半拍步长、
 * 循环内用 `2e-4` 容差：`204103_04` 少 1（循环内容差比原版 `LooseEquals` 宽）、`405138_04` 少 2
 * （84.6s 的连续变速段上 double 累加与 float32 分岔）。改成 float32 后全量 616 张与主数据一致。
 *
 * 原版 Pass2 只对多段链头重采样，单段 Hold 保留 JSON 端点。
 */
export function getHolds(start: number, end: number, bpms: Bpm[]): number[] {
  const out: number[] = [];
  let t = f32(start);
  const e = f32(end);
  if (t < e) {
    for (let guard = 0; guard < 1_000_000; guard++) {
      const step = f32(f32(60 / f32(bpmGetF32(bpms, t))) * 0.5);
      t = f32(t + step);
      if (t > e) break;
      if (looseEquals(t, e)) break;
      out.push(t);
      if (!(t < e)) break;
    }
  }
  if (out.length) {
    const v = f32(f32(Math.abs(e - out[out.length - 1])) * 10_000);
    // fcvtzs 截断后比较 `<= 1`；+Inf 跳过删除。
    if (v !== Infinity && Math.trunc(v) <= 1) out.pop();
  }
  out.push(e);
  return out;
}

/**
 * 一个链首贡献的判定点数（含起点）。
 *
 * 链中节点（有 `prev`）不计——判定点只按链首算，这正是原版 Prepare Pass2 的语义。
 * 单段 Hold 用 JSON 里的 `holds`；多段链用 `getHolds(起点, 链尾终点)` 重算。
 */
export function noteJudgementTimes(note: Note, bpms: Bpm[]): number[] {
  if (note.prev) return [];
  if (note.type !== 1) return [note.time];
  let tail = note;
  while (tail.next) tail = tail.next;
  if (tail === note) return [note.time, ...note.holds];
  const end = tail.holds.length ? tail.holds[tail.holds.length - 1] : tail.end;
  return [note.time, ...getHolds(note.time, end, bpms)];
}

/**
 * Prepare 之后的 `AllNoteSize`：全谱判定点总数，即**最大连击数**（max combo）。
 *
 * 实测对全量 616 张谱面与主数据 `MusicScores.yaml` 的 `*MaxCombo` 比对：全部一致。
 * 显示 combo 时**优先用主数据的 `*MaxCombo`**（那是权威值），这个函数用于谱面内逐点计数与校验。
 * 空谱返回 1，供计分时做分母。
 */
export function chartAllNoteSize(chart: Chart): number {
  let n = 0;
  for (const root of chart.roots) n += noteJudgementTimes(root, chart.bpms).length;
  return Math.max(1, n);
}

function inflateRaw(bytes: Uint8Array): string {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stream = new Inflate(chunk => {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error('解压后的谱面超过 16 MiB');
    chunks.push(chunk);
  });
  // 分块推入：超限时在解压途中就抛出，不必先解出整份。
  for (let i = 0; i < bytes.length; i += 1024) stream.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}
