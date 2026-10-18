/**
 * CRI USM → 可播放 MP4 的重封装（纯 JS，无 wasm）。
 *
 * 原包 MV 是 CRI `@SFV` 容器：视频流就是裸 H.264 Annex-B（AUD/SPS/PPS/SEI/IDR/P）。
 * 这批素材的实测口径（58 个文件全部一致）：
 *   - 视频块 `chno == 0`，`headerSize == 24`，`fps` 字段 = 3000（即 30 fps）
 *   - 无音频块（`chno 1/2/3` 是字幕 / 控制，共 5 个）
 *   - 每帧以 AUD(type 9) 开头，IDR 前重发 SPS/PPS
 * 因此可以逐块切出 access unit，按固定帧率均匀铺 `stts`，无需解析 B 帧重排。
 *
 * 产物只用于 `URL.createObjectURL` 喂给 `<video>`，不落盘、不上传。
 */

/** USM 视频流实测固定 30 fps（fps 字段 3000 = 30.00）。 */
export const USM_FPS = 30

const CHUNK_MAGIC = '@SFV'

export type UsmVideoTrack = {
  /** 每个 access unit 的 Annex-B 字节。 */
  samples: Uint8Array[]
  /** 首帧 SPS / PPS（avcC 用）。 */
  sps: Uint8Array
  pps: Uint8Array
  /** 关键帧下标（升序，含 0）。 */
  keyframes: number[]
  width: number
  height: number
  fps: number
}

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[offset + i]!)
  return out
}

/** 找第一个 `@SFV`；CRID 头长度字段之后可能还有对齐填充。 */
function findFirstChunk(bytes: Uint8Array, from: number): number {
  for (let i = from; i + 4 <= bytes.length; i += 1) {
    if (bytes[i] === 0x40 && bytes[i + 1] === 0x53 && bytes[i + 2] === 0x46 && bytes[i + 3] === 0x56) return i
  }
  return -1
}

/** 把 Annex-B 拆成 NAL 列表（不含起始码）。 */
export function splitAnnexB(payload: Uint8Array): Uint8Array[] {
  const starts: { start: number; len: number }[] = []
  for (let i = 0; i + 3 <= payload.length; i += 1) {
    if (payload[i] !== 0 || payload[i + 1] !== 0) continue
    if (payload[i + 2] === 1) {
      starts.push({ start: i + 3, len: 3 })
      i += 2
    } else if (payload[i + 2] === 0 && i + 4 <= payload.length && payload[i + 3] === 1) {
      starts.push({ start: i + 4, len: 4 })
      i += 3
    }
  }
  const nals: Uint8Array[] = []
  for (let k = 0; k < starts.length; k += 1) {
    const begin = starts[k]!.start
    const end = k + 1 < starts.length ? starts[k + 1]!.start - starts[k + 1]!.len : payload.length
    if (end > begin) nals.push(payload.subarray(begin, end))
  }
  return nals
}

/**
 * 解析 USM 的视频轨道。
 *
 * 只认 `chno === 0`；字幕 / 控制块直接跳过。每个块自成一帧（实测每块恰好一个 access unit）。
 */
export function parseUsm(bytes: Uint8Array): UsmVideoTrack {
  if (ascii(bytes, 0, 4) !== 'CRID') throw new Error('不是 USM 文件（缺少 CRID 头）')
  const headerEnd = u32(bytes, 4)
  const first = findFirstChunk(bytes, headerEnd)
  if (first < 0) throw new Error('USM 里没有 @SFV 数据块')

  const samples: Uint8Array[] = []
  const keyframes: number[] = []
  let sps: Uint8Array | null = null
  let pps: Uint8Array | null = null
  let fps = USM_FPS

  let pos = first
  while (pos + 8 <= bytes.length) {
    if (ascii(bytes, pos, 4) !== CHUNK_MAGIC) break
    const size = u32(bytes, pos + 4)
    const headerSize = u16(bytes, pos + 8)
    const chno = u32(bytes, pos + 12)
    const fpsCenti = u32(bytes, pos + 20)
    const dataStart = pos + 8 + headerSize
    const dataEnd = pos + 8 + size
    if (size < headerSize || dataEnd > bytes.length) break
    if (chno === 0 && dataEnd > dataStart) {
      if (fpsCenti > 0) fps = fpsCenti / 100
      const payload = bytes.subarray(dataStart, dataEnd)
      let isKey = false
      for (const nal of splitAnnexB(payload)) {
        const type = nal[0]! & 0x1f
        if (type === 7 && !sps) sps = nal.slice()
        else if (type === 8 && !pps) pps = nal.slice()
        else if (type === 5) isKey = true
      }
      if (isKey) keyframes.push(samples.length)
      samples.push(payload)
    }
    pos += 8 + size
  }

  if (!samples.length) throw new Error('USM 里没有视频块')
  if (!sps || !pps) throw new Error('USM 视频流缺少 SPS/PPS')
  const { width, height } = parseSpsDimensions(sps)
  return { samples, sps, pps, keyframes, width, height, fps }
}

