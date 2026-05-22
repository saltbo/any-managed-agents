import type { ManagedAgent } from './agents/managed-agent'

export interface Env {
  DB: D1Database
  AI: Ai
  ASSETS: Fetcher
  MANAGED_AGENT: DurableObjectNamespace<ManagedAgent>
  AMA_DEFAULT_MODEL?: string
  [key: string]: unknown
}
