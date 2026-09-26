/**
 * PJSK Fever 覆盖层的回归测试（真实 wasm + 真实渲染器，不是 mock）。
 *
 * 为什么用浏览器：Fever 覆盖层是 native 侧 ImGui 前景绘制，只有跑起真 wasm
 * 才有东西可量；单元测试碰不到它。
 *
 * 为什么不用「开/关差分」做主要判据：差分里混着**曲目 MV 与音符动画**（rAF 按
 * wall-clock 推进），差分高达数万像素、几乎全是场景自身，会把 Fever 淹掉。
 * 做法是把场景压黑（特效/舞台不透明度 0、背景亮度 0）—— 这三项不影响 HUD 与
 * Fever 覆盖层 —— 于是 ON/OFF 的差异只剩 Fever 本身。
 *
 * 判据取自客户端的 Fever 特效素材（fx_fever_frame / fx_fever_v2）：
 *   边框  左右竖条厚 11px（1920 基准）；顶/底中段为空（不是闭合矩形）；
 *         四角臂沿边衰减到 x≈205 归零；颜色白（饱和度 0.017）。
 *   紫光  从底部两角向中心收敛的窄斜带；t=0.05s 起、0.25–0.30s 主峰、
 *         0.40s 后收尽（内容长度 1.20s，不是容器 2.38s）。
 *
 * 两个实现上的坑，见 `measureState` 与 `shootDataUrl` 的注释：
 *   ① 截图偶发半合成帧（wasm 侧 GL 是 preserveDrawingBuffer=false）——
 *      半合成只会更暗，故同状态连拍数张逐像素取最大。
 *   ② 不要自己手写 PNG 解码器，也不要往返搬运全画幅像素数组（会超时）——
 *      在页面里用 `createImageBitmap` + `getImageData` 解码，并在页内把指标算完，
 *      只把几个小数字带回 Node。
 *
 * 前置：dev server 在 5199 上跑着。不在时整组跳过，避免无服务环境下报假红。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:5199/'
const SONG = '103103'
const OUT = 'node_modules/.cache/fever-shots'

/**
 * 找 playwright：优先环境变量，其次裸包名。
 * 不写死绝对路径 —— 本仓是公开仓，且路径随机器而变。
 * 需要时用 `PLAYWRIGHT_ENTRY` 指向安装位置，例如某个姊妹仓的 node_modules。
 */
async function loadPlaywright() {
  const specs = [
    process.env.PLAYWRIGHT_ENTRY,
    'playwright',
    'playwright-core',
  ].filter(Boolean) as string[]
  for (const spec of specs) {
    try {
      return await import(/* @vite-ignore */ spec)
    } catch {
      /* 继续找下一个 */
    }
  }
  return null
}

