#!/usr/bin/env node
// Windows 长片验收：独立 Chromium 进程内存 + CDP 堆／Backing Storage；结果保存在本地。
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const exec = promisify(execFile)
const args = Object.fromEntries(process.argv.slice(2).reduce((out, token, index, all) => {
  if (token.startsWith('--')) out.push([token.slice(2), all[index + 1]])
  return out
}, []))
const out = resolve(args.out ?? 'test-results/export-memory')
const repeat = Number(args.repeat ?? 1)
const settleSec = Number(args.settle ?? 5)
if (!Number.isSafeInteger(repeat) || repeat < 1) throw new Error('--repeat 必须为正整数')
if (!Number.isFinite(settleSec) || settleSec < 0) throw new Error('--settle 必须为非负秒数')
mkdirSync(out, { recursive: true })
const report = { startedAt: new Date().toISOString(), settings: args, samples: [], runs: [], errors: [], result: null }
const save = () => writeFileSync(join(out, 'memory.json'), JSON.stringify(report, null, 2))
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const browserCdp = await browser.newBrowserCDPSession()
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true })
const cdp = await page.context().newCDPSession(page)
const started = Date.now()
let stopping = false
let interval
let pending = Promise.resolve()
let peak = 0
let baseline = 0
let run = 0

async function sample(label) {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo')
  const ids = processInfo.map((p) => p.id).join(',')
  const command = `$p=@(${ids}) | ForEach-Object { try { $x=Get-Process -Id $_ -ErrorAction Stop; @{ id=$x.Id; privateBytes=$x.PrivateMemorySize64; workingSetBytes=$x.WorkingSet64 } } catch {} }; $o=Get-CimInstance Win32_OperatingSystem; @{ processes=@($p); freeBytes=[long]$o.FreePhysicalMemory*1024 } | ConvertTo-Json -Compress -Depth 4`
  const { stdout } = await exec('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command])
  const os = JSON.parse(stdout)
  const privateBytes = os.processes.reduce((sum, p) => sum + p.privateBytes, 0)
  peak = Math.max(peak, privateBytes)
  const state = await page.evaluate(() => ({
    progress: document.querySelector('[data-progress-text]')?.textContent,
    locked: document.querySelector('.transport')?.inert,
    time: window.__LPW__?.player?.transport.time,
    exporting: document.querySelector('#stage-canvas')?.classList.contains('exporting'),
    downloadUrls: { active: window.__exportMemoryUrls.active.size, created: window.__exportMemoryUrls.created, revoked: window.__exportMemoryUrls.revoked },
  }))
  const entry = { run, label, wallSec: (Date.now() - started) / 1000, heap, privateBytes, ...os, ...state }
  report.samples.push(entry)
  save()
  if (!stopping && label === 'running' && (os.freeBytes < 1024 ** 3 || privateBytes - baseline > 3 * 1024 ** 3)) {
    stopping = true
    await page.locator('[data-cancel]').click()
    console.log('低内存停止条件已触发')
  }
  return entry
}

function startSampling() {
  interval = setInterval(() => {
    pending = pending.then(() => sample('running')).catch((e) => { report.errors.push(String(e)); save() })
  }, 2000)
}

async function stopSampling() {
  clearInterval(interval)
  await pending
}

async function settledGc(label) {
  await delay(settleSec * 1000)
  await cdp.send('HeapProfiler.collectGarbage')
  return sample(label)
}

async function restored() {
  return page.evaluate((initial) => (
    !document.querySelector('.transport').inert
    && !document.querySelector('#stage-canvas').classList.contains('exporting')
    && window.__LPW__.player.transport.time === initial.time
    && document.querySelector('#rate').value === initial.rate
  ), report.initialState)
}

try {
  page.on('pageerror', (e) => report.errors.push(e.message))
  // 只记录视频 URL 的计数，不保留 Blob；核验多次导出会撤销旧下载。
  await page.addInitScript(() => {
    const urls = window.__exportMemoryUrls = { active: new Set(), created: 0, revoked: 0 }
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      if (blob.type?.startsWith('video/')) { urls.active.add(url); urls.created++ }
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (urls.active.delete(url)) urls.revoked++
      return revoke(url)
    }
  })
  report.browser = await browser.version()
  await page.goto(`${args.base ?? 'http://127.0.0.1:5180'}/?song=${args.song ?? '103119'}&difficulty=MASTER`)
  await page.waitForFunction(() => /已加载/.test(document.querySelector('#message')?.textContent ?? ''))
  await page.waitForLoadState('networkidle')
  report.source = await page.evaluate(() => ({
    durationSec: window.__LPW__.player.transport.duration,
    bgmDurationSec: window.__LPW__.player.audioBuffer?.duration,
    bgmPcmBytes: window.__LPW__.player.audioBuffer ? window.__LPW__.player.audioBuffer.length * window.__LPW__.player.audioBuffer.numberOfChannels * 4 : 0,
  }))
  report.initialState = await page.evaluate(() => ({ time: window.__LPW__.player.transport.time, rate: document.querySelector('#rate').value }))
  await page.locator('#export-video').click()
  await page.locator('[name="resolution"]').selectOption(args.res ?? '1080p')
  await page.locator('[name="fps"]').selectOption(args.fps ?? '30')
  await page.locator('[name="opening"]').uncheck()
  await page.locator('[name="start"]').fill('0')
  const duration = args.duration ?? String(report.source.durationSec)
  await page.locator('[name="end"]').fill(duration)
  await page.waitForFunction(() => !document.querySelector('[data-start]').disabled)
  await cdp.send('HeapProfiler.collectGarbage')
  await sample('baseline-gc')
  baseline = report.samples.at(-1).privateBytes
  for (run = 1; run <= repeat && !stopping; run++) {
    await page.locator('[name="end"]').fill(duration)
    await page.waitForFunction(() => !document.querySelector('[data-start]').disabled)
    await cdp.send('HeapProfiler.collectGarbage')
    await sample('run-baseline-gc')
    await page.locator('[data-start]').click()
    startSampling()
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-progress-text]')?.textContent ?? ''
      return /完成：|导出失败：|已取消/.test(text)
    }, null, { timeout: Number(args.timeout ?? 1800) * 1000 })
    await stopSampling()
    const finished = await sample('finished')
    const result = { run, text: finished.progress, restored: await restored() }
    report.runs.push(result)
    save()
    if (stopping || !result.text.startsWith('完成：')) throw new Error(result.text)
    const download = page.waitForEvent('download')
    await page.locator('[data-download]').click()
    await (await download).saveAs(join(out, repeat === 1 ? 'export.mp4' : `export-${run}.mp4`))
    await cdp.send('HeapProfiler.collectGarbage')
    await sample('retained-download-gc')
    const retained = await settledGc('retained-download-settled-gc')
    if (retained.downloadUrls.active !== 1) throw new Error('下载 URL 数量不为 1')
    // 同一任务内开始并取消：走实际撤销路径，但不让新一轮画布／编码分配混入回收样本。
    await page.locator('[name="end"]').fill('1')
    await page.waitForFunction(() => !document.querySelector('[data-start]').disabled)
    await page.evaluate(() => {
      document.querySelector('[data-start]').click()
      document.querySelector('[data-cancel]').click()
    })
    await page.waitForFunction(() => /已取消/.test(document.querySelector('[data-progress-text]')?.textContent ?? ''))
    await cdp.send('HeapProfiler.collectGarbage')
    await sample('released-download-gc')
    const released = await settledGc('released-download-settled-gc')
    if (released.downloadUrls.active !== 0) throw new Error('旧下载 URL 未撤销')
    result.restored = result.restored && await restored()
    if (!result.restored) throw new Error('导出结束／取消后预览状态未恢复')
    console.log(JSON.stringify({ ...result, retainedPrivateMiB: retained.privateBytes / 2 ** 20, releasedPrivateMiB: released.privateBytes / 2 ** 20 }))
    save()
  }
  if (args['cancel-after-frames']) {
    await page.locator('[name="end"]').fill(String(report.source.durationSec))
    await page.waitForFunction(() => !document.querySelector('[data-start]').disabled)
    await page.locator('[data-start]').click()
    startSampling()
    await page.waitForFunction((frames) => {
      const match = document.querySelector('[data-progress-text]')?.textContent?.match(/^渲染编码 (\d+)\//)
      return match && Number(match[1]) >= frames
    }, Number(args['cancel-after-frames']), { timeout: 120_000 })
    await sample('before-active-cancel')
    await page.locator('[data-cancel]').click()
    await page.waitForFunction(() => /已取消/.test(document.querySelector('[data-progress-text]')?.textContent ?? ''), null, { timeout: 60_000 })
    await stopSampling()
    await settledGc('active-cancel-settled-gc')
    report.activeCancelRestored = await restored()
    if (!report.activeCancelRestored) throw new Error('渲染中取消后预览状态未恢复')
  }
  report.result = { completedRuns: report.runs.length, peakPrivateBytes: peak, peakIncreaseBytes: peak - baseline, safetyStopped: stopping, restored: report.runs.every((result) => result.restored) }
  report.finishedAt = new Date().toISOString()
  save()
  console.log(JSON.stringify(report.result, null, 2))
  console.log('报告：', join(out, 'memory.json'))
  if (stopping || report.errors.length || report.runs.length !== repeat || !report.result.restored) process.exitCode = 1
} catch (e) {
  report.errors.push(String(e)); save(); console.error(e); process.exitCode = 1
} finally {
  clearInterval(interval)
  await pending
  await browser.close()
}
