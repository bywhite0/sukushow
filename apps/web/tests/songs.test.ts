import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findSongByChartFile, songAssets, type SongList } from '@sukushow/llll-preview/songAssets';
import { availableDifficulties, filterSongs, matchesQuery } from '../src/songPicker';
import { parseChartName } from '@sukushow/chart/masterdata';
import { feverForSong, finishTimeForSong } from '@sukushow/chart/songTiming';

const list = JSON.parse(readFileSync(new URL('../public/song-list.json', import.meta.url), 'utf8')) as SongList;

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
    expect(String(parseChartName(file)?.musicId)).toBe(song.id);
    expect(feverForSong(parseChartName(file)?.musicId)).toEqual(feverForSong(song.id));
  });
  it('曲目列表的 playTime 与时间索引的曲终逐首一致', () => {
    for (const song of list.songs) expect(finishTimeForSong(song.id)).toBe(song.playTime / 1000);
  });
  it('BGM / 封面 URL 以 soundId / jacketId 为准', () => {
    const song = list.songs.find((s) => s.hasChart && s.hasJacket)!;
    expect(songAssets(song)).toMatchObject({ bgmUrl: `/assets/audio/bgm_${song.soundId}.ogg`, coverUrl: `/assets/jacket/${song.jacketId}.png`, mvUrl: song.isVideoMode ? `/assets/mv/${song.id}.mp4` : null });
  });
  it('仅视频曲目按曲目 Id 查找 MV，不使用不同的 BGM SoundId', () => {
    const mvSong = list.songs.find((song) => song.isVideoMode && song.soundId !== song.id)!;
    const plainSong = list.songs.find((song) => !song.isVideoMode)!;
    expect(songAssets(mvSong).mvUrl).toBe(`/assets/mv/${mvSong.id}.mp4`);
    expect(songAssets(plainSong).mvUrl).toBeNull();
  });
  it('非零 MV 片段起点取原包时间线，不等于谱面零时刻', () => {
    const song = list.songs.find((entry) => entry.id === '103106')!;
    expect(song.isVideoMode).toBe(true);
    expect(songAssets(song).mvStartSec).toBeCloseTo(2.1333333333333333, 9);
    expect(songAssets(list.songs.find((entry) => entry.id === '103103')!).mvStartSec).toBe(0);
  });
  it('搜索按空格分词 AND，默认隐藏无谱面', () => {
    const song = list.songs.find((s) => s.hasChart)!;
    expect(matchesQuery(song, song.id)).toBe(true);
    expect(filterSongs(list.songs, '', false).every((s) => s.hasChart)).toBe(true);
    expect(filterSongs(list.songs, '', true).length).toBe(list.songs.length);
  });
});
