#!/usr/bin/env node
/**
 * 视频导出冒烟检查：用 Playwright 打开预览页，通过导出对话框导出一小段，
 * 再用 ffprobe 校验时长 / 分辨率 / 帧率 / 音轨，并用 ffmpeg 抽几帧 PNG。
 *
 * 用法（先在仓库根目录 `pnpm dev --port 5179` 起开发服务器）：
 *   node scripts/export-smoke.mjs --url "http://127.0.0.1:5179/?view=pjsk&song=405131&difficulty=EXPERT" \
 *     --start 20 --duration 3 --res 720p --fps 30 --container mp4 --frames 0.5,1.5,2.5 --live-at 21.5 --out ./export-smoke
 *
 * 环境变量：
 *   PLAYWRIGHT_FROM  含 playwright 依赖的 package.json 路径（本仓库不直接依赖 playwright）
 *   FFPROBE / FFMPEG 可执行文件路径（默认取 PATH）
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1]?.startsWith('--') ? 'true' : all[index + 1] ?? 'true'])
    return pairs
  }, []),
)
const url = args.url ?? 'http://127.0.0.1:5179/?view=pjsk&song=405131&difficulty=EXPERT'
const start = Number(args.start ?? 20)
const duration = Number(args.duration ?? 3)
const res = args.res ?? '720p'
const fps = Number(args.fps ?? 30)
const container = args.container ?? 'mp4'
const outDir = resolve(args.out ?? 'export-smoke')
const frameTimes = (args.frames ?? '').split(',').filter(Boolean).map(Number)
const liveAt = args['live-at'] !== undefined ? Number(args['live-at']) : null
const ffprobe = process.env.FFPROBE ?? 'ffprobe'
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url)
const { chromium } = require('playwright')

mkdirSync(outDir, { recursive: true })
const guard = setTimeout(() => {
  console.error('timeout')
  process.exit(2)
}, Number(args.timeout ?? 240) * 1000)

const browser = await chromium.launch({
  channel: args.channel,
  args: ['--autoplay-policy=no-user-gesture-required', ...(args.gpu ? [] : ['--disable-gpu'])],
})
let failed = false
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()))
  console.log('open:', url)
  await page.goto(url)
  await page.waitForFunction(() => {
    const hook = window.__LLL_PJSK__
    try {
      const snapshot = hook.player.getStateSnapshot()
      return Boolean(hook.getChart()) && snapshot.chartEndSec > 0
    } catch {
      return false
    }
  }, null, { timeout: 90_000 })
  await page.waitForTimeout(1500)
  console.log('loaded; probing encoder support')

  const support = await page.evaluate(() => window.__LLL_PJSK__.probeExportConfigs())
  writeFileSync(join(outDir, 'support.json'), JSON.stringify(support, null, 2))
  console.log('audio:', JSON.stringify(support.audio))
  for (const row of support.video) {
    console.log(`${row.supported ? 'OK ' : 'NO '} ${row.container} ${row.resolution} ${row.fps}fps ${row.bitrateMbps}Mbps ${row.codec}`)
  }

  await page.click('#export-video')
  const dialog = page.locator('#export-dialog')
  await dialog.locator('[name="container"]').selectOption(container)
  await dialog.locator('[name="resolution"]').selectOption(res)
  await dialog.locator('[name="fps"]').selectOption(String(fps))
  await dialog.locator('[name="start"]').fill(String(start))
  await dialog.locator('[name="end"]').fill(String(start + duration))
  await page.waitForTimeout(500)
  console.log('support line:', await dialog.locator('[data-support]').textContent())
  await dialog.locator('[data-start]').click()
  console.log('exporting…')
  await dialog.locator('[data-download]').waitFor({ state: 'visible', timeout: Number(args.timeout ?? 240) * 1000 })
  console.log('result:', await dialog.locator('[data-progress-text]').textContent())
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.locator('[data-download]').click()])
  const file = join(outDir, `export.${container}`)
  await download.saveAs(file)
  console.log('saved:', file)

  if (liveAt !== null) {
    await dialog.locator('[data-close]').click()
    await page.evaluate((t) => window.__LLL_PJSK__.player.seek(t), liveAt - 1.5)
    await page.click('#play')
    await page.waitForFunction((t) => window.__LLL_PJSK__.player.getStateSnapshot().currentTimeSec >= t, liveAt, { timeout: 20_000, polling: 'raf' })
    const actual = await page.evaluate(() => {
      const hook = window.__LLL_PJSK__
      hook.player.pause()
      return hook.player.getStateSnapshot().currentTimeSec
    })
    await page.waitForTimeout(300)
    await page.locator('#chart-canvas').screenshot({ path: join(outDir, 'live.png') })
    console.log(`live frame at ${actual.toFixed(3)} s (clip offset ${(actual - start).toFixed(3)} s)`)
    frameTimes.push(Number((actual - start).toFixed(3)))
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 10))

  const probe = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=format_name,duration:stream=index,codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,nb_frames,sample_rate,channels',
    '-of', 'json', file,
  ], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr}`)
  console.log(probe.stdout)
  const info = JSON.parse(probe.stdout)
  const video = info.streams.find((stream) => stream.codec_type === 'video')
  const audio = info.streams.find((stream) => stream.codec_type === 'audio')
  const [num, den] = video.avg_frame_rate.split('/').map(Number)
  const checks = {
    duration: Math.abs(Number(info.format.duration) - duration) < 0.1,
    resolution: `${video.width}x${video.height}`,
    fps: Math.abs(num / den - fps) < 0.01,
    audio: Boolean(audio),
  }
  console.log('checks:', JSON.stringify(checks))
  failed = !(checks.duration && checks.fps && checks.audio)

  for (const [index, t] of frameTimes.entries()) {
    const png = join(outDir, `frame-${index + 1}-${t.toFixed(3)}s.png`)
    const run = spawnSync(ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', file, '-frames:v', '1', png], { encoding: 'utf8' })
    console.log(run.status === 0 ? `frame: ${png}` : `frame failed: ${run.stderr}`)
  }
} catch (error) {
  failed = true
  console.error(error)
} finally {
  clearTimeout(guard)
  await browser.close()
}
process.exit(failed ? 1 : 0)