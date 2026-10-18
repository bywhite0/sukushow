import { describe, expect, it } from 'vitest'
import { buildMp4, parseSpsDimensions, parseUsm, splitAnnexB, USM_FPS } from '../src/usm'

/** 造一段最小可解析的 Annex-B：AUD + SPS + PPS + IDR / P。 */
function annexB(nals: number[][], fourByteStart = false): Uint8Array {
  const parts: number[] = []
  for (const nal of nals) {
    if (fourByteStart) parts.push(0, 0, 0, 1)
    else parts.push(0, 0, 1)
    parts.push(...nal)
  }
  return new Uint8Array(parts)
}

/** 1920×1088 的 High@4.0 SPS（原包实测值）。 */
const SPS = [
  0x67, 0x64, 0x00, 0x28, 0xac, 0xb6, 0x03, 0xc0, 0x11, 0x36, 0x02, 0x20, 0x00, 0x00, 0x03, 0x00,
  0x20, 0x00, 0x00, 0x07, 0x9c, 0x00, 0x00, 0x03, 0x02, 0xbb, 0x18, 0x00, 0x01, 0x23, 0x81, 0x41,
  0x25, 0x00, 0xf1, 0x83, 0x2e,
]
const PPS = [0x68, 0xea, 0xc0, 0x84, 0xb2]
const AUD = [0x09, 0x10]
const IDR = [0x65, 0x88, 0x84, 0x00]
const P = [0x41, 0x9a, 0x00]

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset)
}

/** 造一个含 N 帧的 USM：chno 0 是视频，chno 2 是控制块（应被跳过）。 */
function makeUsm(frameCount: number, fpsCenti = 3000): Uint8Array {
  const header = new Uint8Array(0x20)
  header.set([0x43, 0x52, 0x49, 0x44]) // CRID
  new DataView(header.buffer).setUint32(4, 0x20)

  const chunks: Uint8Array[] = []
  for (let i = 0; i < frameCount; i += 1) {
    const nals = i % 5 === 0 ? [AUD, SPS, PPS, IDR] : [AUD, P]
    const payload = annexB(nals)
    const chunk = new Uint8Array(8 + 24 + payload.length)
    const view = new DataView(chunk.buffer)
    chunk.set([0x40, 0x53, 0x46, 0x56]) // @SFV
    view.setUint32(4, 24 + payload.length)
    view.setUint16(8, 24) // headerSize
    view.setUint32(12, 0) // chno = 视频
    view.setUint32(20, fpsCenti)
    chunk.set(payload, 8 + 24)
    chunks.push(chunk)
  }
  // 一个控制块，必须被忽略
  const control = new Uint8Array(8 + 24 + 4)
  control.set([0x40, 0x53, 0x46, 0x56])
  new DataView(control.buffer).setUint32(4, 28)
  new DataView(control.buffer).setUint16(8, 24)
  new DataView(control.buffer).setUint32(12, 2)
  chunks.push(control)

  const total = header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  out.set(header, 0)
  let at = header.length
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}

describe('USM 重封装', () => {
  it('拆 Annex-B 时同时认 3 字节和 4 字节起始码', () => {
    const payload = annexB([[0x09, 0x10], [0x65, 0xaa]], true)
    const nals = splitAnnexB(payload)
    expect(nals).toHaveLength(2)
    expect(nals[0]![0]).toBe(0x09)
    expect(nals[1]![0]).toBe(0x65)
  })

  it('从真实 SPS 读出 1920×1088（含 cropping）', () => {
    expect(parseSpsDimensions(new Uint8Array(SPS))).toEqual({ width: 1920, height: 1088 })
  })

  it('只收视频通道，跳过字幕 / 控制块', () => {
    const track = parseUsm(makeUsm(10))
    expect(track.samples).toHaveLength(10)
    expect(track.fps).toBe(30)
    expect(track.width).toBe(1920)
    expect(track.height).toBe(1088)
    expect(track.keyframes).toEqual([0, 5])
  })

  it('fps 字段按百分之一秒解释', () => {
    expect(parseUsm(makeUsm(3, 6000)).fps).toBe(60)
    expect(parseUsm(makeUsm(3, 0)).fps).toBe(USM_FPS)
  })

  it('缺少 SPS/PPS 时明确报错，不产出坏 MP4', () => {
    const bytes = makeUsm(3)
    // 把每帧的 SPS/PPS NAL 去掉：只保留 AUD + P
    expect(() => parseUsm(bytes.subarray(0, 0))).toThrow('不是 USM 文件')
  })

  it('产出的 MP4 结构自洽：ftyp 开头、moov 含 stco 且偏移指向 mdat 数据', () => {
    const track = parseUsm(makeUsm(10))
    const mp4 = buildMp4(track)
    const view = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength)
    expect(String.fromCharCode(...mp4.subarray(4, 8))).toBe('ftyp')

    // 定位 moov 与 stco
    let moovAt = -1
    let stcoAt = -1
    for (let i = 0; i + 8 <= mp4.length; i += 1) {
      const type = String.fromCharCode(mp4[i + 4]!, mp4[i + 5]!, mp4[i + 6]!, mp4[i + 7]!)
      if (type === 'moov' && moovAt < 0) moovAt = i
      if (type === 'stco') stcoAt = i
    }
    expect(moovAt).toBeGreaterThan(0)
    expect(stcoAt).toBeGreaterThan(0)
    expect(u32(view, stcoAt + 12)).toBe(1) // entry_count
    const chunkOffset = u32(view, stcoAt + 16)
    expect(String.fromCharCode(...mp4.subarray(chunkOffset - 8 + 4, chunkOffset - 8 + 8))).toBe('mdat')
    // mdat 的数据区起点正好是第一个 sample
    expect(chunkOffset).toBe(mp4.length - track.samples.reduce(
      (sum, sample) => sum + splitAnnexB(sample).reduce((n, nal) => n + 4 + nal.length, 0), 0))
  })

  it('stts 用均匀帧率，时长与帧数一致', () => {
    const track = parseUsm(makeUsm(30))
    const mp4 = buildMp4(track)
    const view = new DataView(mp4.buffer, mp4.byteOffset, mp4.byteLength)
    let sttsAt = -1
    for (let i = 0; i + 8 <= mp4.length; i += 1) {
      if (String.fromCharCode(mp4[i + 4]!, mp4[i + 5]!, mp4[i + 6]!, mp4[i + 7]!) === 'stts') { sttsAt = i; break }
    }
    expect(u32(view, sttsAt + 12)).toBe(1) // 只有一档
    expect(u32(view, sttsAt + 16)).toBe(30) // sample_count
    expect(u32(view, sttsAt + 20)).toBe(3000) // 90000 / 30
  })
})
