import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
    },
    projects: [
      {
        // unit (node): server business layers + shared + runtime bridge. The
        // cheapest suite — pure logic and fake-port use cases, no jsdom, no D1.
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'server/domain/**/*.test.ts',
            'server/usecases/**/*.test.ts',
            'server/adapters/**/*.test.ts',
            'server/auth/**/*.test.ts',
            'server/runtime/**/*.test.ts',
            'server/test/**/*.test.ts',
            'shared/**/*.test.ts',
            'runtime-bridge/src/**/*.test.ts',
          ],
        },
      },
      {
        // web (jsdom): the React SPA — client logic, hooks, components.
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        },
      },
      {
        // integration (workerd + real D1): the assembled server through app.fetch.
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
          name: 'integration',
          include: ['server/http/**/*.test.ts', 'workers/**/*.test.ts'],
          setupFiles: ['./server/test/apply-migrations.ts'],
        },
      },
    ],
  },
})
