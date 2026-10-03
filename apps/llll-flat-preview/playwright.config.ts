import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:5182', headless: true },
  webServer: {
    command: 'pnpm dev --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: !process.env.CI,
  },
});
