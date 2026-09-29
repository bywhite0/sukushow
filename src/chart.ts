/**
 * 原格式谱面解析——口径与 llll-preview-web / llll-flat-preview 一致，本仓库独立持有实现。
 *
 * 源文件是 raw-deflate 压缩的 JSON（少数已是明文），字段见 `parseChart`。
 */

import { inflateRawSync } from 'node:zlib';

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
  /** 谱面总时长（秒），末音符终点 + 2 秒余量。 */
  duration: number;
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

/** BpmMath.Get：取 Time ≤ t 的最后一段；早于首段则取首段。 */
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

/**
 * 串链判据与原版同律：原版在 C# float 域比较，故两侧压回 float32 再比。
 * 用 double 容差会漏连（|Δ| 恰好落在 1e-4 两侧）。
 */
const HOLD_LINK_EPSILON = Math.fround(0.0001);

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

  // 按 (l,r) 分桶，Uid 递增 + float32 容差判连；允许汇合，Prev 只作非根标记。
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
    const end = Math.fround(n.end);
    const next = starts.get(`${n.l2}/${n.r2}`)?.find(x => x.uid > n.uid && Math.abs(Math.fround(x.time) - end) < HOLD_LINK_EPSILON);
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

  return { notes, roots, lines, bpms, beats, offset, duration: Math.max(1, ...notes.map(n => n.end + 2)) };
}

/** 解 raw-deflate（Node 原生 zlib）或已是 JSON 文本的谱面。 */
export function decodeChartBytes(bytes: Uint8Array): Chart {
  if (bytes.byteLength > MAX_BYTES) throw new Error('谱面文件超过 16 MiB');
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart();
  const text = head.startsWith('{') ? new TextDecoder().decode(bytes) : inflateRaw(bytes);
  return parseChart(JSON.parse(text.replace(/^\ufeff/, '')));
}

function inflateRaw(bytes: Uint8Array): string {
  // 走 node:zlib；本仓库是 CLI/构建期工具，不需要浏览器路径。
  const out = inflateRawSync(bytes, { maxOutputLength: MAX_BYTES });
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}
