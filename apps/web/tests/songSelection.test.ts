import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChart } from '@sukushow/chart/chart'
import type { SongList } from '@sukushow/llll-preview/songAssets'
import { SongSelectionStore } from '../src/songSelection'

const list = JSON.parse(readFileSync(new URL('../public/song-list.json', import.meta.url), 'utf8')) as SongList
const chart = () => parseChart({ Notes: [], Bpms: [] })
describe('共享来源状态', () => {
  it('无谱选择不会携带旧谱或媒体覆盖', () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103103', difficulty: 'MASTER' }, list)
    store.updateMedia('cover', { kind: 'none' })
    store.updateMetadata({ title: '覆盖' })
    store.selectCatalog({ songId: '104119', difficulty: null }, list)
    expect(store.getSource()).toMatchObject({ songId: '104119', chart: { kind: 'none' }, metadata: {}, media: { cover: { kind: 'inherit' } } })
  })
  it('谱面绑定明确选择而不是文件名，新谱清除编辑但保留媒体', () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '104119', difficulty: null }, list)
    store.updateMedia('cover', { kind: 'none' })
    store.openCustom(chart(), 'rhythmgame_chart_103103_04.bytes')
    store.updateMetadata({ title: '编辑' })
    store.openCustom(chart(), 'second.json')
    expect(store.getSource()).toMatchObject({ songId: '104119', metadata: {}, media: { cover: { kind: 'none' } }, chart: { kind: 'custom', filename: 'second.json' } })
  })
  it('同一来源的编辑不改变 identity，但提升 revision', () => {
    const store = new SongSelectionStore()
    store.openCustom(chart(), 'a.json')
    const before = store.getSource()
    store.updateMetadata({ title: '新标题' })
    store.updateMedia('mv', { kind: 'none' })
    expect(store.getSource().identity).toBe(before.identity)
    expect(store.getSource().revision).toBe(before.revision + 2)
  })
  it('自制谱切换版本保留谱面与编辑覆盖', () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '103101', difficulty: 'HARD' }, list)
    store.openCustom(chart(), 'custom.json')
    store.updateMetadata({ title: '自制标题' })
    store.updateMedia('cover', { kind: 'none' })
    store.selectVersion({ songId: '104101', difficulty: 'HARD' }, list)
    expect(store.getSource()).toMatchObject({ songId: '104101', chart: { kind: 'custom', filename: 'custom.json' }, metadata: { title: '自制标题' }, media: { cover: { kind: 'none' } } })
  })
  it('版本更换保留借用难度并拒绝跨组切换', () => {
    const store = new SongSelectionStore()
    store.selectCatalog({ songId: '105101', difficulty: 'HARD' }, list)
    store.selectVersion({ songId: '103112', difficulty: 'HARD' }, list)
    expect(store.getSource()).toMatchObject({ songId: '103112', chart: { kind: 'official', songId: '105101', difficulty: 'HARD' } })
    expect(() => store.selectVersion({ songId: '104119', difficulty: null }, list)).toThrow()
  })
  it('提交的媒体与元数据不持有调用方可变对象', () => {
    const store = new SongSelectionStore()
    const fever = { start: 10, end: 20 }
    const media = { kind: 'file' as const, url: 'blob:original', name: 'a.png', durationSec: null }
    store.updateMetadata({ fever })
    store.updateMedia('cover', media)
    fever.start = 999
    media.url = 'blob:changed'
    expect(store.getSource().metadata.fever).toEqual({ start: 10, end: 20 })
    expect(store.getSource().media.cover).toMatchObject({ url: 'blob:original' })
  })
  it('取消订阅后不收到更新，其他订阅仍获最新快照', () => {
    const store = new SongSelectionStore()
    const seen: number[] = []
    const unsubscribe = store.subscribeSource(state => seen.push(state.revision), true)
    store.openCustom(chart(), 'a.json')
    unsubscribe()
    store.updateMetadata({ title: 'b' })
    expect(seen).toEqual([0, 1])
  })
})
