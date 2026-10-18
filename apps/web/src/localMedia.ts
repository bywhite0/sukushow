/**
 * 本地资源接入层：把公开路径（`/assets/mv/103103.mp4` 之类）换成来自本地目录的 blob URL。
 *
 * 站点不再携带 MV / BGM / 曲绘 / 谱面；用户在本地选中原包目录后，
 * 这里负责按文件名找到文件、必要时重封装，并管理 blob URL 的生命周期。
 *
 * MV 的原包格式是 CRI USM，浏览器不能直接播；`usm.ts` 把它无损重封装成 MP4。
 * 重封装只在**当前曲目**需要时做一次，结果按 LRU 留在内存里，换歌时回收。
 */

import { buildMp4, parseUsm } from './usm'
import {
  candidatesForPath,
  chartCandidates,
  type LocalLibrary,
} from './localAssets'

export type { LocalLibrary }

/** 重封装后的 MV 体积可观（单首 25–60 MB），内存里只留最近两首。 */
const MV_CACHE_LIMIT = 2

type CacheEntry = { url: string; bytes: number }

let library: LocalLibrary | null = null
const mvCache = new Map<string, CacheEntry>()
const urlCache = new Map<string, string>()
/** 站点是否自带某 MV；结果是稳定的（同一构建不会变），缓存到换库也不清。 */
const siteMvCache = new Map<string, boolean>()
const listeners = new Set<(library: LocalLibrary | null) => void>()

export type LocalizeProgress = (detail: string) => void

/** 当前生效的本地资源库；null 表示全部走站点资源。 */
export function currentLibrary(): LocalLibrary | null {
  return library
}

export function setLibrary(next: LocalLibrary | null): void {
  if (library === next) return
  library = next
  revokeAll()
  for (const listener of listeners) listener(next)
}

export function subscribeLibrary(listener: (library: LocalLibrary | null) => void): () => void {
  listeners.add(listener)
  listener(library)
  return () => { listeners.delete(listener) }
}

function revokeAll(): void {
  for (const entry of mvCache.values()) URL.revokeObjectURL(entry.url)
  mvCache.clear()
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

/** 本地库里是否存在这个公开路径对应的文件。 */
export function hasLocal(path: string | null): boolean {
  if (!path || !library) return false
  return candidatesForPath(path).some((name) => library!.has(name))
}

/** 找出路径对应的本地文件；没有则返回 null。 */
async function findFile(path: string): Promise<File | null> {
  if (!library) return null
  for (const name of candidatesForPath(path)) {
    const file = await library.file(name)
    if (file) return file
  }
  return null
}

const isUsm = (file: File): boolean => /\.usm$/i.test(file.name)

/** 各容器对应的 MIME；`<video>` 靠它决定能不能播，不能省。 */
const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime',
  webm: 'video/webm', mkv: 'video/x-matroska',
}

function videoMime(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return VIDEO_MIME[ext] ?? (file.type.startsWith('video/') ? file.type : 'video/mp4')
}

/** 把 USM 重封装成 MP4；失败时抛错，由调用方决定是否回退站点资源。 */
async function remuxUsm(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const track = parseUsm(bytes)
  const mp4 = buildMp4(track)
  return new Blob([mp4 as BlobPart], { type: 'video/mp4' })
}

/** 缓存里取；没有就生成。key 用曲目/文件名，命中即复用。 */
function cacheMv(key: string, blob: Blob): string {
  const existing = mvCache.get(key)
  if (existing) return existing.url
  const url = URL.createObjectURL(blob)
  mvCache.set(key, { url, bytes: blob.size })
  while (mvCache.size > MV_CACHE_LIMIT) {
    const oldest = mvCache.keys().next().value
    if (oldest === undefined) break
    const entry = mvCache.get(oldest)!
    mvCache.delete(oldest)
    URL.revokeObjectURL(entry.url)
  }
  return url
}

