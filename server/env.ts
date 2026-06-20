import type { Sandbox } from '@cloudflare/sandbox'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  OIDC_PROVIDER?: Fetcher
  SANDBOX: DurableObjectNamespace<Sandbox>
  // The per-session Session DO (idFromName(sessionId)): self-hosted runner
  // bridge today; cloud event store + browser WebSocket hub as it evolves.
  SESSION: DurableObjectNamespace
  // Cloud session turn queue; absent in test mode where turns run inline.
  CLOUD_TURNS?: Queue<unknown>
  AMA_DEFAULT_MODEL?: string
  AMA_RUNTIME_MODE?: string
  AMA_WORKERS_AI_ACCOUNT_ID?: string
  AMA_WORKERS_AI_API_KEY?: string
  AMA_WORKERS_AI_API_TOKEN?: string
  AMA_RUNTIME_AI_PROXY_TOKEN?: string
  AMA_RUNTIME_AI_PROXY_BASE_URL?: string
  AMA_CLOUDFLARE_API_TOKEN?: string
  AMA_CLOUDFLARE_SECRETS_STORE_ID?: string
  AMA_LOCAL_SECRET_STORE?: string
  AMA_SESSION_SECRET?: string
  AMA_VAULT_ENCRYPTION_KEY?: string
  AMA_APPROVED_EXTERNAL_VAULT_PREFIXES?: string
  // AI Gateway name for third-party ({vendor}/{model}) cloud models (Unified
  // Billing / BYOK); defaults to 'ama'. '@cf/' models stay gateway-free.
  AMA_AI_GATEWAY_ID?: string
  OIDC_ISSUER?: string
  OIDC_CLIENT_ID?: string
  OIDC_CLIENT_SECRET?: string
  OIDC_INTROSPECTION_CLIENT_ID?: string
  OIDC_INTROSPECTION_CLIENT_SECRET?: string
  OIDC_RUNNER_CLIENT_ID?: string
  OIDC_RUNNER_SCOPES?: string
  OIDC_USE_SERVICE_BINDING?: string
  AMA_ALLOWED_ORIGINS?: string
  AMA_E2E_TEST_AUTH?: string
  [key: string]: unknown
}
