/**
 * 游玩模式的本地成绩库：结算界面 Rate / PlayerRate 的输入。
 *
 * 原版这两个值来自服务端存档（`missionInfo.TechnicalScoreBefore/After`、`UserDataRepository`
 * 的 CurrentPlayerRate），但公式是客户端本地的（`MusicInformation.GetRateByScore` @0x449BBF0、
 * `UserDataRepository.CalculatePlayerRate` @0x44A39E8，见 `@sukushow/llll-preview/rate`）。
 * 预览没有服务端，就把「谱面归属曲目 + 难度的历次成绩」存在 localStorage；Another Vocal
 * 沿用同一谱面归属曲目，因此共用历史。rows 是内存中的最佳通关成绩索引，每局同时冻结写入时的
 * Level / MaxCombo 作为 masterdata 快照（masterdata 静态时与「每次现取」等价）：
 * - 单曲 Rate = rateByScore(bestTechnical, masterdata Level, masterdata MaxCombo)；
 * - PlayerRate = 全部单曲 Rate 降序前 30 之和；
 * - 本局 before/after 的差值即 Rate / PlayerRate 的 Increase 行。
 *
 * 只影响预览显示，不改谱面；清浏览器存储即回到全新账号状态。
 */

import { playerRate, rateByScore } from '@sukushow/llll-preview/rate';

export const RESULT_RECORDS_KEY = 'sukushow:result-records:v1';

/**
 * 合法成绩键：`{谱面归属曲目 ID}:{难度}`（只写官方谱面，自制谱不写）。
 */
export const RESULT_RECORD_KEY_PATTERN = /^\d+:(NORMAL|HARD|EXPERT|MASTER)$/;

export function resultRecordKey(chartSongId: string, difficulty: string): string {
  return `${chartSongId.trim()}:${difficulty.trim().toUpperCase()}`;
}

export type ResultRecordIdentity = {
  /** 官方谱面实际归属的曲目 ID；Another Vocal 不使用它自己的曲目 ID。 */
  chartSongId: string;
  difficulty: string;
};

export type ResultRecordRow = {
  /** 本局技术分（TechnicalScoreResolver 的原始加权和）。 */
  technical: number;
  /** `MusicScores` 的 Level。 */
  level: number;
  /** `MusicScores` 的 MaxCombo（GetRateByScore 的归一化分母）。 */
  maxCombo: number;
  /** 本局成绩写入时间（Unix 毫秒）。 */
  recordedAt: number;
  /** 技术分百分比，例如 100.8280；Rate 仍使用 technical 原始加权和。 */
  technicalPercent: number;
  /** 结算分数。 */
  score: number;
  /** Miss..PerfectPlus 的六类判定计数。 */
  judgements: number[];
  /** 本局最大 Combo。 */
  userCombo: number;
  /** 每档 FAST / LATE / FLICK（六行，行序 Miss..PerfectPlus）。 */
  judgementConditions: number[][];
  /** 未通关的历史记录保留实际成绩，但不参与 Rate。 */
  cleared: boolean;
};

export type ResultHistoryRecord = ResultRecordRow & { id: string };

export type ResultRecordStore = {
  version: 1;
  rows: Record<string, ResultRecordRow>;
  history: Record<string, ResultHistoryRecord[]>;
};

export type PlayRecordInput = ResultRecordIdentity & {
  technical: number;
  level: number;
  maxCombo: number;
  recordedAt?: number;
  technicalPercent: number;
  score: number;
  judgements: readonly number[];
  userCombo: number;
  judgementConditions: readonly (readonly number[])[];
  cleared: boolean;
};

export type PlayRates = {
  rate: number;
  rateIncrease: number;
  playerRate: number;
  playerRateIncrease: number;
};

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

const finiteNonNegative = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

