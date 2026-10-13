import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SongSelectionStore } from '../src/songSelection'
import { createSourceFiles } from '../src/sourceFiles'

class MediaElement extends EventTarget {
  src = ''
  duration = 2
  preload = ''
  muted = false
  playsInline = false
  loads = 0
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
  load() { this.loads++ }
}

class CoverImage {
  src = ''
  naturalWidth = 1
  naturalHeight = 1
  decode = vi.fn(() => Promise.resolve())
  removeAttribute(name: string) { if (name === 'src') this.src = '' }
}

describe('媒体验证的结束与资源释放', () => {
  let video: MediaElement
  let image: CoverImage
  let selection: SongSelectionStore
  let files: ReturnType<typeof createSourceFiles>
  let revoked: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    video = new MediaElement()
    image = new CoverImage()
    revoked = []
    selection = new SongSelectionStore()
    files = createSourceFiles(selection)
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:candidate', revokeObjectURL: (url: string) => revoked.push(url) })
    vi.stubGlobal('document', { createElement: () => video })
    vi.stubGlobal('AudioContext', class {
      decodeAudioData() { return new Promise((_resolve, reject) => {
        video.addEventListener('error', () => reject(new Error('损坏音频')), { once: true })
      }) }
      async close() {}
    })
    vi.stubGlobal('Image', class { constructor() { return image } })
  })
  afterEach(() => {
    files.dispose()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each(['success', 'error', 'invalid'] as const)('视频 %s 结束后释放元素且不留下验证计时器', async outcome => {
    const pending = files.openMedia('mv', new File(['video'], 'movie.webm'))
    const result = pending.catch(error => error)
    if (outcome === 'invalid') video.duration = Infinity
    video.dispatchEvent(new Event(outcome === 'error' ? 'error' : 'loadedmetadata'))
    const value = await result
    expect(outcome === 'success' ? value : value instanceof Error).toBe(true)
    expect(video.src).toBe('')
    expect(video.loads).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
    if (outcome === 'success') {
      expect(selection.getSource().media.mv).toMatchObject({ kind: 'file', durationSec: 2 })
      expect(revoked).toEqual([])
    } else {
      expect(selection.getSource().media.mv).toEqual({ kind: 'inherit' })
      expect(revoked).toEqual(['blob:candidate'])
    }
  })

  it.each(['audio', 'mv'] as const)('%s 解码失败释放临时元素并撤销候选 URL', async kind => {
    const pending = files.openMedia(kind, new File(['bad'], 'bad.media'))
    const result = pending.catch(error => error)
    await vi.advanceTimersByTimeAsync(0)
    video.dispatchEvent(new Event('error'))
    expect(await result).toBeInstanceOf(Error)
    expect(video.src).toBe('')
    expect(video.loads).toBe(kind === 'mv' ? 2 : 0)
    expect(revoked).toEqual(['blob:candidate'])
    expect(selection.getSource().media[kind]).toEqual({ kind: 'inherit' })
  })

  it.each(['audio', 'mv', 'cover'] as const)('%s 无响应会超时报错并保留旧来源', async kind => {
    image.decode.mockImplementation(() => new Promise(() => {}))
    const before = selection.getSource()
    const result = files.openMedia(kind, new File(['media'], 'pending')).catch(error => error)
    await vi.advanceTimersByTimeAsync(30000)
    let settled = false
    void result.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(true)
    expect(await result).toMatchObject({ message: expect.stringMatching(/超时.*重试/) })
    expect(selection.getSource()).toBe(before)
    expect(kind === 'mv' ? video.src : image.src).toBe('')
    expect(revoked).toEqual(['blob:candidate'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('视频验证期间保存元数据，完成后合并到最新来源', async () => {
    const pending = files.openMedia('mv', new File(['video'], 'movie.webm'))
    selection.updateMetadata({ title: '验证期间保存的标题' })
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(await pending).toBe(true)
    expect(selection.getSource().metadata.title).toBe('验证期间保存的标题')
    expect(selection.getSource().media.mv).toMatchObject({ kind: 'file', durationSec: 2 })
  })

  it('视频验证期间卸载控制器，完成后不提交并释放候选', async () => {
    const pending = files.openMedia('mv', new File(['video'], 'movie.webm'))
    files.dispose()
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(await pending).toBe(false)
    expect(selection.getSource().media.mv).toEqual({ kind: 'inherit' })
    expect(video.src).toBe('')
    expect(revoked).toEqual(['blob:candidate'])
  })

  it('同种媒体后发优先，不同媒体互不取消', async () => {
    const first = video
    const firstPending = files.openMedia('mv', new File(['video'], 'old.webm'))
    video = new MediaElement()
    let id = 0
    vi.stubGlobal('URL', { createObjectURL: () => `blob:next-${id++}`, revokeObjectURL: (url: string) => revoked.push(url) })
    const secondPending = files.openMedia('mv', new File(['video'], 'new.webm'))
    const coverPending = files.openMedia('cover', new File(['image'], 'cover.png'))
    video.dispatchEvent(new Event('loadedmetadata'))
    first.dispatchEvent(new Event('loadedmetadata'))
    expect(await firstPending).toBe(false)
    expect(await secondPending).toBe(true)
    expect(await coverPending).toBe(true)
    expect(selection.getSource().media.mv).toMatchObject({ kind: 'file', name: 'new.webm' })
    expect(selection.getSource().media.cover).toMatchObject({ kind: 'file', name: 'cover.png' })
    expect(revoked).toEqual(['blob:candidate'])
  })

  it('曲绘解码失败清空临时图片并撤销候选 URL', async () => {
    image.decode.mockRejectedValue(new Error('bad image'))
    await expect(files.openMedia('cover', new File(['bad'], 'bad.png'))).rejects.toThrow()
    expect(image.src).toBe('')
    expect(revoked).toEqual(['blob:candidate'])
    expect(selection.getSource().media.cover).toEqual({ kind: 'inherit' })
  })
})
