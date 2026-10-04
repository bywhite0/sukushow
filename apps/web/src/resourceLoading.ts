export type ResourceLoadingTask = {
  setLabel: (label: string) => void
  update: (done: number, detail?: string, download?: { downloadedBytes?: number; totalBytes?: number }) => void
  finish: (detail?: string) => void
  fail: (detail: string) => void
}

export type ResourceLoadingController = {
  begin: (label: string, total?: number) => ResourceLoadingTask
  cancel: () => void
}

type TaskState = {
  id: number
  label: string
  detail: string
  downloadedBytes: number | null
  totalBytes: number | null
  done: number
  total: number | null
  active: boolean
  failed: boolean
}

export function formatResourceSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '大小未知'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = units[0]!
  for (let index = 1; index < units.length && value >= 1000; index += 1) {
    value /= 1000
    unit = units[index]!
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${unit}`
}

function finiteTotal(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null
}

function clampDone(done: number, total: number | null): number {
  if (!Number.isFinite(done)) return 0
  return total === null ? Math.max(0, done) : Math.min(total, Math.max(0, done))
}

/**
 * A prominent, stage-local loading surface shared by both preview engines.
 * Each asynchronous resource group owns a task, so overlapping chart and
 * renderer loads keep the overlay visible until every group is ready.
 */
export function createResourceLoading(stage: HTMLElement, lockTarget?: HTMLElement | HTMLElement[]): ResourceLoadingController {
  const overlay = stage.querySelector<HTMLElement>('[data-resource-loading]')
  const title = overlay?.querySelector<HTMLElement>('[data-resource-loading-title]')
  const detail = overlay?.querySelector<HTMLElement>('[data-resource-loading-detail]')
  const size = overlay?.querySelector<HTMLElement>('[data-resource-loading-size]')
  const progress = overlay?.querySelector<HTMLProgressElement>('[data-resource-loading-progress]')
  const percent = overlay?.querySelector<HTMLOutputElement>('[data-resource-loading-percent]')

  if (!overlay || !title || !detail || !size || !progress || !percent) {
    throw new Error('缺少资源加载提示元素。')
  }

  const tasks = new Map<number, TaskState>()
  const targets = lockTarget ? (Array.isArray(lockTarget) ? lockTarget : [lockTarget]) : []
  const controls = targets.flatMap((target) => [...target.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button,input,select,textarea')])
  const disabledBefore = new Map<HTMLElement, boolean>(controls.map((control) => [control, control.disabled]))
  let nextId = 0

  const setControlsLocked = (locked: boolean) => {
    for (const control of controls) {
      control.disabled = locked ? true : (disabledBefore.get(control) ?? false)
    }
    for (const target of targets) {
      target.setAttribute('aria-busy', String(locked))
    }
  }

  const refresh = () => {
    if (tasks.size === 0) {
      overlay.hidden = true
      stage.classList.remove('is-resource-loading')
      stage.removeAttribute('aria-busy')
      setControlsLocked(false)
      overlay.classList.remove('is-error')
      size.hidden = true
      size.textContent = ''
      return
    }

    const states = [...tasks.values()]
    const current = states[states.length - 1]!
    const hasError = states.some((task) => task.failed)
    const determinate = states.every((task) => task.total !== null)
    const total = states.reduce((sum, task) => sum + (task.total ?? 0), 0)
    const done = states.reduce((sum, task) => sum + task.done, 0)

    overlay.hidden = false
    overlay.classList.toggle('is-error', hasError)
    stage.classList.add('is-resource-loading')
    stage.setAttribute('aria-busy', 'true')
    setControlsLocked(true)
    title.textContent = hasError && current.failed ? '资源加载失败' : current.label
    detail.textContent = current.detail
    const downloadedBytes = states.reduce((sum, task) => sum + (task.downloadedBytes ?? 0), 0)
    const totalBytes = states.reduce((sum, task) => sum + (task.totalBytes ?? 0), 0)
    if (totalBytes > 0) {
      size.hidden = false
      size.textContent = `(已下载 ${formatResourceSize(downloadedBytes)} / ${formatResourceSize(totalBytes)})`
    } else {
      size.hidden = true
      size.textContent = ''
    }

    if (determinate && total > 0) {
      progress.max = total
      progress.value = Math.min(total, done)
      percent.textContent = `${Math.round((done / total) * 100)}%`
    } else {
      progress.removeAttribute('value')
      percent.textContent = hasError ? '请刷新重试' : '加载中…'
    }
  }

  const begin = (label: string, total?: number): ResourceLoadingTask => {
    const state: TaskState = {
      id: ++nextId,
      label,
      detail: '准备中…',
      downloadedBytes: null,
      totalBytes: null,
      done: 0,
      total: finiteTotal(total),
      active: true,
      failed: false,
    }
    tasks.set(state.id, state)
    refresh()

    const update = (done: number, nextDetail?: string, download?: { downloadedBytes?: number; totalBytes?: number }) => {
      if (!state.active || state.failed) return
      state.done = clampDone(done, state.total)
      if (nextDetail) state.detail = nextDetail
      if (download?.downloadedBytes !== undefined) state.downloadedBytes = Math.max(0, download.downloadedBytes)
      if (download?.totalBytes !== undefined) state.totalBytes = Math.max(0, download.totalBytes)
      refresh()
    }

    const setLabel = (nextLabel: string) => {
      if (!state.active || state.failed) return
      state.label = nextLabel
      state.downloadedBytes = null
      state.totalBytes = null
      refresh()
    }

    const finish = (nextDetail?: string) => {
      if (!state.active) return
      state.active = false
      if (nextDetail) state.detail = nextDetail
      tasks.delete(state.id)
      refresh()
    }

    const fail = (nextDetail: string) => {
      if (!state.active) return
      state.failed = true
      state.detail = nextDetail
      refresh()
    }

    return { setLabel, update, finish, fail }
  }

  return {
    begin,
    cancel: () => {
      for (const task of tasks.values()) task.active = false
      tasks.clear()
      refresh()
    },
  }
}
