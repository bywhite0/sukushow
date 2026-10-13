import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SongList } from '@sukushow/llll-preview/songAssets'
import { chartSongFor, vocalVersions, resolveCatalogChoice } from '../src/songVersions'

const list = JSON.parse(readFileSync(new URL('../public/song-list.json', import.meta.url), 'utf8')) as SongList

describe('版本谱面来源', () => {
  it.each(['103101', '103112', '104101', '405141'])('%s 借用 105101，媒体歌曲不变', id => {
    expect(chartSongFor(list, id)?.id).toBe('105101')
    expect(resolveCatalogChoice(list, id, 'HARD', true)).toEqual({ songId: id, difficulty: 'HARD' })
  })
  it('SAKURA 不借谱也不显示版本列表', () => {
    expect(chartSongFor(list, '104119')).toBeNull()
    expect(vocalVersions(list, '104119')).toEqual([])
    expect(resolveCatalogChoice(list, '104119', null, true)).toEqual({ songId: '104119', difficulty: null })
    expect(() => resolveCatalogChoice(list, '104119', 'MASTER', true)).toThrow()
  })
  it.each(['105101', '103101', '103112'])('%s 入口返回完整版本组并排除 SAKURA', id => {
    expect(chartSongFor(list, id)?.id).toBe('105101')
    expect(vocalVersions(list, id).map(song => song.id)).toEqual(['105101', '103101', '103112', '104101', '405141'])
  })
  it.each([
    ['104106', ['104106', '103102', '103109']],
    ['304101', ['304101', '303101', '405132']],
    ['304109', ['304109', '303107']],
    ['204108', ['204108', '203105', '405111']],
    ['304111', ['304111', '303113']],
    ['304116', ['304116', '303102']],
    ['204102', ['204102', '203101']],
    ['204109', ['204109', '203103']],
    ['104107', ['104107', '103106']],
    ['204110', ['204110', '203107']],
    ['104104', ['104104', '103115']],
    ['104113', ['104113', '103117']],
    ['405137', ['405137', '405142']],
    ['304115', ['304115', '303103']],
    ['304110', ['304110', '303105']],
    ['304104', ['304104', '303108']],
    ['204106', ['204106', '203104']],
    ['304112', ['304112', '303111']],
    ['304106', ['304106', '303112']],
    ['204114', ['204114', '203110']],
    ['405138', ['405138', '405143']],
    ['204111', ['204111', '203106']],
    ['104108', ['104108', '103110']],
    ['304103', ['304103', '303109']],
    ['204103', ['204103', '203108']],
    ['304108', ['304108', '303119']],
    ['104110', ['104110', '103120']],
    ['405136', ['405136', '405144']],
  ] as const)('%s 的兼容版本保持媒体 ID，并提供来源的全部难度', (sourceId, ids) => {
    const before = JSON.stringify(list)
    for (const id of ids) {
      expect(chartSongFor(list, id)?.id).toBe(sourceId)
      expect(vocalVersions(list, id).map(song => song.id)).toEqual(ids)
      for (const difficulty of ['NORMAL', 'HARD', 'EXPERT', 'MASTER']) {
        expect(resolveCatalogChoice(list, id, difficulty, true)).toEqual({ songId: id, difficulty })
      }
    }
    expect(JSON.stringify(list)).toBe(before)
  })
  it.each(['103104', '304102', '303104', '104102', '103113', '204101'])(
    '%s 的 NEW 编曲各用自己的谱，不提供互借列表', id => {
      expect(chartSongFor(list, id)?.id).toBe(id)
      expect(vocalVersions(list, id)).toEqual([])
    },
  )
  it.each(['203111', '204113', '103118', '104111', '203112', '204115'])(
    '%s 整组无官方谱，不虚构借谱来源', id => {
      expect(chartSongFor(list, id)).toBeNull()
      expect(vocalVersions(list, id)).toEqual([])
    },
  )
  it('曲库缺失版本或谱面来源时不生成不存在的选项', () => {
    const partial = { ...list, songs: list.songs.filter(song => song.id !== '103102') }
    expect(vocalVersions(partial, '104106').map(song => song.id)).toEqual(['104106', '103109'])
    expect(chartSongFor(partial, '103102')).toBeNull()
    const missingSource = { ...list, songs: list.songs.filter(song => song.id !== '104106') }
    expect(chartSongFor(missingSource, '103109')).toBeNull()
    expect(vocalVersions(missingSource, '103109')).toEqual([])
  })
  it('不存在歌曲报错，不返回默认歌曲', () => {
    expect(() => resolveCatalogChoice(list, 'missing', null, false)).toThrow()
    expect(chartSongFor(list, 'missing')).toBeNull()
  })
  it('无显式难度选择最高，非法显式难度拒绝', () => {
    expect(resolveCatalogChoice(list, '103103', null, true).difficulty).toBe('MASTER')
    expect(() => resolveCatalogChoice(list, '103103', 'BOGUS', true)).toThrow()
    expect(resolveCatalogChoice(list, '103103', 'BOGUS', false).difficulty).toBe('MASTER')
  })
})
