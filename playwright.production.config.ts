import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /production-regression\.spec\.ts/,
  timeout: 1_500_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.AMA_ORIGIN ?? 'https://ama.tftt.cc',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
