import { describe, expect, it } from 'vitest';
import {
  RESULT_RECORDS_KEY, applyPlayResult, emptyResultRecords, exportResultRecords, loadResultRecords,
  mergeResultRecords, parseResultRecords,
  playerRateOfStore, rateOfRow, removeResultRecord, resultRecordKey, sanitizeResultRecords, saveResultRecords,
  type PlayRecordInput,
} from '../src/views/llll/resultRecords';

const conditions = () => Array.from({ length: 6 }, () => [0, 0, 0]);
const play = (over: Partial<PlayRecordInput> = {}): PlayRecordInput => ({
  chartSongId: '105101', difficulty: 'MASTER', technical: 98000, technicalPercent: 98,
  level: 27, maxCombo: 1000, recordedAt: 1760000000000, score: 123456789,
  judgements: [0, 0, 0, 100, 900, 0], judgementConditions: conditions(), userCombo: 1000, cleared: true, ...over,
});
const fakeStorage = () => {
  const map = new Map<string, string>();
  return { map, getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); } };
};

describe('历史成绩 → Rate / PlayerRate', () => {
  it('首局的 Rate 与 PlayerRate 从 0 提升，完整一局进入历史', () => {
    const store = emptyResultRecords();
    expect(applyPlayResult(store, play())).toEqual({ rate: 270, rateIncrease: 270, playerRate: 270, playerRateIncrease: 270 });
    expect(store.history['105101:MASTER']).toHaveLength(1);
    expect(store.rows['105101:MASTER']).toMatchObject({ technical: 98000, score: 123456789,
      technicalPercent: 98, recordedAt: 1760000000000, userCombo: 1000, cleared: true });
  });

  it('低分和重复时间的成绩保留历史，最佳值与 PlayerRate 不重复累加', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play());
    const result = applyPlayResult(store, play({ technical: 90000, technicalPercent: 90, score: 100 }));
    expect(result).toEqual({ rate: 270, rateIncrease: 0, playerRate: 270, playerRateIncrease: 0 });
    expect(store.history['105101:MASTER']).toHaveLength(2);
    const [first, second] = store.history['105101:MASTER']!;
    expect(first!.id).not.toBe(second!.id);
    expect(second!.score).toBe(100);
    expect(store.rows['105101:MASTER']!.score).toBe(123456789);
  });

  it('更高技术分提升 Rate，最佳值使用同一局的分数与判定', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play({ technical: 90000, technicalPercent: 90 }));
    const result = applyPlayResult(store, play({ score: 200, judgements: [1, 2, 3, 4, 5, 674] }));
    expect(result.rateIncrease).toBe(135);
    expect(result.playerRate).toBe(270);
    expect(store.rows['105101:MASTER']).toMatchObject({ score: 200, judgements: [1, 2, 3, 4, 5, 674] });
  });

  it('同分取最近一局，历史分别保留', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play());
    applyPlayResult(store, play({ recordedAt: 1760000010000, score: 200 }));
    expect(store.rows['105101:MASTER']!.score).toBe(200);
    expect(store.history['105101:MASTER']).toHaveLength(2);
  });

  it('按谱面归属 ID 和难度分组，Another Vocal 共用同组历史', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play());
    applyPlayResult(store, play({ technical: 90000, technicalPercent: 90 }));
    applyPlayResult(store, play({ difficulty: 'EXPERT', technical: 90000, technicalPercent: 90 }));
    expect(Object.keys(store.history)).toEqual(['105101:MASTER', '105101:EXPERT']);
    expect(store.history['105101:MASTER']).toHaveLength(2);
    expect(playerRateOfStore(store)).toBe(405);
    expect(resultRecordKey('105101', 'master')).toBe('105101:MASTER');
  });

  it('未通关局进入历史但不提升 Rate', () => {
    const store = emptyResultRecords();
    const failed = play({ cleared: false, technical: 101000, technicalPercent: 101, score: 200 });
    expect(applyPlayResult(store, failed)).toEqual({ rate: 0, rateIncrease: 0, playerRate: 0, playerRateIncrease: 0 });
    expect(store.rows).toEqual({});
    expect(store.history['105101:MASTER']![0]).toMatchObject({ cleared: false, technicalPercent: 101 });
    applyPlayResult(store, play());
    expect(applyPlayResult(store, failed)).toEqual({ rate: 270, rateIncrease: 0, playerRate: 270, playerRateIncrease: 0 });
    expect(store.history['105101:MASTER']).toHaveLength(3);
  });

  it('判定及偏差计数保存副本，之后的局不会修改历史', () => {
    const store = emptyResultRecords();
    const input = play();
    input.judgementConditions = [[0, 0, 0], [1, 0, 0], [0, 0, 2], [3, 4, 0], [5, 6, 0], [0, 0, 0]];
    applyPlayResult(store, input);
    (input.judgements as number[])[0] = 999;
    (input.judgementConditions as number[][])[3]![0] = 999;
    expect(store.history['105101:MASTER']![0]!.judgements[0]).toBe(0);
    expect(store.history['105101:MASTER']![0]!.judgementConditions[3]).toEqual([3, 4, 0]);
  });
});

