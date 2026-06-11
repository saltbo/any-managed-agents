import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: [
            'src/**/*.test.ts',
            'src/**/*.test.tsx',
            'server/runtime/**/*.test.ts',
            'server/test/**/*.test.ts',
            'shared/**/*.test.ts',
            'runtime-bridge/src/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => {
            const migrationsPath = path.join(__dirname, './migrations')
            const migrations = await readD1Migrations(migrationsPath)

            return {
              wrangler: { configPath: './wrangler.test.toml' },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }
          }),
        ],
        test: {
          name: 'workers',
          include: ['server/routes/**/*.test.ts', 'workers/**/*.test.ts'],
          setupFiles: ['./server/test/apply-migrations.ts'],
        },
      },
    ],
  },
})
