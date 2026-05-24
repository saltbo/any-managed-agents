import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
