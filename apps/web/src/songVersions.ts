import type { SongEntry, SongList } from '@sukushow/llll-preview/songAssets'
import { DIFFICULTY_ORDER, type DifficultyName } from './songPicker'

export type CatalogChoice = { songId: string; difficulty: DifficultyName | null }

// 逐组核对主数据、时间轴与音频；依据及排除项见 docs/song-list.md。
const VOCAL_GROUPS: readonly { chartSongId: string; songIds: readonly string[] }[] = [
  { chartSongId: '105101', songIds: ['105101', '103101', '103112', '104101', '405141'] },
  { chartSongId: '104106', songIds: ['104106', '103102', '103109'] },
  { chartSongId: '304101', songIds: ['304101', '303101', '405132'] },
  { chartSongId: '304109', songIds: ['304109', '303107'] },
  { chartSongId: '204108', songIds: ['204108', '203105', '405111'] },
  { chartSongId: '304111', songIds: ['304111', '303113'] },
  { chartSongId: '304116', songIds: ['304116', '303102'] },
  { chartSongId: '204102', songIds: ['204102', '203101'] },
  { chartSongId: '204109', songIds: ['204109', '203103'] },
  { chartSongId: '104107', songIds: ['104107', '103106'] },
  { chartSongId: '204110', songIds: ['204110', '203107'] },
  { chartSongId: '104104', songIds: ['104104', '103115'] },
  { chartSongId: '104113', songIds: ['104113', '103117'] },
  { chartSongId: '405137', songIds: ['405137', '405142'] },
  { chartSongId: '304115', songIds: ['304115', '303103'] },
  { chartSongId: '304110', songIds: ['304110', '303105'] },
  { chartSongId: '304104', songIds: ['304104', '303108'] },
  { chartSongId: '204106', songIds: ['204106', '203104'] },
  { chartSongId: '304112', songIds: ['304112', '303111'] },
  { chartSongId: '304106', songIds: ['304106', '303112'] },
  { chartSongId: '204114', songIds: ['204114', '203110'] },
  { chartSongId: '405138', songIds: ['405138', '405143'] },
  { chartSongId: '204111', songIds: ['204111', '203106'] },
  { chartSongId: '104108', songIds: ['104108', '103110'] },
  { chartSongId: '304103', songIds: ['304103', '303109'] },
  { chartSongId: '204103', songIds: ['204103', '203108'] },
  { chartSongId: '304108', songIds: ['304108', '303119'] },
  { chartSongId: '104110', songIds: ['104110', '103120'] },
  { chartSongId: '405136', songIds: ['405136', '405144'] },
]

export function chartSongFor(list: SongList, songId: string): SongEntry | null {
  const own = list.songs.find(song => song.id === songId)
  if (!own) return null
  if (own.hasChart) return own
  const group = VOCAL_GROUPS.find(item => item.songIds.includes(songId))
  return group ? list.songs.find(song => song.id === group.chartSongId && song.hasChart) ?? null : null
}

export function vocalVersions(list: SongList, songId: string): SongEntry[] {
  const group = VOCAL_GROUPS.find(item => item.songIds.includes(songId))
  if (!group || !chartSongFor(list, songId)) return []
  return group.songIds.flatMap(id => {
    const song = list.songs.find(item => item.id === id)
    return song ? [song] : []
  })
}

export function resolveCatalogChoice(
  list: SongList, songId: string, difficulty: string | null, strict: boolean,
): CatalogChoice {
  if (!list.songs.some(song => song.id === songId)) throw new Error(`曲目列表里没有 Id ${songId}`)
  const source = chartSongFor(list, songId)
  const available = DIFFICULTY_ORDER.filter(name => source?.charts[name])
  const wanted = available.find(name => name === difficulty?.toUpperCase())
  if (difficulty !== null && !wanted && strict) throw new Error(`曲目 ${songId} 没有难度 ${difficulty} 的谱面`)
  return { songId, difficulty: wanted ?? available[available.length - 1] ?? null }
}
