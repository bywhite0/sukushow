/**
 * Service Worker（`vite-plugin-pwa` 的 injectManifest 策略）。
 *
 * 三类缓存，与设置页的统计分组一一对应：
 * - 预缓存：应用外壳、两种渲染模式的代码、wasm 与曲目列表（`vite.config.ts` 的 globPatterns）。
 * - 渲染资源：贴图 / 字体 / 短音效按使用情况写入 `sukushow-renderer-assets-v1`。
 * - 歌曲资源：音频 / MV / 谱面 / 曲绘，各自一个缓存。默认不缓存；只有对应类型的
 *   缓存存在时（设置页开关开启）才写入，缓存本身的存在与否就是该类型的开关状态。
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

import { RENDERER_CACHE_NAME, songCacheNameOf } from './cacheSettings'

type PrecacheEntry = { url: string; revision: string | null }
/** 只声明用到的成员，避免在 DOM 类型环境里引入 webworker 全局冲突。 */
type ServiceWorkerScope = {
  __WB_MANIFEST: Array<PrecacheEntry | string>
  location: Location
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  addEventListener: (type: string, listener: (event: unknown) => void) => void
}

declare const self: ServiceWorkerScope

clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// 单页应用的导航请求回落到预缓存的 index.html。
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  allowlist: [/^\/(?:index\.html)?(?:\?.*)?$/],
}))

// 提示更新的流程由 registerSW 驱动：等待中的 Service Worker 收到消息后才接管。
self.addEventListener('message', (event) => {
  if ((event as MessageEvent).data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

registerRoute(
  ({ url }) => url.origin === self.location.origin && (
    /^\/(?:rg|se|assets\/mmw)\//.test(url.pathname)
    || /^\/(?:in_game_difficulty_bg_101|sc2_ingame_bg_pattern_dot)\.png$/.test(url.pathname)
  ),
  new NetworkFirst({
    cacheName: RENDERER_CACHE_NAME,
    networkTimeoutSeconds: 5,
    // 同一张贴图会带 / 不带 Origin 头各加载一次，字节不变；两条路径都要能离线命中。
    matchOptions: { ignoreVary: true },
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 768, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
    ],
  }),
)

const SONG_HANDLERS = new Map<string, CacheFirst>()

/** 每类歌曲资源各自持有 CacheFirst 实例，过期清理状态不会互相干扰。 */
function songHandler(cacheName: string): CacheFirst {
  let handler = SONG_HANDLERS.get(cacheName)
  if (!handler) {
    handler = new CacheFirst({
      cacheName,
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        new ExpirationPlugin({ maxEntries: 512, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true }),
      ],
    })
    SONG_HANDLERS.set(cacheName, handler)
  }
  return handler
}

registerRoute(
  ({ url, request }) => url.origin === self.location.origin
    && songCacheNameOf(url.pathname) !== null
    // 带 Range 的请求（原生播放器的分块读取）按整段缓存会破坏播放，直接放行。
    && !request.headers.has('range'),
  async ({ request, event }) => {
    const cacheName = songCacheNameOf(new URL(request.url).pathname)
    if (!cacheName || !(await caches.has(cacheName))) return fetch(request)
    return songHandler(cacheName).handle({ request, event })
  },
)
