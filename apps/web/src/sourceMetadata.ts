import type { SourceMetadata } from './songSelection'

export type MetadataDraft = Record<
  'title' | 'difficulty' | 'scoreCreator' | 'lyricist' | 'composer' | 'arranger' |
  'vocal' | 'offsetMs' | 'feverStart' | 'feverEnd' | 'finishTime', string
>

const optionalText = (value: string): string | null => value.trim() || null
const finite = (value: string, label: string, minimum?: number): number => {
  if (!value.trim()) throw new Error(`${label}不能为空`)
  const number = Number(value)
  if (!Number.isFinite(number) || (minimum !== undefined && number < minimum)) throw new Error(`${label}无效`)
  return number
}

export function parseMetadataDraft(draft: MetadataDraft): SourceMetadata {
  const title = draft.title.trim()
  if (!title) throw new Error('曲名不能为空')
  const hasStart = draft.feverStart.trim() !== ''
  const hasEnd = draft.feverEnd.trim() !== ''
  if (hasStart !== hasEnd) throw new Error('Fever 开始与结束必须同时填写')
  const fever = hasStart
    ? { start: finite(draft.feverStart, 'Fever 开始', 0), end: finite(draft.feverEnd, 'Fever 结束', 0) }
    : null
  if (fever && fever.start >= fever.end) throw new Error('Fever 开始必须早于结束')
  if (draft.finishTime.trim() && finite(draft.finishTime, '曲终时间', 0) < 0) throw new Error('曲终时间无效')
  return {
    title,
    difficulty: optionalText(draft.difficulty), scoreCreator: optionalText(draft.scoreCreator),
    lyricist: optionalText(draft.lyricist), composer: optionalText(draft.composer),
    arranger: optionalText(draft.arranger), vocal: optionalText(draft.vocal),
    offsetMs: finite(draft.offsetMs, '音频偏移'), fever,
    finishTime: draft.finishTime.trim() ? finite(draft.finishTime, '曲终时间', 0) : null,
  }
}
