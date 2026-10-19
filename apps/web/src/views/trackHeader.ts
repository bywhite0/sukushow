/** 曲目条：封面、标题、难度、技术信息的唯一写入口。
 *
 *  两个视图（LLLL / PJSK）共用同一段 DOM 契约，渲染器完全不参与这里，
 *  这样换皮肤不会碰到渲染逻辑，换渲染器也不会碰到版式。
 */
import type { Chart } from '@sukushow/chart/chart'

export type TrackHeaderInfo = {
  title?: string
  difficulty?: string | null
  /** 演唱署名，缺省时整行隐藏。制作人员在 credits 中展示。 */
  artist?: string | null
  /** 各预览模式从真实谱面读取的两项统计。 */
  stats?: [label: string, value: number | string][]
  /** 曲绘地址；没有曲绘时回退到品牌标记。 */
  jacket?: string | null
  chart?: Chart | null
  credits?: [string, string | null | undefined][]
}

export type TrackHeader = {
  show: (info?: TrackHeaderInfo) => void
  /** 导出文件名沿用「曲名 [难度]」的既有口径。 */
  title: () => string
  /** 把当前进度写进时间轴的填充比例（--progress）。 */
  paint: () => void
}

export function createTrackHeader(root: HTMLElement): TrackHeader {
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const node = root.querySelector<T>(selector)
    if (!node) throw new Error(`缺少元素 ${selector}`)
    return node
  }
  const name = q('#chart-name')
  const difficulty = q('#chart-difficulty')
  const artist = q('#chart-artist')
  const artwork = q('#artwork')
  const jacket = q<HTMLImageElement>('#chart-jacket')
  const timeline = q<HTMLInputElement>('#timeline')
  const metrics = q('#chart-metrics')
  const creditList = q('#chart-credits')
  const credits = q('#track-credits')
  const stageName = q('#stage-track-name')
  const stageDifficulty = q('#stage-track-difficulty')

  function pair(host: HTMLElement, label: string, value: string) {
    const item = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    item.append(term, description)
    host.append(item)
  }

  // 曲绘加载失败时退回品牌标记，不显示浏览器的破图。
  jacket.addEventListener('error', () => {
    jacket.hidden = true
    artwork.dataset.state = 'empty'
  })

  function show(info: TrackHeaderInfo = {}) {
    name.textContent = info.title || '未加载谱面'
    stageName.textContent = info.title || '谱面预览'
    stageName.title = info.title || '谱面预览'

    const label = info.difficulty ?? ''
    difficulty.textContent = label
    difficulty.hidden = !label
    if (label) difficulty.dataset.difficulty = label
    else delete difficulty.dataset.difficulty
    stageDifficulty.textContent = label
    stageDifficulty.hidden = !label
    stageDifficulty.dataset.difficulty = label

    artist.textContent = info.artist ?? ''
    artist.hidden = !info.artist
    metrics.replaceChildren()
    if (info.chart) {
      const bpms = info.chart.bpms.map(item => item.bpm)
      if (bpms.length) {
        const min = Math.min(...bpms)
        const max = Math.max(...bpms)
        pair(metrics, 'BPM', min === max ? String(min) : `${min}–${max}`)
      } else pair(metrics, 'BPM', '—')
      const seconds = Math.floor(info.chart.duration)
      pair(metrics, '谱面时长', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`)
    }
    for (const [label, value] of info.stats ?? []) pair(metrics, label, String(value))
    metrics.hidden = !metrics.childElementCount
    creditList.replaceChildren()
    for (const [label, value] of info.credits ?? []) if (value) pair(creditList, label, value)
    credits.hidden = !creditList.childElementCount

    if (info.jacket) {
      if (jacket.getAttribute('src') !== info.jacket) {
        jacket.src = info.jacket
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          jacket.animate([{ opacity: .3, transform: 'scale(1.025)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' })
        }
      }
      jacket.alt = `${info.title || '当前曲目'} 曲绘`
      jacket.hidden = false
      artwork.dataset.state = 'ready'
    } else {
      jacket.removeAttribute('src')
      jacket.hidden = true
      artwork.dataset.state = 'empty'
    }
  }

  function title() {
    const base = name.textContent ?? ''
    const label = difficulty.hidden ? '' : difficulty.textContent ?? ''
    return label ? `${base} [${label}]` : base
  }

  function paint() {
    const min = Number(timeline.min || 0)
    const max = Number(timeline.max || 0)
    const value = Number(timeline.value || 0)
    const ratio = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0
    timeline.style.setProperty('--progress', `${(ratio * 100).toFixed(2)}%`)
  }

  return { show, title, paint }
}