/** 从 SPS 里取显示宽高（含 cropping）。覆盖 H.264 常见 profile。 */
export function parseSpsDimensions(sps: Uint8Array): { width: number; height: number } {
  const rbsp = unescapeRbsp(sps.subarray(1))
  let bit = 0
  const readBit = (): number => {
    const value = (rbsp[bit >> 3]! >> (7 - (bit & 7))) & 1
    bit += 1
    return value
  }
  const readBits = (count: number): number => {
    let value = 0
    for (let i = 0; i < count; i += 1) value = value * 2 + readBit()
    return value
  }
  const readUe = (): number => {
    let zeros = 0
    while (readBit() === 0 && zeros < 32) zeros += 1
    return zeros === 0 ? 0 : 2 ** zeros - 1 + readBits(zeros)
  }
  const readSe = (): number => {
    const value = readUe()
    return value % 2 === 0 ? -(value / 2) : (value + 1) / 2
  }

  const profileIdc = readBits(8)
  readBits(8) // constraint flags
  readBits(8) // level_idc
  readUe() // seq_parameter_set_id
  let chromaFormatIdc = 1
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profileIdc)) {
    chromaFormatIdc = readUe()
    if (chromaFormatIdc === 3) readBit()
    readUe() // bit_depth_luma_minus8
    readUe() // bit_depth_chroma_minus8
    readBit() // qpprime_y_zero_transform_bypass
    if (readBit()) {
      for (let i = 0; i < (chromaFormatIdc !== 3 ? 8 : 12); i += 1) {
        if (!readBit()) continue
        let last = 8
        let next = 8
        for (let j = 0; j < (i < 6 ? 16 : 64); j += 1) {
          if (next !== 0) next = (last + readSe() + 256) % 256
          if (next !== 0) last = next
        }
      }
    }
  }
  readUe() // log2_max_frame_num_minus4
  const pocType = readUe()
  if (pocType === 0) readUe()
  else if (pocType === 1) {
    readBit()
    readSe()
    readSe()
    const cycle = readUe()
    for (let i = 0; i < cycle; i += 1) readSe()
  }
  readUe() // max_num_ref_frames
  readBit() // gaps_in_frame_num_value_allowed
  const widthInMbs = readUe() + 1
  const heightInMapUnits = readUe() + 1
  const frameMbsOnly = readBit()
  if (!frameMbsOnly) readBit() // mb_adaptive_frame_field
  readBit() // direct_8x8_inference
  let cropLeft = 0
  let cropRight = 0
  let cropTop = 0
  let cropBottom = 0
  if (readBit()) {
    cropLeft = readUe()
    cropRight = readUe()
    cropTop = readUe()
    cropBottom = readUe()
  }
  const chromaArrayType = frameMbsOnly ? chromaFormatIdc : 0
  const subWidthC = chromaFormatIdc === 3 ? 1 : 2
  const subHeightC = chromaFormatIdc === 1 ? 2 : 1
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC
  const cropUnitY = (chromaArrayType === 0 ? 1 : subHeightC) * (2 - frameMbsOnly)
  return {
    width: widthInMbs * 16 - (cropLeft + cropRight) * cropUnitX,
    height: heightInMapUnits * 16 * (2 - frameMbsOnly) - (cropTop + cropBottom) * cropUnitY,
  }
}

