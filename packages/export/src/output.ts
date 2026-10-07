/**
 * 导出写入目标：MP4 流式写入 OPFS 临时文件，封装完成后以磁盘文件提供下载，不在内存中保留成片；
 * WebM 或浏览器不支持 OPFS 写入时写入内存。
 */
import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny'
import type { ContainerFormat } from './presets'

/** OPFS 中存放导出临时文件的目录。 */
const TEMP_DIR = 'sukushow-export'
/** 固定文件名：新一次导出覆盖上一次的结果，临时文件最多一个。 */
const TEMP_FILE = 'export.mp4'

export type ExportTarget = {
  readonly target: Target
  /** 是否边封装边写入磁盘。 */
  readonly streaming: boolean
  /** 封装完成后取得成片；写入 OPFS 时返回磁盘文件的引用，不复制数据。 */
  result(mimeType: string): Promise<Blob>
  /** 导出失败或取消时清理临时文件。 */
  discard(): Promise<void>
}

export async function createExportTarget(container: ContainerFormat): Promise<ExportTarget> {
  if (container === 'mp4') {
    const file = await openTempFile().catch(() => null)
    if (file) {
      return {
        target: new StreamTarget(file.writable as WritableStream<StreamTargetChunk>, { chunked: true }),
        streaming: true,
        result: async (mimeType) => new Blob([await file.handle.getFile()], { type: mimeType }),
        discard: discardExportFile,
      }
    }
  }
  const target = new BufferTarget()
  return {
    target,
    streaming: false,
    result: async (mimeType) => {
      if (!target.buffer) throw new Error('封装失败：没有输出数据')
      return new Blob([target.buffer], { type: mimeType })
    },
    discard: async () => {},
  }
}

/** 删除 OPFS 中的导出临时文件；不存在或不支持时忽略。 */
export async function discardExportFile(): Promise<void> {
  try {
    const dir = await tempDirectory(false)
    await dir?.removeEntry(TEMP_FILE)
  } catch {
    // 文件不存在或浏览器不支持
  }
}

async function tempDirectory(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return null
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(TEMP_DIR, { create })
}

async function openTempFile(): Promise<{ handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | null> {
  const dir = await tempDirectory(true)
  if (!dir) return null
  const handle = await dir.getFileHandle(TEMP_FILE, { create: true })
  if (typeof handle.createWritable !== 'function') return null
  return { handle, writable: await handle.createWritable() }
}
