/**
 * 曲目选择器：可搜索的下拉框，替代原生 `<select>`。
 *
 * 原生 select 放 236 项时的问题：不能搜索（只能靠首字跳转）、
 * 无谱面的 82 首占满列表、也看不到难度等级。
 * 这里换成 combobox 模式（input + listbox），按曲名 / 假名 / 组合 /
 * 分类 / 曲目 Id 过滤，并把难度等级做成徽章直接显示。
 *
 * 无谱面的曲目默认隐藏（它们打不开），需要时用「含无谱面」勾选框放出来。
 * 列表按分类分组、组内保持曲目列表原有的 orderId 顺序。
 */
import type { SongEntry, SongList } from '@sukushow/llll-preview/songAssets'

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
  /** 选中曲目或切换难度时回调。 */
  onChange: (songId: string, difficulty: DifficultyName) => void
}

export type SongPickerHandle = {
  root: HTMLElement
  /** 当前曲目 Id；未选中为空串。 */
  currentSongId: () => string
  /** 当前难度；无谱面时为 null。 */
  currentDifficulty: () => DifficultyName | null
  /** 由外部（URL 参数）指定曲目：同步控件状态并按需联动难度。 */
  select: (songId: string, difficulty?: string | null, notify?: boolean) => void
  /** 曲目列表就绪前禁用。 */
  setDisabled: (disabled: boolean) => void
  dispose: () => void
}

