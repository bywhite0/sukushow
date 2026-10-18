import { describe, expect, it, vi } from 'vitest'
import { setLibrary } from '../src/localMedia'
import { libraryFromInput } from '../src/localAssets'

// localizeMv 会先探测站点是否已有该 MV；这里统一返回「没有」，
// 以便验证回退到本地的分支。
const fetchMock = vi.fn(async () => new Response('', { status: 404 }))
vi.stubGlobal('fetch', fetchMock)
vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:local', revokeObjectURL: () => {} })

const { localizeMv, localChart } = await import('../src/localMedia')

const library = (files: File[]) => libraryFromInput(files)

describe('本地 MV 解析', () => {
  it('站点有 MV 时优先用站点资源，不读本地文件', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('x', {
      status: 206, headers: { 'content-type': 'video/mp4' },
    }))
    setLibrary(library([new File([new Uint8Array(8)], 'music_lyric_video_103103.usm')]))
    await expect(localizeMv('/assets/mv/103103.mp4')).resolves.toBe('/assets/mv/103103.mp4')
  })

  // 站点是否自带某 MV 会按路径缓存（同一构建内不会变），
  // 所以「站点没有」的用例各用一首不同曲目，避免互相污染。
  it('站点没有 MV 且本地是合法 USM 时重封装成 blob URL', async () => {
    setLibrary(library([new File([usmBytes(3)], 'music_lyric_video_104119.usm')]))
    await expect(localizeMv('/assets/mv/104119.mp4')).resolves.toBe('blob:local')
  })

  it('本地文件不是合法 USM 时回落到站点路径，而不是抛错', async () => {
    setLibrary(library([new File([new Uint8Array(64)], 'music_lyric_video_204104.usm')]))
    await expect(localizeMv('/assets/mv/204104.mp4')).resolves.toBe('/assets/mv/204104.mp4')
  })

  it('本地是现成视频文件时直接当 blob 播放', async () => {
    setLibrary(library([new File(['fake-mp4'], '405206.mp4')]))
    await expect(localizeMv('/assets/mv/405206.mp4')).resolves.toBe('blob:local')
  })

  it('本地 webm 也能用', async () => {
    setLibrary(library([new File(['fake'], '303103.webm')]))
    await expect(localizeMv('/assets/mv/303103.mp4')).resolves.toBe('blob:local')
  })

  it('没有接入本地库时原样返回站点路径', async () => {
    setLibrary(null)
    await expect(localizeMv('/assets/mv/103103.mp4')).resolves.toBe('/assets/mv/103103.mp4')
  })

  it('路径为 null 时保持 null', async () => {
    await expect(localizeMv(null)).resolves.toBeNull()
  })
})

describe('HLS 站点资源', () => {
  it('站点是 HLS 播放列表时返回 m3u8 路径', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', {
      status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' },
    }))
    setLibrary(null)
    await expect(localizeMv('/assets/mv/103106/index.m3u8'))
      .resolves.toBe('/assets/mv/103106/index.m3u8')
  })

  it('content-type 为空但资源存在时同样算命中', async () => {
    // Vite dev 对 .m3u8 不给 content-type，不能因此判定不存在。
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 200 }))
    setLibrary(null)
    await expect(localizeMv('/assets/mv/104105/index.m3u8'))
      .resolves.toBe('/assets/mv/104105/index.m3u8')
  })

  it('没有 HLS 但存在老的单文件 mp4 时回落到 mp4', async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response('', { status: 404 }))
      .mockImplementationOnce(async () => new Response('', {
        status: 200, headers: { 'content-type': 'video/mp4' },
      }))
    setLibrary(null)
    await expect(localizeMv('/assets/mv/203102/index.m3u8'))
      .resolves.toBe('/assets/mv/203102.mp4')
  })

  it('HLS 路径在站点缺失时能回落到本地 USM', async () => {
    setLibrary(library([new File([usmBytes(3)], 'music_lyric_video_305101.usm')]))
    await expect(localizeMv('/assets/mv/305101/index.m3u8')).resolves.toBe('blob:local')
  })

  it('返回 HTML（SPA 回退）不算站点有 MV', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    }))
    setLibrary(null)
    await expect(localizeMv('/assets/mv/205101/index.m3u8'))
      .resolves.toBe('/assets/mv/205101/index.m3u8')
  })
})

describe('本地谱面解析', () => {
  it('按文件名命中', async () => {
    const file = new File(['x'], 'rhythmgame_chart_103103_01.bytes')
    setLibrary(library([file]))
    await expect(localChart('rhythmgame_chart_103103_01.bytes')).resolves.toBe(file)
  })

  it('自制谱 json 也能命中', async () => {
    const file = new File(['{"Notes":[]}'], 'rhythmgame_chart_103103_01.json')
    setLibrary(library([file]))
    await expect(localChart('rhythmgame_chart_103103_01.bytes')).resolves.toBe(file)
  })

  it('未命中返回 null', async () => {
    setLibrary(library([new File(['x'], 'other.bytes')]))
    await expect(localChart('rhythmgame_chart_103103_01.bytes')).resolves.toBeNull()
  })

  it('没有接入本地库时返回 null', async () => {
    setLibrary(null)
    await expect(localChart('rhythmgame_chart_103103_01.bytes')).resolves.toBeNull()
  })
})

/** 造一个最小合法 USM（3 帧，含 SPS/PPS/IDR）。 */
function usmBytes(frameCount: number): Uint8Array {
  const header = new Uint8Array(0x20)
  header.set([0x43, 0x52, 0x49, 0x44])
  const chunks: Uint8Array[] = []
  const SPS = [0x67, 0x64, 0x00, 0x28, 0xac, 0xb6, 0x03, 0xc0, 0x11, 0x36, 0x02, 0x20, 0x00, 0x00,
    0x03, 0x00, 0x20, 0x00, 0x00, 0x07, 0x9c, 0x00, 0x00, 0x03, 0x02, 0xbb, 0x18, 0x00, 0x01,
    0x23, 0x81, 0x41, 0x25, 0x00, 0xf1, 0x83, 0x2e]
  const PPS = [0x68, 0xea, 0xc0, 0x84, 0xb2]
  const AUD = [0x09, 0x10]
  const IDR = [0x65, 0x88, 0x84, 0x00]
  const P = [0x41, 0x9a, 0x00]
  for (let i = 0; i < frameCount; i += 1) {
    const nals = i === 0 ? [AUD, SPS, PPS, IDR] : [AUD, P]
    const payload: number[] = []
    for (const nal of nals) payload.push(0, 0, 1, ...nal)
    const chunk = new Uint8Array(8 + 24 + payload.length)
    chunk.set([0x40, 0x53, 0x46, 0x56])
    const view = new DataView(chunk.buffer)
    view.setUint32(4, 24 + payload.length)
    view.setUint16(8, 24)
    view.setUint32(20, 3000)
    chunk.set(payload, 8 + 24)
    chunks.push(chunk)
  }
  const total = header.length + chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  out.set(header, 0)
  let at = header.length
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}