function sanitizeRow(raw: unknown): ResultRecordRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!finiteNonNegative(o.technical) || !finiteNonNegative(o.level) || !finiteNonNegative(o.maxCombo)
    || !finiteNonNegative(o.recordedAt) || o.recordedAt > 8.64e15 || !finiteNonNegative(o.technicalPercent)
    || !finiteNonNegative(o.score) || !finiteNonNegative(o.userCombo) || typeof o.cleared !== 'boolean'
    || !Array.isArray(o.judgements) || o.judgements.length !== 6 || !o.judgements.every(finiteNonNegative)
    || !Array.isArray(o.judgementConditions) || o.judgementConditions.length !== 6
    || !o.judgementConditions.every(counts => Array.isArray(counts) && counts.length === 3 && counts.every(finiteNonNegative))) return null;
  return {
    technical: Math.trunc(o.technical),
    level: Math.trunc(o.level),
    maxCombo: Math.trunc(o.maxCombo),
    recordedAt: Math.trunc(o.recordedAt),
    technicalPercent: o.technicalPercent,
    score: Math.trunc(o.score),
    judgements: o.judgements.map(value => Math.trunc(value)),
    userCombo: Math.trunc(o.userCombo),
    judgementConditions: o.judgementConditions.map(counts => counts.map((value: number) => Math.trunc(value))),
    cleared: o.cleared,
  };
}

export function emptyResultRecords(): ResultRecordStore {
  return { version: 1, rows: {}, history: {} };
}

/** 根据现存历史重算该谱面的最佳通关成绩，删除最佳局后可回到次佳。 */
function rebuildBest(store: ResultRecordStore, key: string): void {
  let best: ResultHistoryRecord | undefined;
  for (const record of store.history[key] ?? []) {
    if (!record.cleared) continue;
    if (!best || record.technical > best.technical
      || (record.technical === best.technical && record.recordedAt >= best.recordedAt)) best = record;
  }
  if (best) {
    const { id: _id, ...row } = best;
    store.rows[key] = row;
  } else delete store.rows[key];
}

export function sanitizeResultRecords(raw: unknown): ResultRecordStore {
  const out = emptyResultRecords();
  if (!raw || typeof raw !== 'object') return out;
  const input = raw as Record<string, unknown>;
  const history = input.history;
  if (input.version === 1 && history && typeof history === 'object') {
    for (const [key, value] of Object.entries(history)) {
      if (!RESULT_RECORD_KEY_PATTERN.test(key) || !Array.isArray(value)) continue;
      const records: ResultHistoryRecord[] = [];
      const seen = new Set<string>();
      for (const item of value) {
        const row = sanitizeRow(item);
        if (!row || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        records.push({ ...row, id: item.id });
      }
      if (records.length) {
        out.history[key] = records;
        rebuildBest(out, key);
      }
    }
    return out;
  }
  return out;
}

export function loadResultRecords(
  storage: ReadStorage | null = typeof localStorage !== 'undefined' ? localStorage : null,
): ResultRecordStore {
  if (!storage) return emptyResultRecords();
  try {
    const raw = storage.getItem(RESULT_RECORDS_KEY);
    if (!raw) return emptyResultRecords();
    return sanitizeResultRecords(JSON.parse(raw));
  } catch {
    return emptyResultRecords();
  }
}

export function saveResultRecords(
  store: ResultRecordStore,
  storage: WriteStorage | null = typeof localStorage !== 'undefined' ? localStorage : null,
): boolean {
  if (!storage) return false;
  try {
    // rows 为内存中的最佳成绩索引，存储只保留历史，读取时重建索引。
    storage.setItem(RESULT_RECORDS_KEY, JSON.stringify({ version: 1, history: store.history }));
    return true;
  } catch {
    return false;
  }
}

/** 成绩备份与本地存储使用同一份完整历史结构。 */
export function exportResultRecords(store: ResultRecordStore): string {
  return JSON.stringify({ version: 1, history: store.history }, null, 2);
}

/** 导入整份校验，文件有任何坏记录时直接报错。 */
export function parseResultRecords(text: string): ResultRecordStore {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error('文件不是有效的 JSON。'); }
  if (!raw || typeof raw !== 'object') throw new Error('成绩文件格式无效。');
  const input = raw as Record<string, unknown>;
  if (input.version !== 1 || !input.history || typeof input.history !== 'object' || Array.isArray(input.history)) {
    throw new Error('成绩文件版本或历史结构无效。');
  }
  const out = emptyResultRecords();
  const ids = new Set<string>();
  for (const [key, records] of Object.entries(input.history)) {
    if (!RESULT_RECORD_KEY_PATTERN.test(key) || !Array.isArray(records)) throw new Error(`谱面成绩分组无效：${key}`);
    for (const item of records) {
      const row = sanitizeRow(item);
      if (!row || typeof item.id !== 'string' || !item.id.trim()) throw new Error(`成绩数据不完整：${key}`);
      const record = item as ResultHistoryRecord;
      const integers = [record.technical, record.level, record.maxCombo, record.recordedAt, record.score, record.userCombo,
        ...record.judgements, ...record.judgementConditions.flat()];
      if (!integers.every(Number.isSafeInteger)) throw new Error(`分数、时间或计数不是有效整数：${key}`);
      if (ids.has(record.id)) throw new Error(`文件中存在重复记录 ID：${record.id}`);
      ids.add(record.id);
      (out.history[key] ??= []).push({ ...row, id: record.id });
    }
    rebuildBest(out, key);
  }
  return out;
}

