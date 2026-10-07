import { describe, expect, it } from 'vitest';
import { feverFromMusicScore, feverForFilename, parseFeverWindow } from '../src/feverMetadata';
const csv = 'id,song_time,key_type,key_value,heart_appear_ratio\r\n1,0,10,0,0\r\n2,26358,20,0,0\r\n3,37457,20,0,0\r\n4,51329,20,0,0\r\n5,95723,20,0,0\r\n6,112370,99,0,0\r\n';
describe('歌曲 Fever 元数据', () => {
  it.each([[1, 0, 26.358], [3, 37.457, 51.329], [4, 51.329, 95.723], [5, 95.723, 112.37]])('解析第 %s 段并将毫秒转秒', (n, start, end) => {
    expect(feverFromMusicScore(csv, n)).toEqual({ start, end });
  });
  it.each([0, 6, 1.5, NaN])('拒绝非法段号 %s', n => {
    expect(() => feverFromMusicScore(csv, n)).toThrow();
  });
  it.each(['', csv.replace('95723', '51329'), csv.replace('26358', '-1'), csv.replace('37457', 'oops')])('拒绝缺失或无效分段', text => {
    expect(() => feverFromMusicScore(text, 4)).toThrow();
  });
  it('先按时间排序分段事件', () => {
    const shuffled = csv.replace('26358', '51329').replace('4,51329', '4,26358');
    expect(feverFromMusicScore(shuffled, 3)).toEqual({ start: 37.457, end: 51.329 });
  });
  it('第五段取 CSV 最后一个 MusicEnd，而非最大时间或 PlayTime', () => {
    expect(feverFromMusicScore(csv + '7,110000,99,0,0\r\n', 5)).toEqual({ start: 95.723, end: 110 });
  });
  it.each(['', '90000', '95723', 'oops', 'Infinity'])('第五段拒绝缺失或无效曲终 %s', value => {
    const text = value ? csv.replace('112370', value) : csv.replace('6,112370,99,0,0\r\n', '');
    expect(() => feverFromMusicScore(text, 5)).toThrow();
  });
  it('前四段不依赖曲终事件', () => {
    expect(feverFromMusicScore(csv.replace('6,112370,99,0,0\r\n', ''), 4)).toEqual({ start: 51.329, end: 95.723 });
  });
  it('按标准文件名匹配，不为未知歌曲估算', () => {
    const index = { '103119': { start: 51.329, end: 95.723 } };
    expect(feverForFilename('rhythmgame_chart_103119_04.bytes', index)).toEqual(index['103119']);
    expect(feverForFilename('rhythmgame_chart_103119_01.json', index)).toEqual(index['103119']);
    expect(feverForFilename('custom.json', index)).toBeNull();
    expect(feverForFilename('rhythmgame_chart_999999_04.bytes', index)).toBeNull();
  });
  it('空输入关闭 Fever，零秒起点有效', () => {
    expect(parseFeverWindow('', '')).toBeNull();
    expect(parseFeverWindow('0', '2.125')).toEqual({ start: 0, end: 2.125 });
  });
  it.each([['', '2'], ['1', ''], ['-1', '2'], ['2', '2'], ['3', '2'], ['NaN', '3'], ['1', 'Infinity']])('拒绝无效手动区间 %s/%s', (start, end) => {
    expect(() => parseFeverWindow(start, end)).toThrow();
  });
});
