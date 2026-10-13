import { decodeChart, parseChart, type Chart } from '@sukushow/chart/chart'
import type { MediaKind, MediaOverride } from './songSelection'
import { SongSelectionStore } from './songSelection'
import { releaseImages } from '@sukushow/llll-preview/canvasKit'

const MAX_CHART_BYTES = 16 * 1024 * 1024

type RetainedUrl = { refs: number; pending: boolean }

export function createSourceFiles(store: SongSelectionStore): {
  openChart(file: File, current?: () => boolean): Promise<boolean>
  openMedia(kind: MediaKind, file: File): Promise<boolean>
  clearMedia(kind: MediaKind): void
  inheritMedia(kind: MediaKind): void
  retain(urls: readonly string[]): () => void
  dispose(): void
} {
  const tokens: Record<MediaKind, number> = { audio: 0, cover: 0, mv: 0 }
  const urls = new Map<string, RetainedUrl>()
  let disposed = false
  let chartToken = 0

  const collect = () => {
    const selected = new Set(disposed ? [] : Object.values(store.getSource().media)
      .flatMap(media => media.kind === 'file' ? [media.url] : []))
    for (const [url, entry] of urls) {
      if (entry.refs || entry.pending || selected.has(url)) continue
      urls.delete(url)
      releaseImages([url])
      URL.revokeObjectURL(url)
    }
  }
  const unsubscribe = store.subscribeSource(collect)

  const retain = (values: readonly string[]) => {
    const owned = [...new Set(values)].filter(url => urls.has(url))
    for (const url of owned) urls.get(url)!.refs++
    let active = true
    return () => {
      if (!active) return
      active = false
      for (const url of owned) {
        const entry = urls.get(url)
        if (entry) entry.refs--
      }
      collect()
    }
  }

  const commitMedia = (kind: MediaKind, value: MediaOverride) => {
    store.updateMedia(kind, value)
  }

  const validateMedia = async (kind: MediaKind, url: string, file: File): Promise<number | null> => {
    if (typeof document === 'undefined') return null
    const context = kind === 'audio' ? new AudioContext() : null
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('媒体验证超时，请重试')), 30000)
    })
    if (context) {
      try {
        const buffer = await Promise.race([
          file.arrayBuffer().then(bytes => context.decodeAudioData(bytes)), timeout,
        ])
        if (!Number.isFinite(buffer.duration) || buffer.duration < 0) throw new Error('媒体时长无效')
        return buffer.duration
      } finally {
        clearTimeout(timer)
        await context.close()
      }
    }
    if (kind === 'cover') {
      const image = new Image()
      try {
        image.src = url
        await Promise.race([image.decode(), timeout])
        if (image.naturalWidth <= 0 || image.naturalHeight <= 0) throw new Error('曲绘无法解码')
        return null
      } finally {
        clearTimeout(timer)
        image.removeAttribute('src')
      }
    }
    const element = document.createElement('video')
    if (kind === 'mv') {
      ;(element as HTMLVideoElement).muted = true
      ;(element as HTMLVideoElement).playsInline = true
    }
    element.preload = 'metadata'
    let ready!: () => void
    let failed!: () => void
    try {
      const metadata = new Promise<number>((resolve, reject) => {
        ready = () => {
          const value = element.duration
          if (!Number.isFinite(value) || value < 0) reject(new Error('媒体时长无效'))
          else resolve(value)
        }
        failed = () => reject(new Error('媒体无法解码'))
        element.addEventListener('loadedmetadata', ready, { once: true })
        element.addEventListener('error', failed, { once: true })
        element.src = url
        element.load()
      })
      return await Promise.race([metadata, timeout])
    } finally {
      clearTimeout(timer)
      element.removeEventListener('loadedmetadata', ready)
      element.removeEventListener('error', failed)
      element.removeAttribute('src')
      element.load()
    }
  }

  const openChart = async (file: File, current = () => true): Promise<boolean> => {
    if (disposed || !current()) return false
    if (file.size > MAX_CHART_BYTES) throw new Error('谱面文件超过 16 MiB')
    const token = ++chartToken
    const identity = store.getSource().identity
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (disposed || token !== chartToken || !current() || identity !== store.getSource().identity) return false
    let chart: Chart
    try {
      const text = new TextDecoder().decode(bytes).replace(/^﻿/, '').trimStart()
      chart = text.startsWith('{') ? parseChart(JSON.parse(text)) : decodeChart(bytes)
    } catch (error) {
      throw new Error(`谱面读取失败：${String(error)}`)
    }
    if (disposed || !current() || identity !== store.getSource().identity) return false
    store.openCustom(chart, file.name)
    return true
  }

  const openMedia = async (kind: MediaKind, file: File): Promise<boolean> => {
    if (disposed) return false
    if (kind === 'audio' && file.size > 128 * 1024 * 1024) throw new Error('音频超过 128 MiB')
    const identity = store.getSource().identity
    const token = ++tokens[kind]
    const url = URL.createObjectURL(file)
    const entry = { refs: 0, pending: true }
    urls.set(url, entry)
    try {
      const durationSec = await validateMedia(kind, url, file)
      if (disposed || token !== tokens[kind] || identity !== store.getSource().identity) return false
      commitMedia(kind, { kind: 'file', url, name: file.name, durationSec })
      return true
    } finally {
      entry.pending = false
      collect()
    }
  }

  const clearMedia = (kind: MediaKind) => { ++tokens[kind]; commitMedia(kind, { kind: 'none' }) }
  const inheritMedia = (kind: MediaKind) => { ++tokens[kind]; commitMedia(kind, { kind: 'inherit' }) }
  const dispose = () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    collect()
  }

  return { openChart, openMedia, clearMedia, inheritMedia, retain, dispose }
}
