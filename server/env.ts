import type { ManagedAgent } from './agents/managed-agent'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  MANAGED_AGENT: DurableObjectNamespace<ManagedAgent>
  AMA_DEFAULT_MODEL?: string
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