/** 去掉 emulation prevention bytes（00 00 03 → 00 00）。 */
function unescapeRbsp(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length)
  let n = 0
  let zeros = 0
  for (const byte of bytes) {
    if (zeros >= 2 && byte === 3) { zeros = 0; continue }
    out[n++] = byte
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return out.subarray(0, n)
}

// ── MP4 写出 ──────────────────────────────────────────────────────

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

function u32Bytes(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0)
  return out
}

function u16Bytes(value: number): Uint8Array {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value & 0xffff)
  return out
}

/** 组装 box：type + payload。尺寸写成 32 位。 */
function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(parts)
  const head = new Uint8Array(8)
  new DataView(head.buffer).setUint32(0, 8 + payload.length)
  for (let i = 0; i < 4; i += 1) head[4 + i] = type.charCodeAt(i)
  return concat([head, payload])
}

/** version + flags 前缀。 */
function vf(version: number, flags = 0): Uint8Array {
  return new Uint8Array([version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff])
}

/** 3×3 单位矩阵（16.16 定点，末列 2.30）。 */
const UNITY_MATRIX = (() => {
  const out = new Uint8Array(36)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint32(16, 0x00010000)
  view.setUint32(32, 0x40000000)
  return out
})()

/** Annex-B NAL → 4 字节长度前缀（avc1 sample 格式）。 */
function toLengthPrefixed(sample: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  for (const nal of splitAnnexB(sample)) parts.push(u32Bytes(nal.length), nal)
  return concat(parts)
}

function avc1Entry(track: UsmVideoTrack): Uint8Array {
  const { sps, pps, width, height } = track
  const entry = new Uint8Array(78)
  const view = new DataView(entry.buffer)
  view.setUint16(6, 1) // data_reference_index
  view.setUint16(24, width)
  view.setUint16(26, height)
  view.setUint32(28, 0x00480000) // horizresolution 72 dpi
  view.setUint32(32, 0x00480000) // vertresolution
  view.setUint16(40, 1) // frame_count
  const name = 'USM Remux'
  for (let i = 0; i < name.length && i < 31; i += 1) entry[42 + i] = name.charCodeAt(i)
  view.setUint16(74, 0x0018) // depth
  view.setUint16(76, 0xffff) // pre_defined = -1

  const avcC = new Uint8Array(6 + 2 + sps.length + 1 + 2 + pps.length)
  avcC[0] = 1 // configurationVersion
  avcC[1] = sps[1]! // AVCProfileIndication
  avcC[2] = sps[2]! // profile_compatibility
  avcC[3] = sps[3]! // AVCLevelIndication
  avcC[4] = 0xff // 4 字节长度前缀
  avcC[5] = 0xe1 // numOfSequenceParameterSets = 1
  avcC[6] = (sps.length >> 8) & 0xff
  avcC[7] = sps.length & 0xff
  avcC.set(sps, 8)
  let at = 8 + sps.length
  avcC[at++] = 1 // numOfPictureParameterSets
  avcC[at++] = (pps.length >> 8) & 0xff
  avcC[at++] = pps.length & 0xff
  avcC.set(pps, at)

  return box('avc1', entry, box('avcC', avcC.subarray(0, at + pps.length)))
}

function sampleTable(track: UsmVideoTrack, timescale: number, sampleDelta: number): Uint8Array {
  const sizes = track.samples.map((sample) => toLengthPrefixed(sample).length)
  const stsd = box('stsd', vf(0), u32Bytes(1), avc1Entry(track))
  const stts = box('stts', vf(0), u32Bytes(1), u32Bytes(track.samples.length), u32Bytes(sampleDelta))
  const stsc = box('stsc', vf(0), u32Bytes(1), u32Bytes(1), u32Bytes(track.samples.length), u32Bytes(1))

  const stszPayload = new Uint8Array(8 + sizes.length * 4)
  const stszView = new DataView(stszPayload.buffer)
  stszView.setUint32(4, sizes.length)
  sizes.forEach((size, i) => stszView.setUint32(8 + i * 4, size))
  const stsz = box('stsz', vf(0), stszPayload)

  // 单 chunk：偏移在 assemble 阶段回填。
  const stco = box('stco', vf(0), u32Bytes(1), u32Bytes(0))

  const stssPayload = new Uint8Array(4 + track.keyframes.length * 4)
  const stssView = new DataView(stssPayload.buffer)
  stssView.setUint32(0, track.keyframes.length)
  track.keyframes.forEach((index, i) => stssView.setUint32(4 + i * 4, index + 1))
  const stss = box('stss', vf(0), stssPayload)

  void timescale
  return box('stbl', stsd, stts, stsc, stsz, stco, stss)
}