/**
 * 站点上是否真的有这个 MV。
 *
 * 构建产物里 MV 走 HLS（目录 + 分片），未命中静态资源时服务器会回退到 SPA 的
 * index.html，请求本身仍是 200。所以不能只看状态码：用 HEAD 读 content-type，
 * 排除 text/html 就能区分「真资源」与「回退页面」，也不必下载正文。
 */
async function siteHasMv(path: string): Promise<boolean> {
  const cached = siteMvCache.get(path)
  if (cached !== undefined) return cached
  let exists = false
  try {
    const res = await fetch(path, { method: 'HEAD' })
    if (res.ok) {
      // 未命中静态资源时服务器会回退到 SPA 的 index.html，请求本身仍是 200，
      // 只有 content-type 能区分。反过来 HLS 播放列表的 content-type 各服务器
      // 不一致（空、text/plain、application/vnd.apple.mpegurl 都见过），
      // 所以这里只否定 html，不要求具体类型。
      const type = (res.headers.get('content-type') ?? '').toLowerCase()
      exists = !type.includes('text/html')
    }
  } catch {
    exists = false
  }
  siteMvCache.set(path, exists)
  return exists
}

/**
 * MV 在站点上的候选路径：HLS 播放列表优先，其次老产物的单个 MP4。
 *
 * 切分过的产物只有目录形态；没切分的（早期构建或部分资源）只有 mp4。
 * 两条都试一遍，取实际存在的那个。
 */
async function siteMvPath(path: string): Promise<string | null> {
  const hls = /^(.*)\/index\.m3u8$/i.exec(path)
  const candidates = hls ? [path, `${hls[1]}.mp4`] : [path]
  for (const candidate of candidates) {
    if (await siteHasMv(candidate)) return candidate
  }
  return null
}

/**
 * 解析 MV 来源：**站点优先**，站点没有才用本地目录。
 *
 * - 站点有该 MV → 原样返回站点路径
 * - 站点没有、本地有 `.usm` → 浏览器内无损重封装成 MP4，返回 blob URL
 * - 站点没有、本地有现成视频（mp4 / webm / mov / mkv / m4v）→ 直接返回 blob URL
 * - 都没有 → 原样返回（视图会显示 MV 未加载，与之前行为一致）
 *
 * 只有 MV 走这条：BGM 与曲绘的原包格式（CRI ACB/AWB、UnityFS）浏览器不能直接消费，
 * 而站点已完整自带这两类资源，所以不参与本地覆盖。
 */
export async function localizeMv(
  path: string | null,
  options: { onProgress?: LocalizeProgress } = {},
): Promise<string | null> {
  if (!path) return path
  // 站点已有就优先用站点的，本地目录只是补充。
  const site = await siteMvPath(path)
  if (site) return site
  if (!library) return path
  const cached = urlCache.get(path)
  if (cached) return cached
  const file = await findFile(path)
  if (!file) return path

  if (isUsm(file)) {
    options.onProgress?.(`正在重封装 ${file.name}（${formatMb(file.size)}）…`)
    let blob: Blob
    try {
      blob = await remuxUsm(file)
    } catch {
      // 文件不是合法 USM（选错目录、文件损坏、只拷了一半）时不能拖垮整首歌，
      // 当作本地没有这个 MV，继续用站点资源。
      return path
    }
    return cacheMv(path, blob)
  }

  // 现成的视频文件：按容器给 MIME，`<video>` 才能正确识别。
  const blob = file.type && file.type !== 'application/octet-stream'
    ? file : new Blob([file as BlobPart], { type: videoMime(file) })
  return cacheMv(path, blob)
}

/** 按文件名取本地谱面；没有则返回 null，由调用方回落到站点资源。 */
export async function localChart(filename: string): Promise<File | null> {
  if (!library) return null
  for (const name of chartCandidates(filename)) {
    const file = await library.file(name)
    if (file) return file
  }
  return null
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 释放全部 blob URL（页面卸载时调用）。 */
export function disposeLocalMedia(): void {
  revokeAll()
}
