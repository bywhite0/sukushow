import { afterEach, expect, it, vi } from 'vitest'
import { SongSelectionStore } from '../src/songSelection'
import { createSourceFiles } from '../src/sourceFiles'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('浏览器拒绝创建音频 context 时不遗留计时器并释放候选 URL', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', {})
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('context unavailable') } })
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:audio', revokeObjectURL: revoke })
  const store = new SongSelectionStore()
  const files = createSourceFiles(store)
  await expect(files.openMedia('audio', new File(['audio'], 'audio.wav'))).rejects.toThrow('context unavailable')
  expect(store.getSource().media.audio).toEqual({ kind: 'inherit' })
  expect(revoke).toHaveBeenCalledWith('blob:audio')
  expect(vi.getTimerCount()).toBe(0)
  files.dispose()
})

it.each(['success', 'error', 'timeout'] as const)('音频完整解码 %s 后关闭临时 context，失败保留旧来源', async outcome => {
  vi.useFakeTimers()
  const close = vi.fn(async () => {})
  const decode = vi.fn(() => outcome === 'success' ? Promise.resolve({ duration: 1 })
    : outcome === 'error' ? Promise.reject(new Error('损坏音频')) : new Promise(() => {}))
  vi.stubGlobal('AudioContext', class { decodeAudioData = decode; close = close })
  vi.stubGlobal('document', { createElement: () => {
    const element = new EventTarget() as EventTarget & { load(): void; duration: number; removeAttribute(): void }
    element.duration = 1
    element.load = () => queueMicrotask(() => element.dispatchEvent(new Event('loadedmetadata')))
    element.removeAttribute = () => {}
    return element
  } })
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:audio', revokeObjectURL: revoke })
  const store = new SongSelectionStore()
  const files = createSourceFiles(store)
  const file = new File([new Uint8Array([1, 2, 3])], 'audio', { type: '' })
  const result = files.openMedia('audio', file).catch(error => error)
  await vi.advanceTimersByTimeAsync(outcome === 'timeout' ? 30000 : 0)
  const value = await result
  expect(decode).toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
  if (outcome === 'success') {
    expect(value).toBe(true)
    expect(store.getSource().media.audio).toMatchObject({ kind: 'file', durationSec: 1 })
  } else {
    expect(value).toBeInstanceOf(Error)
    expect(store.getSource().media.audio).toEqual({ kind: 'inherit' })
    expect(revoke).toHaveBeenCalledWith('blob:audio')
  }
  files.dispose()
})
