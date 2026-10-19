/**
 * 独立曲库浏览面板与当前曲目的版本、难度控件。
 * 搜索词、分类和排序保留在浏览面板中，选曲不会改变预览布局。
 *
 * 无谱面的曲目默认隐藏（它们打不开），需要时用「含无谱面」勾选框放出来。
 * 列表按分类分组、组内保持曲目列表原有的 orderId 顺序。
 */
import { songAssets, type SongEntry, type SongList } from '@sukushow/llll-preview/songAssets'
import { vocalVersions, chartSongFor } from './songVersions'

export const DIFFICULTY_ORDER = ['NORMAL', 'HARD', 'EXPERT', 'MASTER'] as const
export type DifficultyName = (typeof DIFFICULTY_ORDER)[number]

/** 搜索归一：NFKC + 去空白 + 小写，让「dream believers」也能命中。 */
export function normalizeQuery(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

/** 一个曲目在搜索里可被命中的全部字段。 */
function haystack(song: SongEntry): string {
  return normalizeQuery([song.title, song.furigana, song.unitName, song.category, song.id].join(' '))
}

/**
 * 按空格切成词，要求每个词都命中（AND 语义）。
 *
 * 不能直接把整个查询去空白后当子串找：曲名里常有逗号与叹号，
 * 「hello new」去空白成 hellonew 就匹配不到「Hello, new dream!」了。
 * 分词后各词独立匹配，标点就不会挡路。
 */
export function matchesQuery(song: SongEntry, query: string): boolean {
  const tokens = query.split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0) return true
  const hay = haystack(song)
  return tokens.every((token) => hay.includes(normalizeQuery(token)))
}

/** 按分类分组，组内保持传入顺序（即曲目列表的 orderId）。 */
export function groupByCategory(songs: SongEntry[]): { category: string; songs: SongEntry[] }[] {
  const groups = new Map<string, SongEntry[]>()
  for (const song of songs) {
    const bucket = groups.get(song.category) ?? []
    bucket.push(song)
    groups.set(song.category, bucket)
  }
  return [...groups].map(([category, list]) => ({ category, songs: list }))
}

export function filterSongs(
  songs: SongEntry[],
  query: string,
  includeWithoutChart: boolean,
): SongEntry[] {
  return songs.filter(
    (song) => (includeWithoutChart || song.hasChart) && matchesQuery(song, query),
  )
}

/** 该曲目有谱面的难度，按 N→M 排列。 */
export function availableDifficulties(song: SongEntry | null): DifficultyName[] {
  if (!song) return []
  return DIFFICULTY_ORDER.filter((name) => song.difficulties.includes(name))
}

export type SongPickerOptions = {
  list: SongList
  /** 选中歌曲或切换难度时回调；无谱歌曲的 difficulty 为 null。 */
  onChange: (songId: string, difficulty: DifficultyName | null) => void
  /** 切换 Another Vocal 版本。 */
  onVersionChange?: (songId: string, difficulty: DifficultyName | null) => void
}
export type SongPickerHandle = {
  root: HTMLElement
  library: HTMLElement
  openLibrary: (trigger?: HTMLElement) => void
  /** 当前曲目 Id；未选中为空串。 */
  currentSongId: () => string
  /** 当前难度；无谱面时为 null。 */
  currentDifficulty: () => DifficultyName | null
  /** 由外部（URL 参数）指定曲目：同步控件状态并按需联动难度。 */
  select: (songId: string, difficulty?: string | null, notify?: boolean) => void
  /** 曲目列表就绪前禁用。 */
  setCustom: (active: boolean) => void
  setDisabled: (disabled: boolean) => void
  /** Refresh floating controls after the record controls move to another view. */
  refreshLayout: () => void
  dispose: () => void
}

