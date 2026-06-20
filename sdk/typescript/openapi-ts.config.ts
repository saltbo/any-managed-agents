import { defineConfig } from '@hey-api/openapi-ts'

// The canonical OpenAPI snapshot lives one level up at sdk/openapi.json and is
// regenerated from the Hono routes by `pnpm run openapi:generate`.
export default defineConfig({
  input: { path: '../openapi.json' },
  output: { path: './src/generated', clean: true, importFileExtension: '.js' },
  plugins: ['@hey-api/client-fetch', '@hey-api/typescript', '@hey-api/sdk'],
})
