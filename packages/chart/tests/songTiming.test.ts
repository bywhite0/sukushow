import { describe, expect, it } from 'vitest';
import { parseChartName } from '../src/masterdata';
import { feverChanceForSong, feverForSong, finishTimeForSong, type SongTimingIndex } from '../src/songTiming';
import songTiming from '../src/songTiming.json';

const ids = Object.keys(songTiming);

describe('feverForSong', () => {
  it('返回已收录曲目的时段', () => {
    expect(feverForSong('103101')).toEqual({ start: 75.556, end: 105.185 });
    expect(feverForSong(103101)).toEqual({ start: 75.556, end: 105.185 });
  });

  it('未知曲目返回 null，不估算', () => {
    expect(feverForSong('999999')).toBeNull();
    expect(feverForSong('')).toBeNull();
    expect(feverForSong(null)).toBeNull();
    expect(feverForSong(undefined)).toBeNull();
  });

  it('返回副本，调用方改动不污染索引', () => {
    feverForSong('103101')!.start = -123;
    expect(feverForSong('103101')!.start).toBe(75.556);
  });

  it('只含 start/end，不泄漏其他字段', () => {
    expect(Object.keys(feverForSong('103101')!).sort()).toEqual(['end', 'start']);
  });

  it('按标准谱面文件名取曲目 Id', () => {
    const index: SongTimingIndex = { '103119': { start: 51.329, end: 95.723, chanceStart: 37.457, chanceEnd: 51.329, finishTime: 112.37 } };
    const forFile = (name: string) => feverForSong(parseChartName(name)?.musicId, index);
    expect(forFile('rhythmgame_chart_103119_04.bytes')).toEqual({ start: 51.329, end: 95.723 });
    expect(forFile('rhythmgame_chart_103119_01.json')).toEqual({ start: 51.329, end: 95.723 });
    expect(forFile('custom.json')).toBeNull();
    expect(forFile('rhythmgame_chart_999999_04.bytes')).toBeNull();
  });
});

describe('feverChanceForSong', () => {
  it('chance 段紧邻 Fever 起点（chance.end === fever.start）', () => {
    const fever = feverForSong('103101')!;
    const chance = feverChanceForSong('103101')!;
    // 代理口径的硬契约：前一段的终点就是 Fever 的起点。
    expect(chance.end).toBe(fever.start);
    expect(chance.start).toBeLessThan(chance.end);
  });

  it('未知曲目或 Fever 在第一段时返回 null', () => {
    const index: SongTimingIndex = { '1': { start: 0, end: 10, chanceStart: null, chanceEnd: null, finishTime: 60 } };
    expect(feverChanceForSong('1', index)).toBeNull();
    expect(feverChanceForSong('999999')).toBeNull();
    expect(feverChanceForSong(null)).toBeNull();
  });

  it('全量曲目的 chance 都紧邻 Fever 且时长为正', () => {
    let checked = 0;
    for (const id of ids) {
      const chance = feverChanceForSong(id);
      if (!chance) continue;
      expect(chance.end).toBe(feverForSong(id)!.start);
      expect(chance.start).toBeLessThan(chance.end);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe('finishTimeForSong', () => {
  it('曲终 = Musics.PlayTime / 1000', () => {
    expect(finishTimeForSong('103101')).toBe(139.259);
  });

  it('曲终与 Fever 第五段终点（CSV 的 MusicEnd）来源不同，可以不相等', () => {
    // 203302：MusicEnd 117073 ms，PlayTime 117240 ms。
    expect(feverForSong('203302')!.end).toBe(117.073);
    expect(finishTimeForSong('203302')).toBe(117.24);
  });

  it('未知曲目返回 null', () => {
    expect(finishTimeForSong('999999')).toBeNull();
    expect(finishTimeForSong(undefined)).toBeNull();
  });

  it('全量曲目都有正的曲终，且不早于 Fever 起点', () => {
    for (const id of ids) {
      const finish = finishTimeForSong(id)!;
      expect(finish).toBeGreaterThan(0);
      expect(finish).toBeGreaterThan(feverForSong(id)!.start);
    }
  });
});