export function createSongPicker(options: SongPickerOptions): SongPickerHandle {
  const { list, onChange } = options
  const songs = list.songs

  const root = document.createElement('div')
  root.className = 'picker'
  root.innerHTML = `
    <button class="picker-open" type="button" data-picker-open aria-haspopup="dialog" aria-controls="song-panel" aria-expanded="false"><svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><span>更换曲目</span><span aria-hidden="true">↗</span></button>
    <div id="song-versions" class="version-group" hidden>
      <button id="song-version-toggle" class="version-toggle" type="button"
              aria-label="演唱版本" aria-haspopup="menu" aria-expanded="false" aria-controls="song-version-panel">
        <span class="version-caption">演唱版本</span><span data-version-current></span><span aria-hidden="true">⌄</span>
      </button>
      <div id="song-version-panel" class="version-panel" role="menu" aria-label="演唱版本" popover="manual" hidden></div>
    </div>
    <div id="song-difficulty" class="difficulty-group" role="radiogroup" aria-label="难度"></div>
  `

  const panel = document.createElement('div')
  panel.id = 'song-panel'
  panel.className = 'picker-panel'
  panel.popover = 'manual'
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-labelledby', 'song-library-title')
  panel.innerHTML = `
    <div class="library-heading"><h2 id="song-library-title">曲库</h2><span id="song-count" class="picker-count"></span><button class="quiet" type="button" data-library-close aria-label="关闭曲库">×</button></div>
    <div class="library-search picker-field">
      <svg class="picker-icon" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>
      <input id="song-search" class="picker-input" type="text" role="combobox" autocomplete="off" spellcheck="false" aria-expanded="false" aria-controls="song-listbox" aria-autocomplete="list" aria-label="搜索曲目" placeholder="搜索曲名、组合或 ID">
      <button id="song-clear" class="picker-clear" type="button" aria-label="清空搜索" hidden>×</button>
    </div>
    <div class="picker-toolbar">
      <select id="song-category" aria-label="曲目分类"><option value="">全部分类</option></select>
      <select id="song-sort" aria-label="曲目排序"><option value="order">收录顺序</option><option value="title">曲名顺序</option><option value="level">最高等级</option></select>
      <label class="picker-toggle"><input id="song-include-no-chart" type="checkbox"><span>含无谱面</span></label>
    </div>
    <div class="library-columns" aria-hidden="true"><span>曲目 / 演唱组合</span><div>${DIFFICULTY_ORDER.map((name, index) => `<span data-difficulty="${name}" data-short="${['N', 'H', 'EX', 'MA'][index]}">${name}</span>`).join('')}</div></div>
    <ul id="song-listbox" class="picker-list" role="listbox" aria-label="曲目"></ul>
    <div class="picker-help"><span><kbd>↑</kbd><kbd>↓</kbd> 选择 <kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>
  `
  root.append(panel)
  const openButton = root.querySelector<HTMLButtonElement>('[data-picker-open]')!
  const field = panel.querySelector<HTMLInputElement>('#song-search')!
  const clear = panel.querySelector<HTMLButtonElement>('#song-clear')!
  const listbox = panel.querySelector<HTMLUListElement>('#song-listbox')!
  const count = panel.querySelector<HTMLSpanElement>('#song-count')!
  const includeNoChart = panel.querySelector<HTMLInputElement>('#song-include-no-chart')!
  const category = panel.querySelector<HTMLSelectElement>('#song-category')!
  const sort = panel.querySelector<HTMLSelectElement>('#song-sort')!
  for (const name of new Set(songs.map(song => song.category))) category.add(new Option(name, name))
  const difficultyGroup = root.querySelector<HTMLDivElement>('#song-difficulty')!
  const versionGroup = root.querySelector<HTMLDivElement>('#song-versions')!
  const versionToggle = root.querySelector<HTMLButtonElement>('#song-version-toggle')!
  const versionPanel = root.querySelector<HTMLDivElement>('#song-version-panel')!
  const versionCurrent = root.querySelector<HTMLSpanElement>('[data-version-current]')!

  let custom = false
  let disabled = false
  let selectedSongId = ''
  let selectedDifficulty: DifficultyName | null = null
  let query = ''
  let libraryTrigger: HTMLElement | null = null
  let libraryHome: HTMLElement | null = null
  // 过滤后可见的选项，键盘上下键在它上面移动；顺序与 DOM 一致。
  let visible: SongEntry[] = []
  let activeIndex = -1

  const findSong = (id: string) => songs.find((song) => song.id === id) ?? null

  // Fixed panels escape the scrolling record rail; keep them inside the viewport.
  function positionPanel(node: HTMLElement, anchor: HTMLElement) {
    const bounds = anchor.getBoundingClientRect()
    const width = node.getBoundingClientRect().width
    const transport = root.closest('.viewer')?.querySelector('.transport')?.getBoundingClientRect()
    const bottom = innerWidth <= 900 && transport ? Math.min(innerHeight, transport.top) : innerHeight
    const below = bottom - bounds.bottom - 16
    const above = bounds.top - 16
    const openBelow = below >= Math.min(280, innerHeight / 2) || below >= above
    node.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - width - 12))}px`
    node.style.maxHeight = `${Math.max(100, openBelow ? below : above)}px`
    node.style.top = openBelow ? `${bounds.bottom + 8}px` : 'auto'
    node.style.bottom = openBelow ? 'auto' : `${innerHeight - bounds.top + 8}px`
  }
  function positionOpenPanels() {
    if (!panel.hidden) positionLibrary()
    if (!versionPanel.hidden) positionPanel(versionPanel, versionToggle)
  }
  function positionLibrary() {
    const transport = root.closest('.viewer')?.querySelector('.transport')?.getBoundingClientRect()
    const top = innerHeight <= 520 ? 12 : innerWidth <= 640 ? 64 : 88
    const bottom = Math.min(innerHeight - 12, transport?.top ?? innerHeight - 12)
    panel.style.top = `${Math.min(top, Math.max(12, bottom - 260))}px`
    panel.style.maxHeight = `${Math.max(100, bottom - Number.parseFloat(panel.style.top) - 12)}px`
  }
  window.addEventListener('resize', positionOpenPanels)
  document.addEventListener('scroll', positionOpenPanels, true)
  const onFullscreenChange = () => {
    if (libraryHome && !document.fullscreenElement?.contains(panel)) closePanel(true)
  }
  document.addEventListener('fullscreenchange', onFullscreenChange)

  function closeVersions(focus = false) {
    versionPanel.hidePopover()
    versionPanel.hidden = true
    versionToggle.setAttribute('aria-expanded', 'false')
    if (focus) versionToggle.focus()
  }

  function openVersions() {
    if (versionToggle.disabled || versionGroup.hidden) return
    closePanel()
    versionPanel.hidden = false
    versionPanel.showPopover()
    positionPanel(versionPanel, versionToggle)
    versionToggle.setAttribute('aria-expanded', 'true')
    versionPanel.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }

  function renderVersions() {
    const versions = vocalVersions(list, selectedSongId)
    closeVersions()
    versionPanel.replaceChildren()
    versionGroup.hidden = versions.length < 2
    if (versions.length < 2) return
    const selected = findSong(selectedSongId)!
    versionCurrent.textContent = selected.title.match(/[（(](.+?)[）)]/)?.[1] ?? `${selected.generationsId}期`
    versionToggle.title = selected.title
    for (const version of versions) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'version-option'
      button.tabIndex = -1
      button.dataset.songId = version.id
      button.setAttribute('role', 'menuitemradio')
      button.setAttribute('aria-checked', String(version.id === selectedSongId))
      const title = document.createElement('span')
      title.textContent = version.title
      const detail = document.createElement('small')
      detail.textContent = `${version.generationsId}期 · ${version.unitName}`
      button.append(title, detail)
      button.onclick = () => {
        if (selectedSongId === version.id) { closeVersions(true); return }
        selectedSongId = version.id
        const source = chartSongFor(list, version.id)
        const available = availableDifficulties(source)
        selectedDifficulty = available.includes(selectedDifficulty as DifficultyName)
          ? selectedDifficulty : available[available.length - 1] ?? null
        updateSelection()
        renderDifficulty()
        renderVersions()
        closeVersions(true)
        options.onVersionChange?.(version.id, selectedDifficulty)
      }
      versionPanel.append(button)
    }
  }

  versionToggle.onclick = () => versionPanel.hidden ? openVersions() : closeVersions(true)
  versionToggle.onkeydown = event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    openVersions()
  }
  versionPanel.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeVersions(true); return }
    if (event.key === 'Tab') { closeVersions(true); return }
    const buttons = [...versionPanel.querySelectorAll<HTMLButtonElement>('button')]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const targets: Record<string, number> = {
      ArrowDown: (index + 1) % buttons.length,
      ArrowUp: (index - 1 + buttons.length) % buttons.length,
      Home: 0, End: buttons.length - 1,
    }
    if (!(event.key in targets)) return
    event.preventDefault()
    buttons[targets[event.key]]?.focus()
  }
  const onVersionFocusOut = (event: FocusEvent) => {
    if (!versionGroup.contains(event.relatedTarget as Node | null)) closeVersions()
  }
  versionGroup.addEventListener('focusout', onVersionFocusOut)

  function renderDifficulty() {
    const selected = chartSongFor(list, selectedSongId)
    const available = availableDifficulties(selected)
    difficultyGroup.replaceChildren()
    if (custom || available.length === 0) {
      difficultyGroup.hidden = true
      return
    }
    difficultyGroup.hidden = false
    for (const name of available) {
      const level = selected?.levels?.[name]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'difficulty-chip'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(name === selectedDifficulty))
      button.tabIndex = name === selectedDifficulty ? 0 : -1
      button.disabled = disabled
      button.dataset.difficulty = name
      button.setAttribute('aria-label', `${name}${level ? ` Lv.${level}` : ''}`)
      button.title = `${name}${level ? ` Lv.${level}` : ''}`
      button.textContent = String(level || '-')
      if (name === selectedDifficulty) button.classList.add('is-active')
      button.onclick = () => {
        if (selectedDifficulty === name) return
        const focused = document.activeElement === button
        selectedDifficulty = name
        renderDifficulty()
        renderVersions()
        if (selectedSongId) onChange(selectedSongId, name)
        if (focused) difficultyGroup.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
      }
      difficultyGroup.append(button)
    }
  }

  difficultyGroup.onkeydown = event => {
    const buttons = [...difficultyGroup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    if (!buttons.length) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const positions: Record<string, number> = {
      ArrowRight: (index + 1) % buttons.length, ArrowDown: (index + 1) % buttons.length,
      ArrowLeft: (index + buttons.length - 1) % buttons.length, ArrowUp: (index + buttons.length - 1) % buttons.length,
      Home: 0, End: buttons.length - 1,
    }
    const next = positions[event.key]
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    buttons[next]!.click()
    difficultyGroup.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }


  function levelBadges(song: SongEntry): string {
    const source = chartSongFor(list, song.id)
    if (!source?.difficulties.length) return '<span class="song-option-badge is-none">无谱面</span>'
    return DIFFICULTY_ORDER
      .map((name) => {
        if (!source.difficulties.includes(name)) return '<span class="song-option-badge is-unavailable">—</span>'
        const level = source.levels?.[name] || '—'
        return `<span class="song-option-badge" data-difficulty="${name}" ` +
          `title="${name} Lv.${level}">${level}</span>`
      })
      .join('')
  }

  function renderList(preferIndex?: number) {
    const filtered = filterSongs(songs, query, includeNoChart.checked)
      .filter(song => !category.value || song.category === category.value)
    if (sort.value === 'title') filtered.sort((a, b) => a.title.localeCompare(b.title, 'ja'))
    if (sort.value === 'level') {
      const highest = (song: SongEntry) => Math.max(0, ...Object.values(chartSongFor(list, song.id)?.levels ?? {}))
      filtered.sort((a, b) => highest(b) - highest(a))
    }
    listbox.replaceChildren()

    count.textContent = `${filtered.length} 首`

    if (filtered.length === 0) {
      visible = []
      activeIndex = -1
      const empty = document.createElement('li')
      empty.className = 'picker-empty'
      empty.textContent = '没有匹配的曲目'
      listbox.append(empty)
      field.removeAttribute('aria-activedescendant')
      return
    }

    // 列表按分类分组显示，`visible` 必须与 DOM 同序，
    // 否则键盘上下键高亮的项与 Enter 选中的项会对不上。
    const groups = sort.value === 'order' ? groupByCategory(filtered) : [{ category: '', songs: filtered }]
    visible = groups.flatMap((group) => group.songs)

    let index = 0
    for (const group of groups) {
      if (group.category && !category.value) {
        const heading = document.createElement('li')
        heading.className = 'picker-group'
        heading.setAttribute('role', 'presentation')
        heading.textContent = group.category
        listbox.append(heading)
      }

      for (const song of group.songs) {
        const optionIndex = index
        const option = document.createElement('li')
        option.id = `song-option-${song.id}`
        option.className = 'song-option'
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', String(song.id === selectedSongId))
        option.dataset.index = String(index)
        option.dataset.songId = song.id
        option.innerHTML = `
          <span class="song-option-main">
            <span class="song-option-title">${escapeHtml(song.title)}</span>
            <span class="song-option-unit">${escapeHtml(song.unitName)}<span class="song-option-id">${escapeHtml(song.id)}</span></span>
          </span>
          <span class="song-option-badges">${levelBadges(song)}</span>
        `
        const art = document.createElement('span')
        art.className = 'song-option-art'
        art.setAttribute('aria-hidden', 'true')
        art.textContent = '♪'
        const coverUrl = songAssets(song).coverUrl
        if (coverUrl) {
          const image = document.createElement('img')
          image.alt = ''
          image.loading = 'lazy'
          image.decoding = 'async'
          image.src = coverUrl
          image.onerror = () => image.remove()
          art.append(image)
        }
        option.prepend(art)
        if (song.id === selectedSongId) option.classList.add('is-selected')
        option.onclick = () => choose(song.id)
        option.onmousemove = () => {
          if (activeIndex === optionIndex) return
          activeIndex = optionIndex
          paintActive()
        }
        listbox.append(option)
        index += 1
      }
    }

    // 高亮位置：显式指定 > 保持原位置 > 落到当前曲目 > 第一项。
    const fallback = visible.findIndex((song) => song.id === selectedSongId)
    const next = preferIndex ?? (activeIndex >= 0 ? activeIndex : fallback)
    activeIndex = next >= 0 && next < visible.length ? next : 0
    paintActive()
  }

  function paintActive() {
    const options = listbox.querySelectorAll<HTMLLIElement>('.song-option')
    options.forEach((option) => {
      const active = Number(option.dataset.index) === activeIndex
      option.classList.toggle('is-active', active)
      if (active && !panel.hidden) {
        field.setAttribute('aria-activedescendant', option.id)
        option.scrollIntoView({ block: 'nearest' })
      }
    })
    if (activeIndex < 0) field.removeAttribute('aria-activedescendant')
  }

  function updateSelection() {
    root.dataset.songId = selectedSongId
    panel.dataset.songId = selectedSongId
  }

  /** 只负责把面板露出来，不动查询词。 */
  function showPanel() {
    if (!panel.hidden) return
    closeVersions()
    // Controls outside the fullscreen element are inert, even in the top layer.
    if (document.fullscreenElement && !document.fullscreenElement.contains(panel)) {
      libraryHome = panel.parentElement
      document.fullscreenElement.append(panel)
    }
    panel.hidden = false
    panel.showPopover()
    positionLibrary()
    field.setAttribute('aria-expanded', 'true')
    openButton.setAttribute('aria-expanded', 'true')
    if (libraryTrigger?.hasAttribute('aria-haspopup')) libraryTrigger.setAttribute('aria-expanded', 'true')
  }

  function openPanel(trigger?: HTMLElement) {
    if (disabled) return
    if (!panel.hidden) { field.focus(); return }
    libraryTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : openButton)
    showPanel()
    activeIndex = -1
    renderList(Math.max(0, visible.findIndex((song) => song.id === selectedSongId)))
    field.focus({ preventScroll: true })
    field.select()
  }

  function closePanel(restoreFocus = false) {
    if (panel.hidden) return
    panel.hidePopover()
    panel.hidden = true
    field.setAttribute('aria-expanded', 'false')
    field.removeAttribute('aria-activedescendant')
    openButton.setAttribute('aria-expanded', 'false')
    if (libraryTrigger?.hasAttribute('aria-haspopup')) libraryTrigger.setAttribute('aria-expanded', 'false')
    if (libraryHome) {
      libraryHome.append(panel)
      libraryHome = null
    }
    if (restoreFocus && libraryTrigger?.isConnected) libraryTrigger.focus({ preventScroll: true })
  }

  function choose(songId: string) {
    const song = findSong(songId)
    if (!song) return
    selectedSongId = songId
    const available = availableDifficulties(chartSongFor(list, songId))
    selectedDifficulty = available.includes(selectedDifficulty as DifficultyName)
      ? selectedDifficulty : available[available.length - 1] ?? null
    updateSelection()
    closePanel(true)
    // 重渲染一次，让列表里的 is-selected 标记跟上新选择
    // （不重渲染的话，再次打开面板会看到上一首仍带勾）。
    renderList(visible.findIndex((item) => item.id === songId))
    renderDifficulty()
    renderVersions()
    onChange(songId, selectedDifficulty)
  }

  field.oninput = () => {
    query = field.value
    clear.hidden = field.value === ''
    activeIndex = 0
    renderList()
  }
  field.onkeydown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openPanel()
      if (visible.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      activeIndex = (activeIndex + step + visible.length) % visible.length
      paintActive()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (panel.hidden || visible.length === 0) return
      event.preventDefault()
      activeIndex = event.key === 'Home' ? 0 : visible.length - 1
      paintActive()
      return
    }
    if (event.key === 'Enter') {
      if (panel.hidden || activeIndex < 0) return
      event.preventDefault()
      const song = visible[activeIndex]
      if (song) choose(song.id)
      return
    }
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault()
      event.stopPropagation()
      closePanel(true)
    }
  }

  clear.onclick = () => {
    query = ''
    field.value = ''
    clear.hidden = true
    activeIndex = 0
    renderList()
    field.focus()
  }

  includeNoChart.onchange = () => {
    activeIndex = 0
    renderList()
  }
  category.onchange = sort.onchange = () => renderList(0)
  openButton.onclick = () => openPanel(openButton)
  panel.querySelector<HTMLButtonElement>('[data-library-close]')!.onclick = () => closePanel(true)
  panel.onkeydown = event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    closePanel(true)
  }
  panel.addEventListener('focusout', event => {
    if (event.relatedTarget instanceof Node && !panel.contains(event.relatedTarget)) closePanel()
  })

  // 点到控件之外就收面板。
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!root.contains(event.target as Node) && !panel.contains(event.target as Node)) closePanel()
    if (!versionGroup.contains(event.target as Node)) closeVersions()
  }
  document.addEventListener('pointerdown', onDocumentPointerDown)

  renderList()
  renderDifficulty()
  renderVersions()
  updateSelection()

  return {
    root,
    library: panel,
    openLibrary: openPanel,
    currentSongId: () => selectedSongId,
    currentDifficulty: () => selectedDifficulty,
    select: (songId, difficulty, notify = true) => {
      const song = findSong(songId)
      if (!song) return
      selectedSongId = songId
      const selected = chartSongFor(list, songId)
      const available = availableDifficulties(selected)
      const wanted = available.find(
        (name) => name === (difficulty ?? '').toUpperCase(),
      )
      selectedDifficulty = wanted ?? available[available.length - 1] ?? null
      updateSelection()
      renderDifficulty()
      renderVersions()
      renderList(visible.findIndex(song => song.id === selectedSongId))
      if (notify) onChange(songId, selectedDifficulty)
    },
    setCustom: active => { custom = active; renderDifficulty() },
    setDisabled: (value) => {
      disabled = value
      field.disabled = value
      openButton.disabled = value
      versionToggle.disabled = value
      root.classList.toggle('is-disabled', value)
      renderDifficulty()
      if (value) { closePanel(); closeVersions() }
    },
    refreshLayout: () => {
      closeVersions()
      if (libraryHome && !document.fullscreenElement?.contains(root)) closePanel()
      positionOpenPanels()
    },
    dispose: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      versionGroup.removeEventListener('focusout', onVersionFocusOut)
      window.removeEventListener('resize', positionOpenPanels)
      document.removeEventListener('scroll', positionOpenPanels, true)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      panel.remove()
      root.remove()
    },
  }
}

/** 曲名里可能带 `<` / `&`（如「Trick ＆ Cute」），插进 innerHTML 前要转义。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
