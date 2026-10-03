import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'llll × PJSK 渲染预览',
        short_name: 'llll Preview',
        description: 'Link! Like! 原生谱面 · PJSK 渲染管线 · 60 轨',
        theme_color: '#0b1930',
        background_color: '#081018',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        maximumFileSizeToCacheInBytes: 80 * 1024 * 1024,
        globIgnores: [
          '**/.DS_Store',
          '**/pwa/icon-source.png',
          // 贴图与 wasm 体积大、且已由 sw.ts 里的静态运行时缓存单独处理。
          '**/assets/mmw/**',
          '**/assets/*.wasm',
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg,gif,json,mp3,mp4,wasm,txt,woff,woff2}'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