async function serverAlive() {
  try {
    const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

const alive = await serverAlive()
const pw = alive ? await loadPlaywright() : null
const canRun = Boolean(pw)

describe.skipIf(!canRun)('PJSK Fever 覆盖层（真实 wasm + 截图读数）', () => {
  it('边框＝左右竖条 + 四角臂、顶/底中段为空；紫光按素材时序出现', async () => {
    const { chromium } = pw as any
    fs.mkdirSync(OUT, { recursive: true })
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`${BASE}?song=${SONG}&difficulty=MASTER`, { waitUntil: 'load' })
    await page.waitForFunction(
      () => Boolean((window as any).__LLL_PJSK__?.player),
      null,
      { timeout: 90000 },
    )
    await page.waitForTimeout(15000)

    const fever = await page.evaluate(
      (id: string) =>
        fetch('/src/llll/feverMetadata.json')
          .then((r) => r.json())
          .then((j) => j[id] ?? null),
      SONG,
    )
    const lead = await page.evaluate(
      () => (window as any).__LLL_PJSK__.player.getStateSnapshot().effectiveLeadInSec,
    )
    expect(fever, `曲目 ${SONG} 应在 feverMetadata 里`).toBeTruthy()

    // 场景压黑：只留 HUD + Fever 覆盖层，差分才干净。
    await page.evaluate(() => {
      ;(window as any).__LLL_PJSK__.player.setPreviewConfig({
        mirror: 0, flickAnimation: 1, holdAnimation: 1, simultaneousLine: 1,
        effectProfile: 0, noteSkin: 0, noteSpeed: 1,
        holdAlpha: 0, guideAlpha: 0, stageCover: 0,
        stageOpacity: 0, backgroundBrightness: 0, effectOpacity: 0,
      })
    })

    /** 把一张截图交给页面解码，返回 dataURL（由页内解码，不经过 Node）。 */
    const shootDataUrl = async (local: number, display: boolean) => {
      await page.evaluate(
        ({ sec, display, s, e }: any) => {
          const p = (window as any).__LLL_PJSK__.player
          p.pause()
          p.setFeverWindow(s, e)
          p.setFeverDisplay(display)
          p.seek(sec)
          p.renderFrame()
        },
        { sec: fever.start + local + lead, display, s: fever.start, e: fever.end },
      )
      await page.waitForTimeout(360)
      const buf: Buffer = await page.locator('canvas').screenshot()
      return `data:image/png;base64,${buf.toString('base64')}`
    }

    /**
     * 在页面里解码多张 PNG、逐像素取最大合成一张，然后算出全部指标。
     * 返回的都是小数字/小数组，避免把整幅像素搬回 Node。
     */
    const measureState = (urls: string[]) =>
      page.evaluate(async (urls: string[]) => {
        const bitmaps = await Promise.all(
          urls.map(async (u) => createImageBitmap(await (await fetch(u)).blob())),
        )
        const w = bitmaps[0].width
        const h = bitmaps[0].height
        const cv = new OffscreenCanvas(w, h)
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        const layers: Uint8ClampedArray[] = []
        for (const b of bitmaps) {
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(b, 0, 0)
          layers.push(ctx.getImageData(0, 0, w, h).data)
        }
        // 逐像素取最大（半合成帧只会更暗）
        const px = new Uint8ClampedArray(layers[0].length)
        for (let i = 0; i < px.length; i++) {
          let m = 0
          for (const L of layers) if (L[i] > m) m = L[i]
          px[i] = m
        }
        const lum = (x: number, y: number) => {
          const i = (y * w + x) * 4
          return (px[i] + px[i + 1] + px[i + 2]) / 3
        }
        const midY = Math.floor(h / 2)
        // 竖条厚度：多行取最大
        let bar = 0
        for (let y = Math.floor(h * 0.25); y < h * 0.75; y += 2) {
          let n = 0
          for (let k = 0; k < 8; k++) if (lum(k, y) > 100) n++
          if (n > bar) bar = n
        }
        // 参考点：Fever 不覆盖、紫光也不经过
        let ref = 0
        let refN = 0
        for (let y = Math.floor(h * 0.3); y < h * 0.4; y++) {
          for (let x = Math.floor(w * 0.3); x < w * 0.4; x++) {
            ref += lum(x, y)
            refN++
          }
        }
        return {
          w,
          h,
          bar,
          left: lum(2, midY),
          right: lum(w - 3, midY),
          topMid: lum(Math.floor(w / 2), 2),
          botMid: lum(Math.floor(w / 2), h - 3),
          corner: lum(2, 2),
          ref: ref / refN,
        }
      }, urls)

    /** ON/OFF 的整幅像素（供差分用），同样在页内算差分，只回计数。 */
    const middleDiff = (onUrls: string[], offUrls: string[]) =>
      page.evaluate(
        async ({ onUrls, offUrls }: any) => {
          const load = async (u: string) =>
            createImageBitmap(await (await fetch(u)).blob())
          const [a, b] = await Promise.all([load(onUrls[0]), load(offUrls[0])])
          const w = a.width
          const h = a.height
          const cv = new OffscreenCanvas(w, h)
          const ctx = cv.getContext('2d', { willReadFrequently: true })!
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(a, 0, 0)
          const A = ctx.getImageData(0, 0, w, h).data
          ctx.clearRect(0, 0, w, h)
          ctx.drawImage(b, 0, 0)
          const B = ctx.getImageData(0, 0, w, h).data
          const m = 8
          let n = 0
          for (let y = m; y < h - m; y++) {
            for (let x = m; x < w - m; x++) {
              const i = (y * w + x) * 4
              const d =
                Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])
              if (d > 40) n++
            }
          }
          return n
        },
        { onUrls, offUrls },
      )

    const grabPair = async (local: number) => {
      const onUrls: string[] = []
      const offUrls: string[] = []
      for (let i = 0; i < 4; i++) {
        onUrls.push(await shootDataUrl(local, true))
        offUrls.push(await shootDataUrl(local, false))
      }
      return {
        on: await measureState(onUrls),
        off: await measureState(offUrls),
        middle: await middleDiff(onUrls, offUrls),
        onUrls,
      }
    }

    const settled = await grabPair(6.0)
    const peak = await grabPair(0.25)
    const before = await grabPair(0.02)
    await browser.close()

    // 留档便于人工复核
    for (const [name, r] of Object.entries({ settled, peak, before })) {
      const url = (r as any).onUrls[0] as string
      fs.writeFileSync(
        `${OUT}/${name}_on.png`,
        Buffer.from(url.split(',')[1], 'base64'),
      )
    }

    // ---- 边框：左右竖条存在且厚 ≈11px@1920（画布 834 宽 ⇒ 约 5px） ----
    expect(settled.on.bar, '左竖条应为实心（3–9px）').toBeGreaterThanOrEqual(3)
    expect(settled.on.bar, '左竖条不应过宽').toBeLessThanOrEqual(9)
    expect(settled.on.left, '左竖条应亮').toBeGreaterThan(150)
    expect(settled.on.right, '右竖条应亮').toBeGreaterThan(150)

    // ---- 边框：顶/底中段为空（开口框，不是闭合矩形） ----
    expect(settled.on.topMid, '顶中段不应有亮边框').toBeLessThan(100)
    expect(settled.on.botMid, '底中段不应有亮边框').toBeLessThan(100)

    // ---- 四角臂：角落应比关闭态亮 ----
    expect(settled.on.corner, '左上角应有臂').toBeGreaterThan(150)
    expect(settled.on.corner - settled.off.corner, '臂只应出现在 ON 态').toBeGreaterThan(80)

    // ---- 紫光：主峰存在；0.02s（素材未起）与稳定段都不该有 ----
    expect(peak.middle, '主峰应在非边缘区画出东西（紫光+文字）').toBeGreaterThan(5000)
    expect(settled.middle, '稳定段非边缘区应干净（只剩开口边框）').toBe(0)
    expect(before.middle, '0.02s 紫光未起（素材 0.05s 才出现）').toBeLessThan(
      peak.middle * 0.2,
    )
  }, 300000)
})
