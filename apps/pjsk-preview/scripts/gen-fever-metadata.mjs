/**
 * 从 4L masterdata 生成 Fever 时段索引。
 *
 * 输入：
 *   docs/song-list.json                    曲目列表（含 feverSectionNo，源自 Musics.yaml）
 *   <4L>/cache/plain/musicscore_<Id>.csv   分段事件（key_type=20 边界 / key_type=99 曲终）
 *
 * 输出：
 *   src/llll/feverMetadata.json
 *
 * 口径与 `apps/llll-preview/src/feverMetadata.ts` 的 feverFromMusicScore 完全一致，
 * 以便两边的 Fever 窗口逐首可比对（该文件已按 236 首逐首核对通过）：
 *   - 四个 key_type=20 边界按时间升序，必须严格递增；
 *   - 第五段终点取 CSV **原始顺序**中最后一条 key_type=99（MusicEnd），
 *     不取最大时间，也不用 PlayTime；
 *   - times = [0, b0, b1, b2, b3, musicEnd]，第 n 段 = [times[n-1], times[n]]；
 *   - 毫秒转秒。
 *
 * 另输出 FeverChance 的**代理**窗口（`chanceStart`/`chanceEnd`）：
 *   llll **没有** chance 概念（`key_type` 只有 1/10/20/99），故取「Fever 段之前
 *   那一段」= `[times[n-2], times[n-1])`。这是代理值，不是源数据；
 *   `sectionNo === 1` 时无前一段，两字段为 `null`。
 *
 * 注意：Fever 时段**不在谱面里**。llll 的 `{Notes, Bpms}` 没有分段字段，
 * 分段来自歌曲主数据 FeverSectionNo + musicscore CSV 的分段事件。
 *
 * 用法：
 *   node scripts/gen-fever-metadata.mjs [4L 根目录]
 */
import fs from 'node:fs'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dirname, '..')
const fourL = process.argv[2] ?? process.env.FOUR_L_ROOT ?? ''
if (!fourL) {
  throw new Error(
    '需要 4L 根目录：node scripts/gen-fever-metadata.mjs <4L 根目录>，或设置 FOUR_L_ROOT',
  )
}
const plainDir = path.join(fourL, 'cache/plain')
const songListFile = path.join(projectRoot, 'docs/song-list.json')
const outputFile = path.join(projectRoot, 'src/llll/feverMetadata.json')

/** 解析一首歌的 Fever 窗口；与 apps/llll-preview 同口径。 */
function feverFromMusicScore(csv, sectionNo) {
  if (!Number.isInteger(sectionNo) || sectionNo < 1 || sectionNo > 5) {
    throw new Error(`FeverSectionNo 必须为 1～5，实为 ${sectionNo}`)
  }
  const rows = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','))
  const header = rows.shift() ?? []
  const timeColumn = header.indexOf('song_time')
  const typeColumn = header.indexOf('key_type')
  if (timeColumn < 0 || typeColumn < 0) {
    throw new Error('CSV 缺少 song_time / key_type 列')
  }
  const boundaries = rows
    .filter((row) => row[typeColumn]?.trim() === '20')
    .map((row) => {
      const value = row[timeColumn]?.trim()
      return value ? Number(value) : Number.NaN
    })
    .sort((a, b) => a - b)
  if (
    boundaries.length !== 4 ||
    boundaries.some((t, i) => !Number.isFinite(t) || t <= (i ? boundaries[i - 1] : 0))
  ) {
    throw new Error(`CSV 必须包含四个严格递增的分段边界，实为 ${boundaries.length} 个`)
  }
  // 客户端取 CSV 原始顺序中的最后一个 MusicEnd，不取最大时间。
  const endText = rows
    .filter((row) => row[typeColumn]?.trim() === '99')
    .at(-1)?.[timeColumn]
    ?.trim()
  const musicEnd = endText ? Number(endText) : Number.NaN
  if (sectionNo === 5 && (!Number.isFinite(musicEnd) || musicEnd <= boundaries[3])) {
    throw new Error('第五段需要晚于末段起点的 MusicEnd（key_type=99）')
  }
  const times = [0, ...boundaries, musicEnd]
  const start = times[sectionNo - 1] / 1000
  const end = times[sectionNo] / 1000
  // FeverChance 是**代理值**，不是 llll 源数据：llll 没有 chance 概念
  // （key_type 只有 1/10/20/99）。这里取「Fever 段之前那一段」，
  // 即同一个 times 数组里的前一段 [times[n-2], times[n-1])。
  // sectionNo === 1 时没有前一段，两个字段为 null。
  const chanceStart = sectionNo >= 2 ? times[sectionNo - 2] / 1000 : null
  const chanceEnd = sectionNo >= 2 ? times[sectionNo - 1] / 1000 : null
  return { start, end, chanceStart, chanceEnd }
}

const songList = JSON.parse(fs.readFileSync(songListFile, 'utf8'))
const index = {}
const missing = []
const sectionCounts = {}

for (const song of songList.songs) {
  const id = String(song.id)
  const csvPath = path.join(plainDir, `musicscore_${id}.csv`)
  if (!fs.existsSync(csvPath)) {
    missing.push(id)
    continue
  }
  const sectionNo = Number(song.feverSectionNo ?? 0)
  sectionCounts[sectionNo] = (sectionCounts[sectionNo] ?? 0) + 1
  if (index[id]) {
    throw new Error(`重复曲目 Id：${id}`)
  }
  try {
    index[id] = feverFromMusicScore(fs.readFileSync(csvPath, 'utf8'), sectionNo)
  } catch (error) {
    throw new Error(`曲目 ${id}：${String(error)}`)
  }
}

// 键按曲目 Id 排序，保证重复生成结果稳定。
const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => Number(a) - Number(b)))
fs.writeFileSync(outputFile, `${JSON.stringify(sorted, null, 2)}\n`)

console.log(
  JSON.stringify(
    {
      songs: Object.keys(sorted).length,
      missingCsv: missing.length,
      feverSectionNo: sectionCounts,
      output: path.relative(projectRoot, outputFile).replace(/\\/g, '/'),
    },
    null,
    2,
  ),
)
