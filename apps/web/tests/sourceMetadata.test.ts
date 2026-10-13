import { describe, expect, it } from 'vitest'
import { parseMetadataDraft, type MetadataDraft } from '../src/sourceMetadata'

const draft: MetadataDraft = {
  title: '自制谱', difficulty: '', scoreCreator: '', lyricist: '', composer: '', arranger: '', vocal: '',
  offsetMs: '0', feverStart: '', feverEnd: '', finishTime: '',
}

describe('自制谱元数据输入', () => {
  it('保留标题和负音频偏移，空 Fever 与曲终表示不覆盖', () => {
    expect(parseMetadataDraft({ ...draft, offsetMs: '-125' })).toMatchObject({
      title: '自制谱', offsetMs: -125, fever: null, finishTime: null,
    })
  })
  it.each([
    { feverStart: '1', feverEnd: '' },
    { feverStart: '2', feverEnd: '2' },
    { feverStart: '-1', feverEnd: '2' },
    { finishTime: 'Infinity' },
    { finishTime: '-1' },
    { offsetMs: 'NaN' },
  ])('拒绝非法数值或不完整 Fever %j', change => {
    expect(() => parseMetadataDraft({ ...draft, ...change })).toThrow()
  })
  it('允许零曲终，空白可选文本转换为 null', () => {
    expect(parseMetadataDraft({ ...draft, difficulty: '  ', composer: '  ', finishTime: '0' }))
      .toMatchObject({ difficulty: null, composer: null, finishTime: 0 })
  })
  it('原样保留特殊字符文本，不解释 HTML', () => {
    const value = '<img src=x onerror=alert(1)>'
    expect(parseMetadataDraft({ ...draft, title: value }).title).toBe(value)
  })
})
