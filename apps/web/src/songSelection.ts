import type { DifficultyName } from './songPicker'

export type SongSelection = {
  songId: string
  difficulty: DifficultyName
}

export type SongSelectionListener = (selection: SongSelection | null) => void

/**
 * The persistent shell owns the selected song. View modules subscribe to it
 * and only decide how to render the selected source.
 */
export class SongSelectionStore {
  private value: SongSelection | null
  private readonly listeners = new Set<SongSelectionListener>()

  constructor(initial: SongSelection | null = null) {
    this.value = initial
  }

  get(): SongSelection | null {
    return this.value
  }

  set(selection: SongSelection | null, notify = true): void {
    if (this.value?.songId === selection?.songId && this.value?.difficulty === selection?.difficulty) {
      return
    }
    this.value = selection
    if (!notify) return
    for (const listener of this.listeners) listener(selection)
  }

  subscribe(listener: SongSelectionListener, emitCurrent = false): () => void {
    this.listeners.add(listener)
    if (emitCurrent) listener(this.value)
    return () => this.listeners.delete(listener)
  }
}
