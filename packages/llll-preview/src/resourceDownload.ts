export type DownloadProgress = {
  phase: 'download' | 'ready'
  downloadedBytes: number
  totalBytes?: number
}

/** Fetch exposes decoded bytes, so an encoded Content-Length is not comparable. */
export function responseSize(response: Response): number | undefined {
  if (response.headers?.get('content-encoding')) return undefined
  const header = response.headers?.get('content-length')
  if (header === null || header === undefined) return undefined
  const size = Number(header)
  return Number.isFinite(size) && size >= 0 ? size : undefined
}

/** Read each body chunk once and report the actual cumulative byte count. */
export async function readResponseBytes(
  response: Response,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Uint8Array> {
  const totalBytes = responseSize(response)
  let downloadedBytes = 0
  onProgress?.({ phase: 'download', downloadedBytes, totalBytes })
  if (!onProgress || !response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onProgress?.({ phase: 'ready', downloadedBytes: bytes.byteLength, totalBytes })
    return bytes
  }
  const chunks: Uint8Array[] = []
  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      downloadedBytes += value.byteLength
      onProgress({ phase: 'download', downloadedBytes, totalBytes })
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(downloadedBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  onProgress({ phase: 'ready', downloadedBytes, totalBytes })
  return bytes
}

/** All callers of a cached JSON request receive the same live progress. */
export function cachedJsonResource<T>(url: string, label: string) {
  let promise: Promise<T> | undefined
  let progress: DownloadProgress | undefined
  const listeners = new Set<(progress: DownloadProgress) => void>()
  const notify = (next: DownloadProgress) => {
    progress = next
    for (const listener of listeners) listener(next)
  }
  return (onProgress?: (progress: DownloadProgress) => void): Promise<T> => {
    if (onProgress) {
      listeners.add(onProgress)
      if (progress) onProgress(progress)
    }
    promise ??= fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`${label}加载失败（${response.status}）：${url}`)
      if (!response.body && typeof response.arrayBuffer !== 'function' && typeof response.json === 'function') {
        return await response.json() as T
      }
      const bytes = await readResponseBytes(response, notify)
      return JSON.parse(new TextDecoder().decode(bytes)) as T
    })
    return promise.finally(() => {
      if (onProgress) listeners.delete(onProgress)
    })
  }
}
