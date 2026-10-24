import { describe, expect, it, vi, afterEach } from 'vitest'
import { fetchBytes } from '../src/llll/songAssets'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchBytes', () => {
  it('url 为 null 时返回 null', async () => {
    expect(await fetchBytes(null)).toBeNull()
  })

  it('HTTP 失败时返回 null 而不抛错（资源缺失不该阻断渲染）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await fetchBytes('/assets/jacket/无此文件.png')).toBeNull()
  })

  it('成功时返回字节', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })))
    const bytes = await fetchBytes('/assets/audio/bgm_10310301.ogg')
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes!)).toEqual([1, 2, 3])
  })
})
