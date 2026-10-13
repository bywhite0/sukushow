import { describe, expect, it } from 'vitest'
import { readInitialSource, withCatalogChoice } from '../src/sourceUrl'

const url = (query = '') => new URL(`http://localhost/${query}`)
describe('来源 URL', () => {
  it('无来源参数才默认打开フォーチュンムービー', () => {
    expect(readInitialSource(url())).toEqual({ kind: 'catalog', songId: '103103', difficulty: null, offsetMs: 0 })
  })
  it.each(['?song=', '?song=%20', '?chart=', '?offset=Infinity', '?offset=12abc', '?cfg=bad'])('拒绝非法显式参数 %s', query => {
    expect(() => readInitialSource(url(query))).toThrow()
  })
  it('显式歌曲优先于谱面参数', () => {
    expect(readInitialSource(url('?song=104119&chart=/a.json&offset=-12')))
      .toEqual({ kind: 'catalog', songId: '104119', difficulty: null, offsetMs: -12 })
  })
  it.each(['chart', 'llll', 'llllChart', 'json', 'customScoreJson', 'scoreJson'])('保留 %s 来源别名', key => {
    expect(readInitialSource(url(`?${key}=/a.bytes&scoreTitle=local`)))
      .toEqual({ kind: 'url', url: '/a.bytes', title: 'local', offsetMs: 0 })
  })
  it('保留 JSON 及 base64url 配置', () => {
    const config = JSON.stringify({ chart: '/a.bytes', t: '测试', o: 25 })
    for (const value of [config, Buffer.from(config).toString('base64url')]) {
      expect(readInitialSource(url(`?config=${encodeURIComponent(value)}`)))
        .toEqual({ kind: 'url', url: '/a.bytes', title: '测试', offsetMs: 25 })
    }
  })
  it('选歌删除过时谱面配置但保留视图和其他设置', () => {
    const next = withCatalogChoice(url('?view=pjsk&chart=/a&cfg=old&speed=5'), { songId: '104119', difficulty: null })
    expect(next.searchParams.get('song')).toBe('104119')
    expect(next.searchParams.has('difficulty')).toBe(false)
    expect(next.searchParams.has('chart')).toBe(false)
    expect(next.searchParams.has('cfg')).toBe(false)
    expect(next.searchParams.get('view')).toBe('pjsk')
    expect(next.searchParams.get('speed')).toBe('5')
  })
})
