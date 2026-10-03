import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5170,
    fs: { allow: [resolve(process.cwd(), '../..')] },
  },
});
