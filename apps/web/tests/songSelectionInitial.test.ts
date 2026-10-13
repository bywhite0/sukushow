import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SongList } from '@sukushow/llll-preview/songAssets'
import { SongSelectionStore } from '../src/songSelection'

const list = JSON.parse(readFileSync(new URL('../public/song-list.json', import.meta.url), 'utf8')) as SongList

describe('启动来源校验', () => {
  it('曲库就绪前保留歌曲绑定但不虚构官方谱面', () => {
    const store = new SongSelectionStore({ songId: '103109' })
    expect(store.getSource()).toMatchObject({ songId: '103109', chart: { kind: 'none' } })
    store.selectCatalog({ songId: '103109', difficulty: 'HARD' }, list)
    expect(store.getSource()).toMatchObject({ songId: '103109', chart: { kind: 'official', songId: '104106', difficulty: 'HARD' } })
  })
})