/** 按每局 ID 合并，重复记录跳过；同 ID 内容或谱面归属冲突时拒绝整次合并。 */
export function mergeResultRecords(current: ResultRecordStore, incoming: ResultRecordStore): {
  store: ResultRecordStore; added: number; duplicates: number;
} {
  const next = structuredClone(current);
  const seen = new Map<string, string>();
  const fingerprint = (key: string, record: ResultHistoryRecord) => JSON.stringify({ key, ...sanitizeRow(record) });
  for (const [key, records] of Object.entries(next.history)) {
    for (const record of records) seen.set(record.id, fingerprint(key, record));
  }
  let added = 0, duplicates = 0;
  for (const [key, records] of Object.entries(incoming.history)) {
    for (const record of records) {
      const content = fingerprint(key, record);
      const previous = seen.get(record.id);
      if (previous !== undefined) {
        if (previous !== content) throw new Error(`记录 ID 与本地成绩冲突：${record.id}`);
        duplicates++;
        continue;
      }
      (next.history[key] ??= []).push(structuredClone(record));
      seen.set(record.id, content);
      added++;
    }
    rebuildBest(next, key);
  }
  return { store: next, added, duplicates };
}

/** 单行记录对应的单曲 Rate。 */
export function rateOfRow(row: ResultRecordRow): number {
  return rateByScore(row.technical, row.level, row.maxCombo);
}

/** 全部单曲 Rate → PlayerRate（降序前 30 求和）。 */
export function playerRateOfStore(store: ResultRecordStore): number {
  return playerRate(Object.values(store.rows).map(rateOfRow));
}

/** 删除一局历史；省略 id 时删除该谱面的全部历史。 */
export function removeResultRecord(store: ResultRecordStore, key: string, id?: string): void {
  const remaining = id === undefined ? [] : (store.history[key] ?? []).filter(record => record.id !== id);
  if (remaining.length) store.history[key] = remaining;
  else delete store.history[key];
  rebuildBest(store, key);
}

/**
 * 把一局成绩并入本地库并返回本次结算要显示的 Rate / PlayerRate。
 * 返回的是「显示值」：原版在没有提升时显示旧值、Increase 行只在增量 ≥1 时出现。
 */
export function applyPlayResult(store: ResultRecordStore, play: PlayRecordInput): PlayRates {
  const key = resultRecordKey(play.chartSongId, play.difficulty);
  const candidate = sanitizeRow({ ...play, recordedAt: play.recordedAt ?? Date.now() });
  if (!RESULT_RECORD_KEY_PATTERN.test(key) || !candidate) throw new Error('本局成绩数据不完整或数值无效');
  const old = store.rows[key];
  const oldRate = old ? rateOfRow(old) : 0;
  const oldPlayerRate = playerRateOfStore(store);
  (store.history[key] ??= []).push({ ...candidate, id: crypto.randomUUID() });
  rebuildBest(store, key);
  const next = store.rows[key];
  const newRate = next ? rateOfRow(next) : 0;
  const newPlayerRate = playerRateOfStore(store);
  return {
    rate: newRate >= oldRate ? newRate : oldRate,
    rateIncrease: Math.max(0, newRate - oldRate),
    playerRate: newPlayerRate >= oldPlayerRate ? newPlayerRate : oldPlayerRate,
    playerRateIncrease: Math.max(0, newPlayerRate - oldPlayerRate),
  };
}
