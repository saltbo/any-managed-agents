import type { Sandbox } from '@cloudflare/sandbox'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  OIDC_PROVIDER?: Fetcher
  SANDBOX: DurableObjectNamespace<Sandbox>
  AMA_DEFAULT_MODEL?: string
  AMA_RUNTIME_MODE?: string
  AMA_PI_BRIDGE_COMMAND?: string
  AMA_PI_BRIDGE_PORT?: string
  AMA_WORKERS_AI_ACCOUNT_ID?: string
  AMA_WORKERS_AI_API_KEY?: string
  AMA_WORKERS_AI_API_TOKEN?: string
  AMA_RUNTIME_AI_PROXY_TOKEN?: string
  AMA_RUNTIME_AI_PROXY_BASE_URL?: string
  AMA_CLOUDFLARE_API_TOKEN?: string
  AMA_CLOUDFLARE_SECRETS_STORE_ID?: string
  AMA_APPROVED_EXTERNAL_VAULT_PREFIXES?: string
  AMA_AI_GATEWAY_ID?: string
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_USE_SERVICE_BINDING?: string
  AMA_ALLOWED_ORIGINS?: string
  AMA_E2E_TEST_AUTH?: string
  [key: string]: unknown
}
