import type { DifficultyName } from './songPicker'
import type { Chart } from '@sukushow/chart/chart'
import type { SongList } from '@sukushow/llll-preview/songAssets'
import { chartSongFor, resolveCatalogChoice, vocalVersions, type CatalogChoice } from './songVersions'

export type MediaKind = 'audio' | 'cover' | 'mv'
export type MediaOverride =
  | { kind: 'inherit' }
  | { kind: 'none' }
  | { kind: 'file'; url: string; name: string; durationSec: number | null }
export type ChartSource =
  | { kind: 'none' }
  | { kind: 'official'; songId: string; difficulty: DifficultyName }
  | { kind: 'custom'; chart: Chart; filename: string }
export type SourceMetadata = {
  title: string; difficulty: string | null; scoreCreator: string | null
  lyricist: string | null; composer: string | null; arranger: string | null
  vocal: string | null; offsetMs: number
  fever: { start: number; end: number } | null; finishTime: number | null
}
export type SourceState = {
  revision: number; identity: number; songId: string | null
  chart: ChartSource; metadata: Partial<SourceMetadata>
  media: Record<MediaKind, MediaOverride>
}
export type ResolvedSource = {
  revision: number; identity: number; songId: string | null
  chart: Chart | null; chartSongId: string | null; custom: boolean
  metadata: SourceMetadata
  /** 官方难度的定数（`MusicScores` 的 Level）；自制谱或曲库缺该字段时为 null。 */
  level: number | null
  download?: { downloadedBytes: number; totalBytes: number | undefined; sizes?: Record<string, number> }
  assets: { bgmUrl: string | null; coverUrl: string | null; mvUrl: string | null
    mvStartSec: number; mvDurationSec: number }
}

const inheritedMedia = (): SourceState['media'] => ({
  audio: { kind: 'inherit' }, cover: { kind: 'inherit' }, mv: { kind: 'inherit' },
})

/** 共享壳层持有来源，视图只负责应用和渲染。 */
export class SongSelectionStore {
  private source: SourceState = {
    revision: 0, identity: 0, songId: null, chart: { kind: 'none' }, metadata: {}, media: inheritedMedia(),
  }
  private readonly sourceListeners = new Set<(state: SourceState) => void>()

  getSource(): SourceState { return this.source }

  subscribeSource(listener: (state: SourceState) => void, emitCurrent = false): () => void {
    this.sourceListeners.add(listener)
    if (emitCurrent) listener(this.source)
    return () => { this.sourceListeners.delete(listener) }
  }

  private publish(patch: Partial<SourceState>, newIdentity = false): void {
    this.source = { ...this.source, ...patch, revision: this.source.revision + 1,
      identity: this.source.identity + Number(newIdentity) }
    for (const listener of this.sourceListeners) listener(this.source)
  }

  selectCatalog(choice: CatalogChoice, list: SongList): void {
    const selected = resolveCatalogChoice(list, choice.songId, choice.difficulty, true)
    const chartSong = chartSongFor(list, selected.songId)
    const chart: ChartSource = chartSong && selected.difficulty
      ? { kind: 'official', songId: chartSong.id, difficulty: selected.difficulty } : { kind: 'none' }
    this.publish({ songId: selected.songId, chart, metadata: {}, media: inheritedMedia() }, true)
  }

  selectVersion(choice: CatalogChoice, list: SongList): void {
    if (!this.source.songId || this.source.chart.kind === 'none'
      || !vocalVersions(list, this.source.songId).some(song => song.id === choice.songId)) {
      throw new Error('该歌曲不支持所选 Another Vocal 版本')
    }
    if (this.source.chart.kind === 'custom') {
      this.publish({ songId: choice.songId }, true)
      return
    }
    this.selectCatalog({ ...choice, difficulty: this.source.chart.difficulty }, list)
  }

  openCustom(chart: Chart, filename: string): void {
    this.publish({ chart: { kind: 'custom', chart: structuredClone(chart), filename }, metadata: {} }, true)
  }

  clearSource(): void {
    this.publish({ songId: null, chart: { kind: 'none' }, metadata: {}, media: inheritedMedia() }, true)
  }

  updateMetadata(patch: Partial<SourceMetadata>): void {
    this.publish({ metadata: { ...this.source.metadata, ...structuredClone(patch) } })
  }

  updateMedia(kind: MediaKind, value: MediaOverride): void {
    this.publish({ media: { ...this.source.media, [kind]: { ...value } } })
  }

  /**
   * 内容没变但外部依赖变了（例如换了本地资源目录），让视图重新解析一次。
   *
   * 只递增 revision，不动 identity —— 已打开的自制谱和编辑资料都要保留。
   */
  touch(): void {
    this.publish({})
  }

  constructor(initial: { songId: string } | null = null) {
    if (initial) this.source = { ...this.source, songId: initial.songId }
  }
}
