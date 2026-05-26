import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

const appPort = Number(process.env.E2E_APP_PORT ?? 5173)
const cloudflareEnv = process.env.CLOUDFLARE_ENV

function wranglerVar(name: string) {
  const wrangler = readFileSync(path.resolve(__dirname, 'wrangler.toml'), 'utf8')
  const section = cloudflareEnv ? `[env.${cloudflareEnv}.vars]` : '[vars]'
  const sectionStart = wrangler.indexOf(section)
  const fallbackStart = wrangler.indexOf('[vars]')
  const start = sectionStart >= 0 ? sectionStart : fallbackStart
  if (start < 0) return undefined
  const rest = wrangler.slice(start + section.length)
  const nextSection = rest.search(/\n\[/)
  const body = nextSection >= 0 ? rest.slice(0, nextSection) : rest
  const match = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(body)
  return match?.[1]
}

export default defineConfig(() => ({
  define: {
    __AMA_OIDC_CONFIG__: JSON.stringify({
      authority: process.env.VITE_OIDC_ISSUER ?? process.env.OIDC_ISSUER ?? wranglerVar('OIDC_ISSUER'),
      clientId: process.env.VITE_OIDC_CLIENT_ID ?? process.env.OIDC_CLIENT_ID ?? wranglerVar('OIDC_CLIENT_ID'),
      scope: 'openid email profile',
    }),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: process.env.CLOUDFLARE_ENV !== 'e2e' })],
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
