import { parseMetadataDraft, type MetadataDraft } from './sourceMetadata'
import type { MediaKind, SourceMetadata } from './songSelection'
import { SongSelectionStore } from './songSelection'

export type SourceFiles = {
  openChart(file: File): Promise<boolean>
  openMedia(kind: MediaKind, file: File): Promise<boolean>
  clearMedia(kind: MediaKind): void
  inheritMedia(kind: MediaKind): void
  retain(urls: readonly string[]): () => void
  dispose(): void
}

export function createSourceControls(options: {
  root: HTMLElement
  store: SongSelectionStore
  files: SourceFiles
  effectiveMetadata: () => SourceMetadata | Promise<SourceMetadata>
  chartOpened?: () => void
}): { dispose(): void } {
  const { root, store, files, effectiveMetadata } = options
  const chartInput = root.querySelector<HTMLInputElement>('#chart-file')
  const mediaInputs: Partial<Record<MediaKind, HTMLInputElement | null>> = {
    audio: root.querySelector<HTMLInputElement>('#audio-file'), cover: root.querySelector<HTMLInputElement>('#cover-file'), mv: root.querySelector<HTMLInputElement>('#mv-file'),
  }
  const edit = root.querySelector<HTMLButtonElement>('#edit-metadata')
  if (!edit) return { dispose: () => {} }

  let dialog = root.querySelector<HTMLDialogElement>('#metadata-dialog')
  if (!dialog) {
    dialog = document.createElement('dialog')
    dialog.id = 'metadata-dialog'
    dialog.innerHTML = `<form method="dialog" data-metadata-form>
      <h2>编辑自制谱元数据</h2>
      <label>曲名<input name="title" required></label>
      <label>难度<input name="difficulty"></label>
      <label>谱师<input name="scoreCreator"></label>
      <label>作词<input name="lyricist"></label><label>作曲<input name="composer"></label>
      <label>编曲<input name="arranger"></label><label>演唱<input name="vocal"></label>
      <label>音频偏移（毫秒）<input name="offsetMs" type="number" step="any"></label>
      <label>Fever 开始（秒）<input name="feverStart" type="number" step="any"></label>
      <label>Fever 结束（秒）<input name="feverEnd" type="number" step="any"></label>
      <label>曲终时间（秒）<input name="finishTime" type="number" min="0" step="any"></label>
      <p data-metadata-error role="alert"></p>
      <button type="button" data-metadata-cancel>取消</button>
      <button type="submit">保存</button>
    </form>`
    root.append(dialog)
  }
  const form = dialog.querySelector<HTMLFormElement>('[data-metadata-form]')!
  const error = dialog.querySelector<HTMLElement>('[data-metadata-error]')!
  const get = (name: keyof MetadataDraft) => form.elements.namedItem(name) as HTMLInputElement
  const write = (metadata: SourceMetadata) => {
    const values: MetadataDraft = {
      title: metadata.title, difficulty: metadata.difficulty ?? '', scoreCreator: metadata.scoreCreator ?? '',
      lyricist: metadata.lyricist ?? '', composer: metadata.composer ?? '', arranger: metadata.arranger ?? '',
      vocal: metadata.vocal ?? '', offsetMs: String(metadata.offsetMs), feverStart: metadata.fever ? String(metadata.fever.start) : '',
      feverEnd: metadata.fever ? String(metadata.fever.end) : '', finishTime: metadata.finishTime === null ? '' : String(metadata.finishTime),
    }
    for (const [key, value] of Object.entries(values)) get(key as keyof MetadataDraft).value = value
  }
  let editIdentity = 0
  let disposed = false
  const unsubscribe = store.subscribeSource(state => {
    edit.disabled = state.chart.kind !== 'custom'
    for (const kind of ['audio', 'cover', 'mv'] as const) {
      const row = root.querySelector<HTMLElement>(`[data-media-kind="${kind}"]`)
      if (!row) continue
      const media = state.media[kind]
      row.querySelector<HTMLElement>('[data-media-status]')!.textContent = media.kind === 'file'
        ? media.name : media.kind === 'none' ? '已清除' : state.songId ? '歌曲资源' : '未提供'
      row.querySelector<HTMLButtonElement>('[data-media-inherit]')!.disabled = !state.songId || media.kind === 'inherit'
    }
  }, true)
  const openEditor = async () => {
    const state = store.getSource()
    if (state.chart.kind !== 'custom') return
    const revision = state.revision
    try {
      const metadata = await effectiveMetadata()
      if (disposed || store.getSource().revision !== revision) return
      editIdentity = state.identity
      write(metadata)
      error.textContent = ''
      dialog!.showModal()
    } catch (value) { reportFileError(value) }
  }
  const save = (event: SubmitEvent) => {
    event.preventDefault()
    if (store.getSource().identity !== editIdentity) { error.textContent = '来源已变化，请重新打开编辑器'; return }
    try {
      store.updateMetadata(parseMetadataDraft({
        title: get('title').value, difficulty: get('difficulty').value, scoreCreator: get('scoreCreator').value,
        lyricist: get('lyricist').value, composer: get('composer').value, arranger: get('arranger').value,
        vocal: get('vocal').value, offsetMs: get('offsetMs').value, feverStart: get('feverStart').value,
        feverEnd: get('feverEnd').value, finishTime: get('finishTime').value,
      }))
      dialog!.close()
    } catch (value) { error.textContent = String(value) }
  }
  const cancel = () => dialog!.close()
  edit.onclick = openEditor
  form.addEventListener('submit', save)
  dialog.querySelector<HTMLButtonElement>('[data-metadata-cancel]')!.onclick = cancel
  const cleanups: (() => void)[] = []
  const reportFileError = (value: unknown) => {
    const status = root.querySelector<HTMLElement>('#source-status')
    if (status) status.textContent = `文件读取失败：${String(value)}`
  }
  const toggle = root.querySelector<HTMLButtonElement>('#media-toggle')
  const panel = root.querySelector<HTMLElement>('#media-panel')
  if (toggle && panel) {
    const close = (focus = false) => {
      panel.hidden = true
      toggle.setAttribute('aria-expanded', 'false')
      if (focus) toggle.focus()
    }
    const open = () => {
      panel.hidden = !panel.hidden
      toggle.setAttribute('aria-expanded', String(!panel.hidden))
      if (!panel.hidden) panel.querySelector<HTMLButtonElement>('button')?.focus()
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || panel.hidden) return
      event.preventDefault()
      close(true)
    }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !toggle.parentElement?.contains(event.target)) close()
    }
    toggle.addEventListener('click', open)
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    cleanups.push(() => {
      toggle.removeEventListener('click', open)
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('pointerdown', outside)
    })
  }
  for (const kind of ['audio', 'cover', 'mv'] as const) {
    const row = root.querySelector<HTMLElement>(`[data-media-kind="${kind}"]`)
    const clear = row?.querySelector<HTMLButtonElement>('[data-media-clear]')
    const inherit = row?.querySelector<HTMLButtonElement>('[data-media-inherit]')
    const clearMedia = () => files.clearMedia(kind)
    const inheritMedia = () => files.inheritMedia(kind)
    clear?.addEventListener('click', clearMedia)
    inherit?.addEventListener('click', inheritMedia)
    cleanups.push(() => {
      clear?.removeEventListener('click', clearMedia)
      inherit?.removeEventListener('click', inheritMedia)
    })
  }
  for (const kind of ['audio', 'cover', 'mv'] as const) {
    const button = root.querySelector<HTMLButtonElement>(`#open-${kind}`)
    const open = () => mediaInputs[kind]?.click()
    button?.addEventListener('click', open)
    cleanups.push(() => button?.removeEventListener('click', open))
  }
  const chartButton = root.querySelector<HTMLButtonElement>('#open-chart')
  const openChart = () => chartInput?.click()
  chartButton?.addEventListener('click', openChart)
  cleanups.push(() => chartButton?.removeEventListener('click', openChart))
  if (chartInput) {
    const handler = () => { const file = chartInput.files?.[0]; if (file) void files.openChart(file).then(opened => { if (opened) options.chartOpened?.() }).catch(reportFileError).finally(() => { chartInput.value = '' }) }
    chartInput.addEventListener('change', handler); cleanups.push(() => chartInput.removeEventListener('change', handler))
  }
  for (const kind of ['audio', 'cover', 'mv'] as const) {
    const input = mediaInputs[kind]
    if (!input) continue
    const handler = () => { const file = input.files?.[0]; if (file) void files.openMedia(kind, file).catch(reportFileError).finally(() => { input.value = '' }) }
    input.addEventListener('change', handler); cleanups.push(() => input.removeEventListener('change', handler))
  }
  return { dispose: () => { disposed = true; unsubscribe(); edit.onclick = null; form.removeEventListener('submit', save); cleanups.forEach(clean => clean()); dialog?.remove() } }
}
