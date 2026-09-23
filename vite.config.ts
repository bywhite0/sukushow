import { defineConfig } from 'vite'

// PWA 留给后续阶段（需要 sw.ts 与图标资源）。阶段 2/3 只需能跑起渲染与测试。
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
