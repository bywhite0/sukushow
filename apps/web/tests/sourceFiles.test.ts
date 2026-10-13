import { deflateRawSync } from 'node:zlib'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { parseChart } from '@sukushow/chart/chart'
import { SongSelectionStore } from '../src/songSelection'
import { createSourceFiles } from '../src/sourceFiles'

const catalog = {
  source: '', total: 1, withChart: 0, withJacket: 0, units: {}, songs: [{
    id: '104119', orderId: 1, title: 'SAKURA', furigana: '', category: '', unitId: '', unitName: '',
    generationsId: '', jacketId: '', jacketAsset: '', jacketPath: '', hasJacket: false, charts: {},
    difficulties: [], levels: {}, maxCombos: {}, hasChart: false, soundId: '', songTime: 0, playTime: 0,
    feverSectionNo: 0, centerCharacterId: '', singerCharacterId: '', supportCharacterId: '', startTime: '', isVideoMode: false,
  }],
}
const validJson = JSON.stringify({ Notes: [{ Uid: 1, just: '1', holds: [], Flags: 160 }], Bpms: [{ Time: 0, Bpm: 120 }] })
const store = () => new SongSelectionStore()

describe('本地来源文件', () => {
  const created: string[] = []
  const revoked: string[] = []
  beforeEach(() => {
    created.length = 0
    revoked.length = 0
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => { const url = `blob:test-${created.length}`; created.push(url); return url }), revokeObjectURL: vi.fn(url => revoked.push(url)) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([true, false])('连续选择谱面始终保留最后选择，旧文件先完成：%s', async olderFirst => {
    const current = store()
    const files = createSourceFiles(current)
    const finishes: (() => void)[] = []
    const open = (name: string) => {
      const file = new File([validJson], name)
      vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(done => {
        finishes.push(() => done(new TextEncoder().encode(validJson).buffer))
      }))
      return files.openChart(file)
    }
    const older = open('older.json')
    const latest = open('latest.json')
    finishes[olderFirst ? 0 : 1]!()
    await Promise.resolve()
    finishes[olderFirst ? 1 : 0]!()
    expect(await older).toBe(false)
    expect(await latest).toBe(true)
    expect(current.getSource().chart).toMatchObject({ filename: 'latest.json' })
    files.dispose()
  })

  it('超限音频在读取和创建 URL 前拒绝且保留有效媒体', async () => {
    const current = store()
    const files = createSourceFiles(current)
    await files.openMedia('audio', new File(['audio'], 'old.wav'))
    const before = current.getSource()
    const file = new File([], 'large.wav')
    Object.defineProperty(file, 'size', { value: 128 * 1024 * 1024 + 1 })
    const read = vi.spyOn(file, 'arrayBuffer')
    await expect(files.openMedia('audio', file)).rejects.toThrow('128 MiB')
    expect(read).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
    expect(current.getSource()).toBe(before)
    files.dispose()
  })

  it('URL 来源在文件读取中失效不得提交谱面', async () => {
    const current = store()
    const files = createSourceFiles(current)
    let allowed = true
    let finish!: (bytes: ArrayBuffer) => void
    const file = new File([validJson], 'url.json')
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(done => { finish = done }))
    const opening = files.openChart(file, () => allowed)
    allowed = false
    finish(new TextEncoder().encode(validJson).buffer)
    expect(await opening).toBe(false)
    expect(current.getSource().chart).toEqual({ kind: 'none' })
    files.dispose()
  })

  it('合法 JSON 谱面绑定当前歌曲，文件名只作元数据', async () => {
    const current = store()
    const files = createSourceFiles(current)
    expect(await files.openChart(new File([validJson], 'local.json'))).toBe(true)
    expect(current.getSource().chart).toMatchObject({ kind: 'custom', filename: 'local.json' })
    files.dispose()
  })

  it('损坏谱面不改变原有有效来源', async () => {
    const current = store()
    current.openCustom(parseChart(JSON.parse(validJson)), 'old.json')
    const files = createSourceFiles(current)
    await expect(files.openChart(new File(['bad'], 'bad.json'))).rejects.toThrow()
    expect(current.getSource().chart).toMatchObject({ kind: 'custom', filename: 'old.json' })
    files.dispose()
  })

  it('合法压缩 bytes 与正好 16 MiB 的 JSON 均可打开', async () => {
    const current = store()
    const files = createSourceFiles(current)
    const compressed = new Uint8Array(deflateRawSync(validJson))
    expect(await files.openChart(new File([compressed], 'local.bytes'))).toBe(true)
    expect(current.getSource().chart).toMatchObject({ kind: 'custom', filename: 'local.bytes' })
    const padded = validJson.padEnd(16 * 1024 * 1024, ' ')
    expect(await files.openChart(new File([padded], 'boundary.json'))).toBe(true)
    expect(current.getSource().chart).toMatchObject({ kind: 'custom', filename: 'boundary.json' })
    files.dispose()
  })

  it('空文件拒绝且保留此前合法谱面', async () => {
    const current = store()
    const files = createSourceFiles(current)
    await files.openChart(new File([validJson], 'old.json'))
    const before = current.getSource()
    await expect(files.openChart(new File([], 'empty.bytes'))).rejects.toThrow()
    expect(current.getSource()).toBe(before)
    files.dispose()
  })

  it('超过 16 MiB 在读取前拒绝', async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024 + 1)], 'large.bytes')
    const read = vi.spyOn(file, 'arrayBuffer')
    await expect(createSourceFiles(store()).openChart(file)).rejects.toThrow('16 MiB')
    expect(read).not.toHaveBeenCalled()
  })

  it('媒体 URL 成功提交，清除后释放 URL，重复 dispose 安全', async () => {
    const current = store()
    const files = createSourceFiles(current)
    const image = await files.openMedia('cover', new File(['image'], 'cover.png', { type: 'image/png' }))
    expect(image).toBe(true)
    const url = current.getSource().media.cover
    expect(url).toMatchObject({ kind: 'file', name: 'cover.png' })
    files.clearMedia('cover')
    expect(current.getSource().media.cover).toEqual({ kind: 'none' })
    files.dispose()
    files.dispose()
    expect(revoked).toContain((url as { url: string }).url)
  })

  it('切换视图释放租约不撤销仍被选中的媒体', async () => {
    const files = createSourceFiles(store())
    await files.openMedia('cover', new File(['image'], 'a.png'))
    const release = files.retain([created[0]!])
    release()
    expect(revoked).toEqual([])
    files.clearMedia('cover')
    expect(revoked).toEqual([created[0]])
    files.dispose()
  })

  it('替换媒体后等旧视图释放租约才撤销旧 URL', async () => {
    const files = createSourceFiles(store())
    await files.openMedia('cover', new File(['image'], 'a.png'))
    const release = files.retain([created[0]!])
    await files.openMedia('cover', new File(['image'], 'b.png'))
    expect(revoked).toEqual([])
    release()
    release()
    expect(revoked).toEqual([created[0]])
    files.dispose()
    expect(revoked).toEqual(created)
  })

  it('切歌立即释放无租约媒体，dispose 保留在用租约直到归还', async () => {
    const current = store()
    const files = createSourceFiles(current)
    await files.openMedia('cover', new File(['image'], 'a.png'))
    current.selectCatalog({ songId: '104119', difficulty: null }, catalog)
    expect(revoked).toEqual([created[0]])
    await files.openMedia('cover', new File(['image'], 'b.png'))
    const release = files.retain([created[1]!, '/assets/jacket/catalog.png'])
    files.dispose()
    expect(revoked).toEqual([created[0]])
    release()
    expect(revoked).toEqual(created)
  })

  it('加载期间切换歌曲，过期文件不会覆盖新来源', async () => {
    const current = store()
    const files = createSourceFiles(current)
    const pending = files.openMedia('cover', new File(['image'], 'cover.png', { type: 'image/png' }))
    current.selectCatalog({ songId: '104119', difficulty: null }, catalog)
    await expect(pending).resolves.toBe(false)
    expect(current.getSource().media.cover).toEqual({ kind: 'inherit' })
    files.dispose()
  })
})
