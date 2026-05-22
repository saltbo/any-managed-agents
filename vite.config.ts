import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const appPort = Number(process.env.E2E_APP_PORT ?? 5173)

export default defineConfig(() => ({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@server': path.resolve(__dirname, './server'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: appPort,
    ...(process.env.E2E_BASE_URL ? { allowedHosts: true as const } : {}),
  },
}))
