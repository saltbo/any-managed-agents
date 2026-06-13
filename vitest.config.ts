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
    // Coverage gates the layers the fast suites (unit + web) own; the workerd
    // integration pool can't be v8-instrumented, so http full-flow / repos /
    // composition / worker / auth-jwks / runtime execution are proven by the
    // integration + e2e suites and lint:arch, not a %. Business logic (domain +
    // usecases) must be provable here without the stack — gated at 95%.
    coverage: {
      provider: 'v8',
      include: [
        'server/domain/**',
        'server/usecases/**',
        'server/adapters/gateways/**',
        'shared/**',
        'src/features/**',
        'src/lib/**',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/index.ts',
        'src/lib/utils.ts',
        'src/lib/query-keys.ts',
      ],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        'server/domain/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'server/usecases/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
      },
      reporter: ['text', 'text-summary'],
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
            'server/*.test.ts',
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
          include: ['server/http/**/*.test.ts'],
          setupFiles: ['./server/test/apply-migrations.ts'],
        },
      },
    ],
  },
})
