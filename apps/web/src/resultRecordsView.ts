import { loadSongList, songAssets, type SongEntry } from '@sukushow/llll-preview/songAssets'
import {
  emptyResultRecords,
  exportResultRecords,
  loadResultRecords,
  mergeResultRecords,
  parseResultRecords,
  playerRateOfStore,
  rateOfRow,
  removeResultRecord,
  saveResultRecords,
  type ResultHistoryRecord,
  type ResultRecordRow,
  type ResultRecordStore,
} from './views/llll/resultRecords'

function formatRecordedAt(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function recordValues(row: ResultRecordRow): HTMLElement {
  const content = document.createElement('div')
  content.className = 'records-performance'
  content.innerHTML = `
    <dl class="records-values">
      <div><dt>分数</dt><dd data-record-score></dd></div>
      <div><dt>技术分</dt><dd data-record-technical></dd></div>
      <div><dt>Rate</dt><dd data-record-rate></dd></div>
    </dl>
    <dl class="records-judgements" aria-label="判定明细"></dl>
    <p class="records-combo" data-record-combo></p>
    <details class="records-conditions"><summary>FAST / LATE / FLICK 明细</summary>
      <table><thead><tr><th scope="col">判定</th><th scope="col">FAST</th><th scope="col">LATE</th><th scope="col">FLICK</th></tr></thead><tbody></tbody></table>
    </details>`
  content.querySelector<HTMLElement>('[data-record-score]')!.textContent = row.score.toLocaleString('zh-CN')
  content.querySelector<HTMLElement>('[data-record-technical]')!.textContent = `${row.technicalPercent.toFixed(4)}%`
  content.querySelector<HTMLElement>('[data-record-rate]')!.textContent = String(row.cleared ? rateOfRow(row) : 0)
  const judgements = content.querySelector<HTMLElement>('.records-judgements')!
  const labels = ['MISS', 'BAD', 'GOOD', 'GREAT', 'PERFECT', 'PERFECT+']
  for (let index = 5; index >= 0; index--) {
    const pair = document.createElement('div')
    const term = document.createElement('dt')
    const value = document.createElement('dd')
    term.textContent = labels[index]!
    value.textContent = String(row.judgements[index])
    pair.append(term, value)
    judgements.append(pair)
  }
  for (let index = 4; index >= 1; index--) {
    const tr = document.createElement('tr')
    tr.dataset.judgement = String(index)
    const th = document.createElement('th')
    th.scope = 'row'
    th.textContent = labels[index]!
    tr.append(th)
    for (const count of row.judgementConditions[index]!) {
      const td = document.createElement('td')
      td.textContent = String(count)
      tr.append(td)
    }
    content.querySelector('tbody')!.append(tr)
  }
  content.querySelector<HTMLElement>('[data-record-combo]')!.textContent = `最大 Combo ${row.userCombo.toLocaleString('zh-CN')}`
  return content
}

function recordRow(key: string, records: readonly ResultHistoryRecord[], best: ResultRecordRow | undefined, song: SongEntry | undefined): HTMLElement {
  const sorted = [...records].sort((a, b) => b.recordedAt - a.recordedAt)
  const bestRecord = best && [...sorted].reverse().find(record => record.cleared && record.technical === best.technical && record.recordedAt === best.recordedAt)
  const row = bestRecord ?? sorted[0]!
  const [chartSongId, difficulty] = key.split(':')
  const item = document.createElement('div')
  item.className = 'records-row'
  item.setAttribute('role', 'listitem')
  item.dataset.recordKey = key
  item.innerHTML = `
    <div class="records-heading">
      <div class="records-main"><div class="records-copy"><strong data-record-title></strong>
        <span><b class="records-difficulty" data-record-difficulty></b><time data-record-time></time></span>
      </div></div>
      <button type="button" class="text-button records-remove" data-record-remove>删除全部</button>
    </div>
    <span class="records-best" data-record-best></span>`
  const title = song?.title ?? `未收录曲目 ${chartSongId}`
  item.querySelector<HTMLElement>('[data-record-title]')!.textContent = title
  const difficultyLabel = item.querySelector<HTMLElement>('[data-record-difficulty]')!
  difficultyLabel.textContent = difficulty ?? ''
  difficultyLabel.dataset.difficulty = difficulty
  const time = item.querySelector<HTMLTimeElement>('[data-record-time]')!
  time.textContent = formatRecordedAt(row.recordedAt)
  time.dateTime = new Date(row.recordedAt).toISOString()
  const jacketUrl = song && songAssets(song).coverUrl
  if (jacketUrl) {
    const jacket = document.createElement('img')
    jacket.src = jacketUrl
    jacket.alt = ''
    jacket.loading = 'lazy'
    jacket.width = 48
    jacket.height = 48
    item.querySelector('.records-main')!.prepend(jacket)
  }
  item.querySelector<HTMLElement>('[data-record-best]')!.textContent = bestRecord ? '最佳通关成绩' : '最近成绩 · 未通关'
  item.querySelector('button')!.setAttribute('aria-label', `删除 ${title} ${difficulty} 的全部成绩`)
  item.append(recordValues(row))
  const history = document.createElement('details')
  history.className = 'records-history'
  history.dataset.recordHistory = ''
  history.innerHTML = `<summary>历史成绩（${records.length} 局）</summary><div data-history-list></div>`
  let renderedHistory = false
  history.addEventListener('toggle', () => {
    if (!history.open || renderedHistory) return
    renderedHistory = true
    for (const record of sorted) {
      const entry = document.createElement('div')
      entry.className = 'records-history-entry'
      entry.dataset.historyId = record.id
      entry.innerHTML = `<div class="records-history-heading"><time></time><span data-history-result></span><button type="button" class="text-button records-remove" data-history-remove>删除</button></div>`
      entry.querySelector('time')!.textContent = formatRecordedAt(record.recordedAt)
      entry.querySelector('time')!.dateTime = new Date(record.recordedAt).toISOString()
      entry.querySelector<HTMLElement>('[data-history-result]')!.textContent = record.id === bestRecord?.id ? '最佳' : record.cleared ? '通关' : '未通关'
      entry.querySelector('button')!.setAttribute('aria-label', `删除 ${title} ${formatRecordedAt(record.recordedAt)} 这一局成绩`)
      entry.append(recordValues(record))
      history.querySelector('[data-history-list]')!.append(entry)
    }
  })
  item.append(history)
  return item
}

/** 全局设置「成绩」页正文；记录只按谱面归属曲目 ID + 难度存储。 */
export const resultRecordsPageMarkup = `
  <div class="preferences-content records-page" data-page-panel="records" hidden>
    <section class="appearance-section" aria-labelledby="records-section-title">
      <div class="records-section-header">
        <h3 id="records-section-title">本地成绩</h3>
        <div class="records-transfer-actions">
          <button type="button" class="text-button" data-record-import>导入成绩</button>
          <button type="button" class="text-button" data-record-export disabled>导出成绩</button>
          <input type="file" accept=".json,application/json" data-record-import-file aria-label="选择成绩 JSON 文件" hidden>
        </div>
      </div>
      <p class="records-note">每局成绩按时间留档，Another Vocal 共用对应谱面的历史。Rate 取最佳通关成绩，PlayerRate 为最高 30 张谱面的 Rate 之和。</p>
      <dl class="records-summary">
        <div><dt>已记录谱面</dt><dd data-record-count>0</dd></div>
        <div><dt>历史场次</dt><dd data-record-history-count>0</dd></div>
        <div><dt>PlayerRate</dt><dd data-record-player-rate>0</dd></div>
      </dl>
      <p class="records-transfer-note">JSON 文件包含全部历史与判定明细。导入合并到本地，重复记录自动跳过。</p>
    </section>
    <fieldset class="appearance-section records-section">
      <legend>成绩明细</legend>
      <div class="records-list" data-records-list role="list" aria-label="本地成绩明细"></div>
      <p class="records-empty" data-records-empty>还没有本地成绩。进入游玩模式完成一首官方谱面后会显示在这里。</p>
    </fieldset>
  </div>`

export const resultRecordsFooterMarkup = `
  <footer class="preferences-footer" data-page-footer="records" hidden>
    <span data-record-status role="status" aria-live="polite">成绩保存在当前浏览器中。</span>
    <div class="records-footer-actions">
      <button type="button" class="text-button" data-record-refresh>刷新</button>
      <button type="button" class="text-button" data-record-clear-all disabled>清空全部</button>
    </div>
  </footer>`

export type ResultRecordsPageController = {
  refresh: () => Promise<void>
}

export function createResultRecordsPage(dialog: HTMLDialogElement): ResultRecordsPageController {
  const count = dialog.querySelector<HTMLElement>('[data-record-count]')!
  const playerRate = dialog.querySelector<HTMLElement>('[data-record-player-rate]')!
  const historyCount = dialog.querySelector<HTMLElement>('[data-record-history-count]')!
  const list = dialog.querySelector<HTMLElement>('[data-records-list]')!
  const empty = dialog.querySelector<HTMLElement>('[data-records-empty]')!
  const status = dialog.querySelector<HTMLElement>('[data-record-status]')!
  const refreshButton = dialog.querySelector<HTMLButtonElement>('[data-record-refresh]')!
  const clearAllButton = dialog.querySelector<HTMLButtonElement>('[data-record-clear-all]')!
  const importButton = dialog.querySelector<HTMLButtonElement>('[data-record-import]')!
  const exportButton = dialog.querySelector<HTMLButtonElement>('[data-record-export]')!
  const importFile = dialog.querySelector<HTMLInputElement>('[data-record-import-file]')!
  let store: ResultRecordStore = emptyResultRecords()
  let songs = new Map<string, SongEntry>()
  let refreshId = 0
  let importing = false

  function setStatus(text: string, error = false): void {
    status.textContent = text
    status.classList.toggle('is-error', error)
  }

  function updateActions(): void {
    const empty = Object.keys(store.history).length === 0
    importButton.disabled = importing
    exportButton.disabled = importing || empty
    clearAllButton.disabled = importing || empty
    refreshButton.disabled = importing
    for (const button of list.querySelectorAll<HTMLButtonElement>('.records-remove')) button.disabled = importing
  }

  function render(): void {
    const rows = Object.entries(store.history).sort(([a, ar], [b, br]) =>
      Math.max(...br.map(record => record.recordedAt)) - Math.max(...ar.map(record => record.recordedAt)) || a.localeCompare(b))
    count.textContent = String(rows.length)
    historyCount.textContent = String(rows.reduce((sum, [, records]) => sum + records.length, 0))
    playerRate.textContent = String(playerRateOfStore(store))
    list.replaceChildren(...rows.map(([key, records]) => recordRow(key, records, store.rows[key], songs.get(key.split(':')[0]!))))
    empty.hidden = rows.length > 0
    updateActions()
  }

  async function refresh(): Promise<void> {
    const id = ++refreshId
    store = loadResultRecords()
    if (Object.keys(store.history).length && !songs.size) {
      setStatus('正在读取曲目资料…')
      try {
        const catalog = await loadSongList()
        if (id !== refreshId) return
        songs = new Map(catalog.songs.map(song => [song.id, song]))
      } catch {
        if (id !== refreshId) return
        render()
        setStatus('曲目资料加载失败，请刷新重试。', true)
        return
      }
    }
    render()
    setStatus(Object.keys(store.history).length ? '成绩保存在当前浏览器中。' : '还没有本地成绩。')
  }

  function remove(key: string, id?: string): void {
    if (importing) return
    const latest = loadResultRecords()
    if (!id && (latest.history[key]?.length ?? 0) > 1 && !window.confirm('确定删除该谱面的全部历史成绩吗？')) return
    removeResultRecord(latest, key, id)
    if (!saveResultRecords(latest)) {
      setStatus('删除失败，浏览器无法保存成绩。', true)
      return
    }
    store = latest
    render()
    setStatus(id ? '已删除这一局成绩，Rate 已重新计算。' : '已删除该谱面的成绩。')
  }

  list.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-record-remove], [data-history-remove]')
    const key = button?.closest<HTMLElement>('[data-record-key]')?.dataset.recordKey
    const id = button?.closest<HTMLElement>('[data-history-id]')?.dataset.historyId
    if (key) remove(key, id)
  })
  refreshButton.onclick = () => { void refresh() }
  importButton.onclick = () => importFile.click()
  importFile.onchange = async () => {
    const file = importFile.files?.[0]
    if (!file || importing) return
    importing = true
    updateActions()
    setStatus('正在导入成绩…')
    try {
      const incoming = parseResultRecords(await file.text())
      const merged = mergeResultRecords(loadResultRecords(), incoming)
      if (merged.added && !saveResultRecords(merged.store)) throw new Error('浏览器无法保存成绩。')
      await refresh()
      setStatus(`已导入 ${merged.added} 局成绩，跳过 ${merged.duplicates} 局重复记录。`)
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`, true)
    } finally {
      importFile.value = ''
      importing = false
      updateActions()
    }
  }
  exportButton.onclick = () => {
    const latest = loadResultRecords()
    const url = URL.createObjectURL(new Blob([exportResultRecords(latest)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `sukushow-results-${new Date().toISOString().slice(0, 10)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('已导出全部成绩。')
  }
  clearAllButton.onclick = () => {
    if (importing) return
    const count = Object.values(store.history).reduce((sum, records) => sum + records.length, 0)
    if (!count || !window.confirm(`确定清空 ${count} 局本地成绩吗？`)) return
    const next = emptyResultRecords()
    if (!saveResultRecords(next)) {
      setStatus('清空失败，浏览器无法保存成绩。', true)
      return
    }
    store = next
    render()
    setStatus('已清空全部本地成绩。')
  }
  return { refresh }
}
