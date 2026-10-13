export type SourceBindingOptions<State extends { revision: number }, Resolved> = {
  resolve: (state: State, signal: AbortSignal) => Promise<Resolved>
  apply: (source: Resolved, current: () => boolean, signal: AbortSignal) => Promise<void>
  empty: (state: State) => void
  error: (error: unknown) => void
  pause?: () => void
  retain?: (state: State) => () => void
}

export async function waitForSource<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void pending.catch(() => {})
    throw new DOMException('来源已失效', 'AbortError')
  }
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('来源已失效', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try { return await Promise.race([pending, cancelled]) }
  finally { signal.removeEventListener('abort', abort) }
}

export function createSourceBinding<State extends { revision: number }, Resolved>(options: SourceBindingOptions<State, Resolved>): {
  update(state: State): void
  dispose(): Promise<void>
} {
  type Pending = { state: State; release: () => void }
  let disposed = false
  let latest = -Infinity
  let queued: Pending | null = null
  let running: Promise<void> = Promise.resolve()
  let controller: AbortController | undefined
  const activeLeases = new Set<() => void>()

  const releaseActive = () => {
    for (const release of activeLeases) release()
    activeLeases.clear()
  }
  const apply = async (pending: Pending) => {
    const { state, release } = pending
    let entered = false
    const current = () => !disposed && state.revision === latest
    try {
      controller = new AbortController()
      const signal = controller.signal
      const source = await waitForSource(options.resolve(state, signal), signal)
      if (!current()) return
      entered = true
      // 应用失败也可能已经把 URL 交给播放器，留到替换成功或卸载后释放。
      if (source !== null && typeof source === 'object' && 'chart' in source && source.chart === null) {
        options.empty(state)
      } else await options.apply(source, current, signal)
      if (current()) releaseActive()
    } catch (error) {
      if (current()) options.error(error)
    } finally {
      controller = undefined
      if (entered) activeLeases.add(release)
      else release()
    }
  }
  const drain = async () => {
    while (queued !== null && !disposed) {
      const pending = queued
      queued = null
      await apply(pending)
    }
  }

  const update = (state: State) => {
    if (disposed || state.revision <= latest) return
    const release = options.retain?.(state) ?? (() => {})
    latest = state.revision
    controller?.abort()
    queued?.release()
    queued = { state, release }
    options.pause?.()
    running = running.then(drain)
  }
  const dispose = async () => {
    disposed = true
    controller?.abort()
    queued?.release()
    queued = null
    await running
    releaseActive()
  }
  return { update, dispose }
}
