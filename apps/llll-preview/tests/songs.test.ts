import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findSongByChartFile, songAssets, type SongList } from '../src/songAssets';
import { availableDifficulties, filterSongs, matchesQuery } from '../src/songPicker';
import { feverForFilename } from '../src/feverMetadata';

const list = JSON.parse(readFileSync(new URL('../../web/public/song-list.json', import.meta.url), 'utf8')) as SongList;

describe('曲目列表 apps/web/public/song-list.json', () => {
  it('236 首，154 首有谱面，每首有谱面的曲目 4 难度齐全', () => {
    expect(list.songs.length).toBe(list.total);
    const charted = list.songs.filter((s) => s.hasChart);
    expect(charted.length).toBe(list.withChart);
    for (const s of charted) expect(availableDifficulties(s).length).toBeGreaterThan(0);
  });
  it('谱面文件名可反查曲目与难度，且能匹配 Fever 的文件名规则', () => {
    const song = list.songs.find((s) => s.hasChart)!;
    const [difficulty, file] = Object.entries(song.charts)[0]!;
    expect(findSongByChartFile(list, file)).toEqual({ song, difficulty });
    expect(file).toMatch(/^rhythmgame_chart_\d+_\d+\.bytes$/);
    expect(findSongByChartFile(list, 'nope.bytes')).toBeNull();
    expect(feverForFilename(file, { [song.id]: { start: 1, end: 2 } })).toEqual({ start: 1, end: 2 });
  });
  it('BGM / 封面 URL 以 soundId / jacketId 为准', () => {
    const song = list.songs.find((s) => s.hasChart && s.hasJacket)!;
    expect(songAssets(song)).toEqual({ bgmUrl: `/assets/audio/bgm_${song.soundId}.ogg`, coverUrl: `/assets/jacket/${song.jacketId}.png` });
  });
  it('搜索按空格分词 AND，默认隐藏无谱面', () => {
    const song = list.songs.find((s) => s.hasChart)!;
    expect(matchesQuery(song, song.id)).toBe(true);
    expect(filterSongs(list.songs, '', false).every((s) => s.hasChart)).toBe(true);
    expect(filterSongs(list.songs, '', true).length).toBe(list.songs.length);
  });
});
