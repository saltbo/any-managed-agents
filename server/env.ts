import type { Sandbox } from '@cloudflare/sandbox'
import type { ManagedAgent } from './agents/managed-agent'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  MANAGED_AGENT: DurableObjectNamespace<ManagedAgent>
  SANDBOX: DurableObjectNamespace<Sandbox>
  AMA_DEFAULT_MODEL?: string
  AMA_RUNTIME_MODE?: string
  AMA_PI_BRIDGE_COMMAND?: string
  AMA_PI_BRIDGE_PORT?: string
  AMA_WORKERS_AI_ACCOUNT_ID?: string
  AMA_WORKERS_AI_API_KEY?: string
  AMA_WORKERS_AI_API_TOKEN?: string
  AMA_AI_GATEWAY_ID?: string
  FLAREAUTH_ISSUER?: string
  FLAREAUTH_CLIENT_ID?: string
  FLAREAUTH_CLIENT_SECRET?: string
  FLAREAUTH_REDIRECT_URI?: string
  AMA_SESSION_SECRET?: string
  AMA_COOKIE_SECURE?: string
  AMA_COOKIE_SAME_SITE?: string
  AMA_ALLOWED_ORIGINS?: string
  [key: string]: unknown
}