describe('历史管理', () => {
  it('删除最佳局后按次佳重算 Rate，删空后移除谱面组', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play({ technical: 90000, technicalPercent: 90 }));
    applyPlayResult(store, play());
    const bestId = store.history['105101:MASTER']![1]!.id;
    removeResultRecord(store, '105101:MASTER', bestId);
    expect(rateOfRow(store.rows['105101:MASTER']!)).toBe(135);
    expect(playerRateOfStore(store)).toBe(135);
    removeResultRecord(store, '105101:MASTER', store.history['105101:MASTER']![0]!.id);
    expect(store).toEqual(emptyResultRecords());
  });

  it('删除一组成绩保留其它曲目，未通关历史不回升 Rate', () => {
    const store = emptyResultRecords();
    applyPlayResult(store, play());
    applyPlayResult(store, play({ chartSongId: '103114' }));
    applyPlayResult(store, play({ cleared: false }));
    removeResultRecord(store, '105101:MASTER', store.history['105101:MASTER']![0]!.id);
    expect(store.rows['105101:MASTER']).toBeUndefined();
    expect(store.history['105101:MASTER']).toHaveLength(1);
    removeResultRecord(store, '105101:MASTER');
    expect(Object.keys(store.history)).toEqual(['103114:MASTER']);
    expect(playerRateOfStore(store)).toBe(270);
  });
});

describe('历史存储校验', () => {
  it('只序列化历史，读回后重建最佳成绩索引', () => {
    const storage = fakeStorage();
    const store = emptyResultRecords();
    applyPlayResult(store, play());
    applyPlayResult(store, play({ technical: 90000, technicalPercent: 90 }));
    expect(saveResultRecords(store, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(RESULT_RECORDS_KEY)!)).not.toHaveProperty('rows');
    expect(loadResultRecords(storage)).toEqual(store);
  });

  it('非法结构、坏 JSON 与不完整的一局不会生成记录', () => {
    const storage = fakeStorage();
    storage.setItem(RESULT_RECORDS_KEY, '{bad json');
    expect(loadResultRecords(storage)).toEqual(emptyResultRecords());
    const raw = { version: 1, history: {
      '105101:MASTER': [{ ...play(), id: 'valid' }, { ...play(), id: 'bad', judgementConditions: [[1]] }],
      bad: [{ ...play(), id: 'invalid-key' }],
    } };
    const out = sanitizeResultRecords(raw);
    expect(out.history['105101:MASTER']).toHaveLength(1);
    expect(out.history['105101:MASTER']![0]!.id).toBe('valid');
    expect(Object.keys(out.history)).toEqual(['105101:MASTER']);
    expect(sanitizeResultRecords(null)).toEqual(emptyResultRecords());
    expect(sanitizeResultRecords({ history: 'x' })).toEqual(emptyResultRecords());
  });

  it('写入被拒绝时返回失败，无存储时返回空库', () => {
    expect(saveResultRecords(emptyResultRecords(), { setItem: () => { throw new Error('denied'); } })).toBe(false);
    expect(saveResultRecords(emptyResultRecords(), null)).toBe(false);
    expect(loadResultRecords(null)).toEqual(emptyResultRecords());
  });

  it('非法曲目键或数值不写入', () => {
    const store = emptyResultRecords();
    expect(() => applyPlayResult(store, play({ chartSongId: '' }))).toThrow();
    expect(() => applyPlayResult(store, play({ technical: Number.NaN }))).toThrow();
    expect(store).toEqual(emptyResultRecords());
  });
});

