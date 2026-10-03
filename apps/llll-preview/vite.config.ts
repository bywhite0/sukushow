import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5174 },
  test: { include: ['tests/*.test.ts'] },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
