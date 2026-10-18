import { describe, expect, it } from 'vitest'
import {
  candidatesForPath, chartCandidates, libraryFromInput, mvCandidates,
} from '../src/localAssets'

describe('本地资源文件名映射', () => {
  it('MV 优先原包 USM，其次同名视频', () => {
    expect(mvCandidates('103103')).toEqual([
      'music_lyric_video_103103.usm',
      '103103.mp4', '103103.webm', '103103.mov', '103103.mkv', '103103.m4v',
    ])
  })

  it('谱面原包 bytes 优先，其次自制谱 json', () => {
    expect(chartCandidates('rhythmgame_chart_103103_01.bytes'))
      .toEqual(['rhythmgame_chart_103103_01.bytes', 'rhythmgame_chart_103103_01.json'])
  })

  it('谱面路径已是 json 时两种都试', () => {
    expect(chartCandidates('my-chart.json')).toEqual(['my-chart.bytes', 'my-chart.json'])
  })

  it('由公开路径反推 MV 候选', () => {
    expect(candidatesForPath('/assets/mv/103103.mp4'))
      .toEqual(mvCandidates('103103'))
  })

  it('HLS 播放列表路径反推出同一组 MV 候选', () => {
    expect(candidatesForPath('/assets/mv/103103/index.m3u8'))
      .toEqual(mvCandidates('103103'))
  })

  it('谱面路径直接按文件名匹配', () => {
    expect(candidatesForPath('/assets/chart/rhythmgame_chart_103103_01.bytes'))
      .toEqual(['rhythmgame_chart_103103_01.bytes'])
  })

  it('空路径不产生候选', () => {
    expect(candidatesForPath('')).toEqual([])
  })

  it('input 建库只登记文件名，同名先到先得', () => {
    const first = new File(['a'], 'music_lyric_video_103103.usm')
    const second = new File(['b'], 'music_lyric_video_103103.usm')
    const other = new File(['c'], 'rhythmgame_chart_103103_01.bytes')
    const library = libraryFromInput([first, second, other])
    expect(library.has('music_lyric_video_103103.usm')).toBe(true)
    expect(library.has('nope.usm')).toBe(false)
    expect(library.names().sort())
      .toEqual(['music_lyric_video_103103.usm', 'rhythmgame_chart_103103_01.bytes'])
    return expect(library.file('music_lyric_video_103103.usm')).resolves.toBe(first)
  })
})
