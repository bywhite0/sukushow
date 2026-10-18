/**
 * 本地资源目录：让用户直接指向本机已解包的原包资源，站点本身不再携带这些文件。
 *
 * 覆盖 `link-assets.py` 链接进来的四类（MV / BGM / 曲绘 / 谱面）：它们都不入库，
 * 部署时也不进产物。用户选中一个或多个目录后，本模块按**文件名**建立索引，
 * 把原本的公开路径（`/assets/mv/103103.mp4` 之类）映射到本地文件。
 *
 * 目录句柄存进 IndexedDB，下次进入站点可以一键恢复（Chromium 需再确认一次权限）。
 * Firefox / Safari 没有 `showDirectoryPicker`，退回 `<input webkitdirectory>`，
 * 此时句柄不可持久化，刷新后要重新选择。
 */

/** 索引里的一条：只记名字，取 File 时才真正访问磁盘。 */
type Entry = { name: string; file: () => Promise<File | null> }

export type LocalLibrary = {
  /** `directory` 来自 File System Access，可持久化；`input` 每次都要重选。 */
  readonly origin: 'directory' | 'input'
  readonly label: string
  /** 文件名（含扩展名）是否在索引里。 */
  has(name: string): boolean
  /** 按文件名取 File；不存在或已被移走时返回 null。 */
  file(name: string): Promise<File | null>
  /** 索引里的全部文件名，用于诊断与 UI 展示。 */
  names(): string[]
}

const DB_NAME = 'sukushow-local-assets'
const DB_STORE = 'handles'
const DB_KEY = 'root'

// ── 文件名 → 资源 的候选规则 ─────────────────────────────────────
//
// 只按文件名匹配，不依赖目录层级，所以用户可以直接选 4L/cache/plain，
// 也可以选任意整理过的目录。
//
// 只覆盖**浏览器能直接消费**的两类：
//   MV    原包 USM（无损重封装成 MP4，见 usm.ts），或现成的视频文件
//   谱面  原包 .bytes（raw deflate，decodeChart 已能解），或自制谱 JSON
// BGM 是 CRI ACB/AWB 里的 HCA，曲绘是 UnityFS + Texture2D，都需要额外的解码器；
// 这两类站点已经完整自带，本地目录不参与。

/** 浏览器 `<video>` 能直接播的容器；`.usm` 需要先重封装。 */
const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'm4v'] as const

/**
 * MV：原包 `music_lyric_video_<id>.usm` 优先，其次 `<id>.<视频扩展名>`。
 *
 * 顺序上 USM 在前：原包目录里就是这个名字，用户直接指过去就能用。
 */
export function mvCandidates(songId: string): string[] {
  return [`music_lyric_video_${songId}.usm`,
    ...VIDEO_EXTS.map((ext) => `${songId}.${ext}`)]
}

/**
 * 谱面：原包 `rhythmgame_chart_<Id>_<n>.bytes` 优先，其次同名 `.json`。
 *
 * `.json` 是自制谱的常见形态，`decodeChart` 两种都能解。
 */
export function chartCandidates(filename: string): string[] {
  const base = filename.replace(/\.(bytes|json)$/i, '')
  return [`${base}.bytes`, `${base}.json`]
}

/**
 * 从公开路径反推候选文件名。
 *
 * MV 的站点路径是 HLS 播放列表 `/assets/mv/<id>/index.m3u8`（分段下发，
 * 绕开 Workers 单文件 25 MiB 上限）；老产物是 `/assets/mv/<id>.mp4`。
 * 两种都归一到同一组本地候选：原包 USM 或现成视频文件。
 */
export function candidatesForPath(path: string): string[] {
  const hls = /^\/assets\/mv\/(\d+)\/index\.m3u8$/.exec(path)
  if (hls) return mvCandidates(hls[1]!)
  const base = path.split('/').pop() ?? ''
  const mv = /^(\d+)\.mp4$/.exec(base)
  if (mv) return mvCandidates(mv[1]!)
  // 谱面：文件名本身即可
  return base ? [base] : []
}

// ── 目录读取 ─────────────────────────────────────────────────────

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
}

/** 递归收集文件名 → 句柄。只登记名字，不读文件内容。 */
async function indexHandle(root: FileSystemDirectoryHandle, limit = 20_000): Promise<Map<string, FileSystemFileHandle>> {
  const out = new Map<string, FileSystemFileHandle>()
  const queue: FileSystemDirectoryHandle[] = [root]
  while (queue.length && out.size < limit) {
    const dir = queue.shift()!
    try {
      for await (const child of (dir as DirHandle).values()) {
        if (out.size >= limit) break
        if (child.kind === 'directory') queue.push(child as FileSystemDirectoryHandle)
        else {
          const handle = child as FileSystemFileHandle
          // 同名文件保留第一个（多目录合并时先到先得）
          if (!out.has(handle.name)) out.set(handle.name, handle)
        }
      }
    } catch {
      // 无权限的子目录跳过即可
    }
  }
  return out
}