/**
 * 把解析出的视频轨道封成可播放的 MP4（moov 前置，`<video>` 可直接 seek）。
 *
 * @param track parseUsm 的结果
 */
export function buildMp4(track: UsmVideoTrack): Uint8Array {
  const timescale = 90000
  const sampleDelta = Math.round(timescale / track.fps)
  const duration = track.samples.length * sampleDelta
  const movieTimescale = 1000
  const movieDuration = Math.round((duration / timescale) * movieTimescale)

  const ftyp = box(
    'ftyp',
    new TextEncoder().encode('isom'),
    u32Bytes(512),
    new TextEncoder().encode('isomiso2avc1mp41'),
  )

  const mvhd = box(
    'mvhd', vf(0),
    u32Bytes(0), u32Bytes(0), u32Bytes(movieTimescale), u32Bytes(movieDuration),
    u32Bytes(0x00010000), u16Bytes(0x0100), u16Bytes(0),
    new Uint8Array(8), UNITY_MATRIX, new Uint8Array(24), u32Bytes(2),
  )

  const tkhd = box(
    'tkhd', vf(0, 3),
    u32Bytes(0), u32Bytes(0), u32Bytes(1), u32Bytes(0), u32Bytes(movieDuration),
    new Uint8Array(8), u16Bytes(0), u16Bytes(0), u16Bytes(0), u16Bytes(0),
    UNITY_MATRIX, u32Bytes(track.width << 16), u32Bytes(track.height << 16),
  )

  const mdhd = box(
    'mdhd', vf(0),
    u32Bytes(0), u32Bytes(0), u32Bytes(timescale), u32Bytes(duration),
    u16Bytes(0x55c4), u16Bytes(0),
  )

  const hdlr = box(
    'hdlr', vf(0),
    u32Bytes(0), new TextEncoder().encode('vide'), new Uint8Array(12),
    new TextEncoder().encode('VideoHandler\0'),
  )

  const vmhd = box('vmhd', vf(0, 1), u16Bytes(0), u16Bytes(0), u16Bytes(0), u16Bytes(0))
  const dinf = box('dinf', box('dref', vf(0), u32Bytes(1), box('url ', vf(0, 1))))
  const minf = box('minf', vmhd, dinf, sampleTable(track, timescale, sampleDelta))
  const mdia = box('mdia', mdhd, hdlr, minf)
  const trak = box('trak', tkhd, mdia)
  const moov = box('moov', mvhd, trak)

  // mdat 紧跟 moov，chunk 偏移 = ftyp + moov + mdat 头。
  const mdatOffset = ftyp.length + moov.length + 8
  patchStco(moov, mdatOffset)

  const sampleBytes = concat(track.samples.map(toLengthPrefixed))
  const mdat = box('mdat', sampleBytes)
  return concat([ftyp, moov, mdat])
}

/**
 * 回填 stco 的 chunk 偏移。
 *
 * moov 尺寸在写 stco 时还不确定（stco 自身长度固定，但 mvhd/tkhd 依赖宽度高度），
 * 所以先写 0 再按已知布局就地改写。
 */
function patchStco(moov: Uint8Array, offset: number): void {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength)
  for (let i = 0; i + 8 <= moov.length; i += 1) {
    if (moov[i + 4] !== 0x73 || moov[i + 5] !== 0x74 || moov[i + 6] !== 0x63 || moov[i + 7] !== 0x6f) continue
    // 'stco'：size(4) type(4) version+flags(4) entry_count(4) entry(4)
    view.setUint32(i + 16, offset)
    return
  }
  throw new Error('MP4 写出失败：找不到 stco')
}
