import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/*.test.ts'] },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ['three'] } },
    },
  },
});
