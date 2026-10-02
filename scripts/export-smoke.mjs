#!/usr/bin/env node
/**
 * 视频导出冒烟检查：用 Playwright 打开预览页，通过导出对话框导出一小段，
 * 再用 ffprobe 校验时长 / 分辨率 / 帧率 / 音轨，并用 ffmpeg 抽几帧 PNG。
 * 移植自 llll-pjsk-preview（scripts/export-smoke.mjs）。
 *
 * 用法（先 `pnpm dev --port 5179` 起开发服务器；需要本地 assets，见 scripts/link-assets.py）：
 *   node scripts/export-smoke.mjs --song 103119 --difficulty MASTER \
 *     --start 20 --duration 3 --res 720p --fps 30 --container mp4 --intro off --frames 0.5,1.5,2.5 --live-at 21.5 --out test-results/export-smoke
 *
 * 环境变量：
 *   PLAYWRIGHT_FROM  解析 @playwright/test 用的 package.json 路径（默认本仓库）
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
// --song / --difficulty / --base 拼出地址（Windows 上经 cmd 转发时 URL 里的 & 会被截断）。
const url = args.url ?? `${args.base ?? 'http://127.0.0.1:5179'}/?song=${encodeURIComponent(args.song ?? '103119')}&difficulty=${encodeURIComponent(args.difficulty ?? 'MASTER')}`
const start = Number(args.start ?? 20)
const duration = Number(args.duration ?? 3)
const res = args.res ?? '720p'
const fps = Number(args.fps ?? 30)
const container = args.container ?? 'mp4'
const intro = args.intro !== undefined ? args.intro !== 'off' : null
const outDir = resolve(args.out ?? 'test-results/export-smoke')
const frameTimes = (args.frames ?? '').split(',').filter(Boolean).map(Number)
const liveAt = args['live-at'] !== undefined ? Number(args['live-at']) : null
const ffprobe = process.env.FFPROBE ?? 'ffprobe'
const ffmpeg = process.env.FFMPEG ?? 'ffmpeg'

const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url)
const { chromium } = (() => {
  try {
    return require('@playwright/test')
  } catch {
    return require('playwright')
  }
})()

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
    const hook = window.__LPW__
    const text = document.querySelector('#message')?.textContent ?? ''
    return Boolean(hook?.player && hook?.renderer) && /已加载|就绪/.test(text) && !/正在加载/.test(text)
  }, null, { timeout: 90_000 })
  await page.waitForTimeout(1500)
  console.log('loaded; probing encoder support')

  const support = await page.evaluate(() => window.__LPW__.probeExportConfigs())
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
  if (intro !== null) await dialog.locator('[name="opening"]').setChecked(intro)
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
    // 实时预览对照：从 liveAt − 1.5 s 播放到 liveAt 附近暂停，截舞台合成画布。
    await page.locator('#timeline').evaluate((e, t) => { e.value = String(t); e.dispatchEvent(new Event('input')) }, liveAt - 1.5)
    await page.click('#play')
    await page.waitForFunction((t) => window.__LPW__.player.transport.time >= t, liveAt, { timeout: 20_000, polling: 'raf' })
    await page.click('#play')
    const actual = await page.evaluate(() => window.__LPW__.player.transport.time)
    await page.waitForTimeout(300)
    await page.locator('#stage-canvas').screenshot({ path: join(outDir, 'live.png') })
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
  const expectedSize = ({ '720p': '1280x720', '1080p': '1920x1080', '2160p': '3840x2160' })[res] ?? res
  const checks = {
    duration: Math.abs(Number(info.format.duration) - duration) < 0.1,
    resolution: `${video.width}x${video.height}` === expectedSize,
    fps: Math.abs(num / den - fps) < 0.01,
    audio: Boolean(audio) && audio.sample_rate === '48000' && audio.channels === 2,
    codecs: video.codec_name === (container === 'mp4' ? 'h264' : 'vp9') && ['aac', 'opus'].includes(audio?.codec_name),
    pageErrors: errors.length === 0,
  }
  console.log('checks:', JSON.stringify(checks))
  failed = !Object.values(checks).every(Boolean)

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
