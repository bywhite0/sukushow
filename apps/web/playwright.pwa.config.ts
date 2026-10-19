import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/pwa',
  outputDir: '../../output/playwright/pwa',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5189',
    headless: true,
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
})