describe('成绩备份导入与导出', () => {
  it('完整历史导出后可恢复，保留失败局、百分比、判定与偏差明细', () => {
    const original = emptyResultRecords();
    applyPlayResult(original, play());
    applyPlayResult(original, play({ cleared: false, technical: 100828, technicalPercent: 100.828 }));
    expect(parseResultRecords(exportResultRecords(original))).toEqual(original);
    expect(parseResultRecords(exportResultRecords(emptyResultRecords()))).toEqual(emptyResultRecords());
  });

  it('与现有历史合并，重复导入幂等，Rate 不重复累加', () => {
    const local = emptyResultRecords();
    applyPlayResult(local, play());
    const incoming = parseResultRecords(exportResultRecords(local));
    applyPlayResult(incoming, play({ technical: 90000, technicalPercent: 90 }));
    applyPlayResult(incoming, play({ chartSongId: '103114' }));
    const merged = mergeResultRecords(local, incoming);
    expect(merged.added).toBe(2);
    expect(merged.duplicates).toBe(1);
    expect(merged.store.history['105101:MASTER']).toHaveLength(2);
    expect(playerRateOfStore(merged.store)).toBe(540);
    expect(Object.keys(local.history)).toEqual(['105101:MASTER']);
    expect(local.history['105101:MASTER']).toHaveLength(1);
    const repeated = mergeResultRecords(merged.store, incoming);
    expect(repeated.added).toBe(0);
    expect(repeated.duplicates).toBe(3);
    expect(repeated.store).toEqual(merged.store);
  });

  it('同 ID 内容或谱面归属冲突时整次拒绝，本地库不受部分合并影响', () => {
    const local = emptyResultRecords();
    applyPlayResult(local, play());
    const incoming = emptyResultRecords();
    applyPlayResult(incoming, play({ chartSongId: '103114' }));
    const duplicate = structuredClone(local.history['105101:MASTER']![0]!);
    incoming.history['105101:MASTER'] = [{ ...duplicate, score: 1 }];
    const before = exportResultRecords(local);
    expect(() => mergeResultRecords(local, incoming)).toThrow('冲突');
    expect(exportResultRecords(local)).toBe(before);
    incoming.history['105101:MASTER'] = [];
    incoming.history['103114:MASTER']!.push(duplicate);
    expect(() => mergeResultRecords(local, incoming)).toThrow('冲突');
    expect(exportResultRecords(local)).toBe(before);
  });

  it('错误版本、缺字段或任意坏记录均拒绝整个导入文件', () => {
    const local = emptyResultRecords();
    applyPlayResult(local, play());
    const valid = JSON.parse(exportResultRecords(local));
    expect(() => parseResultRecords('x')).toThrow('JSON');
    expect(() => parseResultRecords(JSON.stringify({ ...valid, version: 2 }))).toThrow('版本');
    expect(() => parseResultRecords(JSON.stringify({ version: 1, history: [] }))).toThrow();
    expect(() => parseResultRecords(JSON.stringify({ version: 1, history: { bad: [] } }))).toThrow();
    for (const broken of [
      { ...valid.history['105101:MASTER'][0], id: 'missing', judgements: undefined },
      { ...valid.history['105101:MASTER'][0], id: 'fractional', score: 1.5 },
      { ...valid.history['105101:MASTER'][0], id: 'negative', technical: -1 },
      { ...valid.history['105101:MASTER'][0], id: 'wrong-shape', judgementConditions: [[1]] },
    ]) {
      const bad = { version: 1, history: { '105101:MASTER': [valid.history['105101:MASTER'][0], broken] } };
      expect(() => parseResultRecords(JSON.stringify(bad))).toThrow();
    }
    valid.history['105101:MASTER'].push(valid.history['105101:MASTER'][0]);
    expect(() => parseResultRecords(JSON.stringify(valid))).toThrow('重复记录');
  });
});
