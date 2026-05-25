import { defineConfig } from '@playwright/test'

const recordSensitiveArtifacts = process.env.AMA_E2E_RECORD_ARTIFACTS === '1'

export default defineConfig({
  testDir: './test/e2e',
  testMatch: /production-regression\.spec\.ts/,
  timeout: 1_500_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    baseURL: process.env.AMA_ORIGIN ?? 'https://ama.tftt.cc',
    trace: recordSensitiveArtifacts ? 'retain-on-failure' : 'off',
    video: recordSensitiveArtifacts ? 'retain-on-failure' : 'off',
  },
})