export function createSongPicker(options: SongPickerOptions): SongPickerHandle {
  const { list, onChange } = options
  const songs = list.songs

  const root = document.createElement('div')
  root.className = 'picker'
  root.innerHTML = `
    <div class="picker-anchor">
      <div class="picker-field">
        <span class="picker-icon" aria-hidden="true">♪</span>
        <input id="song-search" class="picker-input" type="text" role="combobox"
               autocomplete="off" spellcheck="false" aria-expanded="false"
               aria-controls="song-listbox" aria-autocomplete="list"
               placeholder="搜索曲目…">
        <button id="song-clear" class="picker-clear" type="button" aria-label="清空搜索" hidden>✕</button>
      </div>
      <div class="picker-panel" id="song-panel" hidden>
        <div class="picker-toolbar">
          <span id="song-count" class="picker-count"></span>
          <label class="picker-toggle">
            <input id="song-include-no-chart" type="checkbox">
            <span>含无谱面</span>
          </label>
        </div>
        <ul id="song-listbox" class="picker-list" role="listbox" aria-label="曲目"></ul>
      </div>
    </div>
    <div id="song-difficulty" class="difficulty-group" role="radiogroup" aria-label="难度"></div>
  `

  const field = root.querySelector<HTMLInputElement>('#song-search')!
  const clear = root.querySelector<HTMLButtonElement>('#song-clear')!
  const panel = root.querySelector<HTMLDivElement>('#song-panel')!
  const listbox = root.querySelector<HTMLUListElement>('#song-listbox')!
  const count = root.querySelector<HTMLSpanElement>('#song-count')!
  const includeNoChart = root.querySelector<HTMLInputElement>('#song-include-no-chart')!
  const difficultyGroup = root.querySelector<HTMLDivElement>('#song-difficulty')!

  let selectedSongId = ''
  let selectedDifficulty: DifficultyName | null = null
  /**
   * 真正的搜索词，与输入框显示的内容分开。
   *
   * 输入框在选中曲目后显示的是曲名（供人看），但那不是「查询」——
   * 若直接拿 field.value 过滤，点开菜单只会看到当前这一首，
   * 等于打不开选曲列表。故查询单独存，只有用户真的输入才写入。
   */
  let query = ''
  // 过滤后可见的选项，键盘上下键在它上面移动；顺序与 DOM 一致。
  let visible: SongEntry[] = []
  let activeIndex = -1

  const findSong = (id: string) => songs.find((song) => song.id === id) ?? null

  function renderDifficulty() {
    const song = findSong(selectedSongId)
    const available = availableDifficulties(song)
    difficultyGroup.replaceChildren()
    if (available.length === 0) {
      difficultyGroup.hidden = true
      return
    }
    difficultyGroup.hidden = false
    for (const name of available) {
      const level = song?.levels?.[name]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'difficulty-chip'
      button.setAttribute('role', 'radio')
      button.setAttribute('aria-checked', String(name === selectedDifficulty))
      button.dataset.difficulty = name
      // 只显示数字：难度靠顺序（N/H/E/M）与配色区分，
      // 完整名字放 aria-label 与 title，给读屏和悬停用。
      button.setAttribute('aria-label', `${name}${level ? ` Lv.${level}` : ''}`)
      button.title = `${name}${level ? ` Lv.${level}` : ''}`
      // 等级取自 MusicScores.yaml，与游戏内显示一致。
      button.textContent = String(level || '-')
      if (name === selectedDifficulty) button.classList.add('is-active')
      button.onclick = () => {
        selectedDifficulty = name
        renderDifficulty()
        if (selectedSongId) onChange(selectedSongId, name)
      }
      difficultyGroup.append(button)
    }
  }

  function levelBadges(song: SongEntry): string {
    if (!song.hasChart) return '<span class="song-option-badge is-none">无谱面</span>'
    // 与 header 的难度徽章同口径：只标数字，难度靠顺序与配色区分。
    return DIFFICULTY_ORDER
      .filter((name) => song.difficulties.includes(name))
      .map((name) => {
        const level = song.levels?.[name] || '-'
        return `<span class="song-option-badge" data-difficulty="${name}" ` +
          `title="${name} Lv.${level}">${level}</span>`
      })
      .join('')
  }

  function renderList(preferIndex?: number) {
    const filtered = filterSongs(songs, query, includeNoChart.checked)
    listbox.replaceChildren()

    const chartCount = filtered.filter((song) => song.hasChart).length
    count.textContent = query
      ? `匹配 ${filtered.length} 首（有谱面 ${chartCount}）`
      : `共 ${filtered.length} 首（有谱面 ${chartCount}）`

    if (filtered.length === 0) {
      visible = []
      activeIndex = -1
      const empty = document.createElement('li')
      empty.className = 'picker-empty'
      empty.textContent = '没有匹配的曲目'
      listbox.append(empty)
      return
    }

    // 列表按分类分组显示，`visible` 必须与 DOM 同序，
    // 否则键盘上下键高亮的项与 Enter 选中的项会对不上。
    const groups = groupByCategory(filtered)
    visible = groups.flatMap((group) => group.songs)

    let index = 0
    for (const group of groups) {
      const heading = document.createElement('li')
      heading.className = 'picker-group'
      heading.setAttribute('role', 'presentation')
      heading.textContent = group.category
      listbox.append(heading)

      for (const song of group.songs) {
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
            <span class="song-option-unit">${escapeHtml(song.unitName)}</span>
          </span>
          <span class="song-option-badges">${levelBadges(song)}</span>
        `
        if (song.id === selectedSongId) option.classList.add('is-selected')
        option.onclick = () => choose(song.id)
        option.onmousemove = () => {
          if (activeIndex === index) return
          activeIndex = index
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
      if (active) {
        field.setAttribute('aria-activedescendant', option.id)
        option.scrollIntoView({ block: 'nearest' })
      }
    })
    if (activeIndex < 0) field.removeAttribute('aria-activedescendant')
  }

  /** 把输入框还原成「显示当前曲名」的状态（非查询态）。 */
  function showSelectedTitle() {
    const song = findSong(selectedSongId)
    field.value = song ? song.title : ''
    field.title = song ? `${song.title}　${song.category}　${song.unitName}` : ''
    clear.hidden = field.value === ''
  }

  /** 只负责把面板露出来，不动查询词。 */
  function showPanel() {
    if (!panel.hidden) return
    panel.hidden = false
    field.setAttribute('aria-expanded', 'true')
    root.classList.add('is-open')
  }

  /**
   * 用户主动「打开菜单」（聚焦 / 点击）。
   *
   * 这里清掉上一轮的查询并重画完整列表，并高亮当前曲目——
   * 否则输入框里显示的是曲名，过滤后只剩当前这一首，菜单等于空的。
   */
  function openPanel() {
    if (!panel.hidden) return
    query = ''
    includeNoChart.checked = false
    showPanel()
    renderList(Math.max(0, visible.findIndex((song) => song.id === selectedSongId)))
  }

  function closePanel() {
    if (panel.hidden) return
    panel.hidden = true
    field.setAttribute('aria-expanded', 'false')
    root.classList.remove('is-open')
    query = ''
    showSelectedTitle()
  }

  function choose(songId: string) {
    const song = findSong(songId)
    if (!song) return
    selectedSongId = songId
    const available = availableDifficulties(song)
    // 默认落到最高难度，与原来的行为一致。
    if (available.length > 0 && !available.includes(selectedDifficulty as DifficultyName)) {
      selectedDifficulty = available[available.length - 1]!
    }
    query = ''
    closePanel()
    // 重渲染一次，让列表里的 is-selected 标记跟上新选择
    // （不重渲染的话，再次打开面板会看到上一首仍带勾）。
    renderList(visible.findIndex((item) => item.id === songId))
    renderDifficulty()
    if (selectedDifficulty && song.hasChart) {
      onChange(songId, selectedDifficulty)
    }
  }

  field.oninput = () => {
    // 先写 query 再开面板：openPanel 会重置 query，顺序反了会把输入抹掉。
    query = field.value
    clear.hidden = field.value === ''
    activeIndex = 0
    showPanel()
    renderList()
  }
  field.onfocus = () => openPanel()
  field.onclick = () => openPanel()
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
    if (event.key === 'Escape') {
      event.preventDefault()
      closePanel()
      field.blur()
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

  // 点到控件之外就收面板。
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!root.contains(event.target as Node)) closePanel()
  }
  document.addEventListener('pointerdown', onDocumentPointerDown)

  renderList()
  renderDifficulty()

  return {
    root,
    currentSongId: () => selectedSongId,
    currentDifficulty: () => selectedDifficulty,
    select: (songId, difficulty, notify = true) => {
      const song = findSong(songId)
      if (!song) return
      selectedSongId = songId
      const available = availableDifficulties(song)
      const wanted = available.find(
        (name) => name === (difficulty ?? '').toUpperCase(),
      )
      selectedDifficulty = wanted ?? available[available.length - 1] ?? null
      query = ''
      showSelectedTitle()
      renderDifficulty()
      renderList(visible.findIndex((item) => item.id === songId))
      if (notify && selectedDifficulty) onChange(songId, selectedDifficulty)
    },
    setDisabled: (disabled) => {
      field.disabled = disabled
      root.classList.toggle('is-disabled', disabled)
      if (disabled) closePanel()
    },
    dispose: () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
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