function libraryFromHandles(
  handles: Map<string, FileSystemFileHandle>,
  label: string,
  origin: LocalLibrary['origin'],
): LocalLibrary {
  return {
    origin,
    label,
    has: (name) => handles.has(name),
    file: async (name) => {
      const handle = handles.get(name)
      if (!handle) return null
      try { return await handle.getFile() } catch { return null }
    },
    names: () => [...handles.keys()],
  }
}

// ── IndexedDB：持久化目录句柄 ────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(DB_STORE) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

async function readHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readonly')
    const request = tx.objectStore(DB_STORE).get(DB_KEY)
    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
    request.onerror = () => resolve(null)
    tx.oncomplete = () => db.close()
  })
}

async function writeHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite')
      if (handle) tx.objectStore(DB_STORE).put(handle, DB_KEY)
      else tx.objectStore(DB_STORE).delete(DB_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      // 句柄不可序列化（旧浏览器）或配额不足时，持久化失败不影响本次使用。
      tx.onerror = () => { db.close(); resolve() }
      tx.onabort = () => { db.close(); resolve() }
    } catch {
      db.close()
      resolve()
    }
  })
}

// ── 权限 ─────────────────────────────────────────────────────────

type PermissionCapable = {
  queryPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

/** 已授权返回 true；需要用户手势时返回 false。 */
export async function hasPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as unknown as PermissionCapable
  if (!capable.queryPermission) return true
  return await capable.queryPermission({ mode: 'read' }) === 'granted'
}

/** 在用户手势里请求权限。 */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const capable = handle as unknown as PermissionCapable
  if (!capable.requestPermission) return true
  return await capable.requestPermission({ mode: 'read' }) === 'granted'
}

// ── 对外 API ─────────────────────────────────────────────────────

export const supportsDirectoryPicker = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

/**
 * 弹出目录选择器并建立索引。
 *
 * 返回 null 表示用户取消。不支持 File System Access 时抛错，调用方应退回 `libraryFromInput`。
 */
export async function pickDirectory(): Promise<LocalLibrary | null> {
  if (!supportsDirectoryPicker()) throw new Error('当前浏览器不支持目录选择')
  const picker = (window as unknown as {
    showDirectoryPicker(options?: { mode?: 'read' }): Promise<FileSystemDirectoryHandle>
  }).showDirectoryPicker
  let handle: FileSystemDirectoryHandle
  try {
    handle = await picker({ mode: 'read' })
  } catch (error) {
    // 用户取消（AbortError）不是失败
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  const handles = await indexHandle(handle)
  await writeHandle(handle)
  return libraryFromHandles(handles, handle.name, 'directory')
}

/** 恢复上次选的目录；没有记录、或权限已被浏览器收回时返回 null。 */
export async function restoreDirectory(): Promise<LocalLibrary | null> {
  const handle = await readHandle()
  if (!handle) return null
  if (!await hasPermission(handle)) return null
  const handles = await indexHandle(handle)
  return libraryFromHandles(handles, handle.name, 'directory')
}

/** 上次有记录但需要用户手势重新授权时返回句柄，供按钮触发。 */
export async function pendingHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await readHandle()
  if (!handle) return null
  return await hasPermission(handle) ? null : handle
}

/** 用待授权的句柄重建索引（必须在用户手势里调用）。 */
export async function grantPending(handle: FileSystemDirectoryHandle): Promise<LocalLibrary | null> {
  if (!await requestPermission(handle)) return null
  const handles = await indexHandle(handle)
  return libraryFromHandles(handles, handle.name, 'directory')
}

/** 从 `<input webkitdirectory>` 的 FileList 建索引（不支持目录 API 的浏览器）。 */
export function libraryFromInput(files: FileList | File[]): LocalLibrary {
  const handles = new Map<string, File>()
  for (const file of Array.from(files)) {
    // webkitRelativePath 带目录，只取文件名
    const name = file.name
    if (!handles.has(name)) handles.set(name, file)
  }
  return {
    origin: 'input',
    label: '已选择的文件夹',
    has: (name) => handles.has(name),
    file: async (name) => handles.get(name) ?? null,
    names: () => [...handles.keys()],
  }
}

/** 清掉持久化的目录记录。 */
export async function forgetDirectory(): Promise<void> {
  await writeHandle(null)
}
