import { describe, expect, it } from 'vitest'
import {
  DIFFICULTY_ORDER,
  availableDifficulties,
  filterSongs,
  groupByCategory,
  matchesQuery,
  normalizeQuery,
} from '../src/songPicker'
import type { SongEntry } from '@sukushow/llll-preview/songAssets'

function song(overrides: Partial<SongEntry> = {}): SongEntry {
  return {
    id: '103103',
    orderId: 1,
    title: 'フォーチュンムービー',
    furigana: 'ふぉーちゅんむーびー',
    category: 'スリーズブーケ',
    unitId: '101',
    unitName: 'スリーズブーケ',
    generationsId: '103',
    jacketId: '103103',
    jacketAsset: 'image_music_thumbnail_103103',
    jacketPath: '/assets/jacket/103103.png',
    hasJacket: true,
    charts: { MASTER: 'rhythmgame_chart_103103_04.bytes' },
    difficulties: ['MASTER'],
    levels: { MASTER: 29 },
    maxCombos: { MASTER: 688 },
    hasChart: true,
    soundId: '10310301',
    songTime: 0,
    playTime: 75727,
    feverSectionNo: 0,
    centerCharacterId: '',
    singerCharacterId: '',
    supportCharacterId: '',
    startTime: '',
    isVideoMode: false,
    ...overrides,
  }
}

describe('normalizeQuery', () => {
  it('NFKC 归一 + 去空白 + 转小写', () => {
    expect(normalizeQuery('  Dream　Believers ')).toBe('dreambelievers')
  })

  it('全角括号归一成半角，便于与 masterdata 对齐', () => {
    expect(normalizeQuery('Dream Believers（4人Ver.）'))
      .toBe(normalizeQuery('Dream Believers(4人Ver.)'))
  })
})

describe('matchesQuery', () => {
  const target = song()

  it('空查询命中全部', () => {
    expect(matchesQuery(target, '')).toBe(true)
    expect(matchesQuery(target, '   ')).toBe(true)
  })

  it('按曲名命中', () => {
    expect(matchesQuery(target, 'フォーチュン')).toBe(true)
  })

  it('按假名命中', () => {
    expect(matchesQuery(target, 'ふぉーちゅん')).toBe(true)
  })

  it('按组合命中', () => {
    expect(matchesQuery(target, 'スリーズブーケ')).toBe(true)
  })

  it('按曲目 Id 命中', () => {
    expect(matchesQuery(target, '103103')).toBe(true)
  })

  it('忽略大小写与空格', () => {
    const english = song({ title: 'Hello, new dream!' })
    expect(matchesQuery(english, 'HELLO NEW')).toBe(true)
  })

  it('多词按 AND 语义，且不受曲名内标点影响', () => {
    const english = song({ title: 'Hello, new dream!' })
    expect(matchesQuery(english, 'hello dream')).toBe(true)
    expect(matchesQuery(english, 'hello missing')).toBe(false)
  })

  it('不匹配时返回 false', () => {
    expect(matchesQuery(target, 'ドリーム')).toBe(false)
  })
})

describe('groupByCategory', () => {
  it('按分类分组且保持组内原顺序', () => {
    const songs = [
      song({ id: 'a', category: '全体曲' }),
      song({ id: 'b', category: 'スリーズブーケ' }),
      song({ id: 'c', category: '全体曲' }),
    ]
    const groups = groupByCategory(songs)
    expect(groups.map((g) => g.category)).toEqual(['全体曲', 'スリーズブーケ'])
    expect(groups[0]!.songs.map((s) => s.id)).toEqual(['a', 'c'])
    expect(groups[1]!.songs.map((s) => s.id)).toEqual(['b'])
  })

  it('空输入返回空数组', () => {
    expect(groupByCategory([])).toEqual([])
  })
})

describe('filterSongs', () => {
  const songs = [
    song({ id: 'a', title: 'With Chart', hasChart: true }),
    song({ id: 'b', title: 'No Chart', hasChart: false }),
  ]

  it('默认隐藏无谱面的曲目', () => {
    expect(filterSongs(songs, '', false).map((s) => s.id)).toEqual(['a'])
  })

  it('勾选后放行无谱面的曲目', () => {
    expect(filterSongs(songs, '', true).map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('查询与无谱面开关同时生效', () => {
    expect(filterSongs(songs, 'no chart', false)).toEqual([])
    expect(filterSongs(songs, 'no chart', true).map((s) => s.id)).toEqual(['b'])
  })
})

describe('availableDifficulties', () => {
  it('按 N→M 排序，不受输入顺序影响', () => {
    const target = song({ difficulties: ['MASTER', 'NORMAL', 'EXPERT'] })
    expect(availableDifficulties(target)).toEqual(['NORMAL', 'EXPERT', 'MASTER'])
  })

  it('null 返回空数组', () => {
    expect(availableDifficulties(null)).toEqual([])
  })

  it('无谱面返回空数组', () => {
    expect(availableDifficulties(song({ difficulties: [], hasChart: false }))).toEqual([])
  })
})

describe('难度顺序', () => {
  it('固定为 N→M 四级', () => {
    expect([...DIFFICULTY_ORDER]).toEqual(['NORMAL', 'HARD', 'EXPERT', 'MASTER'])
  })
})
