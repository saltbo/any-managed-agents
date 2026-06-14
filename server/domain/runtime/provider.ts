// Pure provider business rules for the session runtime: provider-id
// canonicalization, the session provider config shape, the session
// provider+model resolution, and the runtime env contract. Reading the repo to
// resolve a provider config stays in the deps-first provisioning usecase; only
// the pure shaping lives here.

import { providerFamily } from '../provider-adapter'

export function isWorkersAiProvider(provider: string): boolean {
  return provider === 'workers-ai' || provider === 'cloudflare-workers-ai'
}

export function canonicalProvider(provider: string): string {
  return provider === 'workers-ai' ? 'cloudflare-workers-ai' : provider
}

export const PLATFORM_DEFAULT_PROVIDER = 'workers-ai'

// Shapes the agent snapshot a runtime turn runs against: drop the sandboxPolicy
// (the runtime gates sandbox operations itself, the snapshot must not re-assert
// it) and normalize skills to an array. Parses the persisted JSON column.
export function parseRuntimeAgentSnapshot(value: string | null) {
  const snapshot = value ? (JSON.parse(value) as Record<string, unknown>) : {}
  const { sandboxPolicy: _sandboxPolicy, ...runtimeSnapshot } = snapshot
  return {
    ...runtimeSnapshot,
    skills: Array.isArray(snapshot.skills) ? snapshot.skills : [],
  }
}

export type SessionProviderConfig = {
  id: string
  type: string
  baseUrl: string | null
  credentialId: string | null
  credentialVersionId: string | null
}

export type SessionProviderResolution =
  | { ok: true; config: SessionProviderConfig | null }
  | { ok: false; reason: 'not_found' | 'unavailable' }

// Maps a configured provider row into a session provider resolution: a disabled
// provider is unavailable; an enabled one yields its connection config.
export function providerConfigFromRow(row: {
  id: string
  type: string
  baseUrl: string | null
  enabled: boolean
  credentialId: string | null
  credentialVersionId: string | null
}): SessionProviderResolution {
  if (!row.enabled) {
    return { ok: false, reason: 'unavailable' }
  }
  return {
    ok: true,
    config: {
      id: row.id,
      type: row.type,
      baseUrl: row.baseUrl,
      credentialId: row.credentialId,
      credentialVersionId: row.credentialVersionId,
    },
  }
}

const FAMILY_CREDENTIAL_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  'openai-compatible': 'OPENAI_API_KEY',
  ollama: 'OLLAMA_API_KEY',
}

const FAMILY_BASE_URL_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_BASE_URL',
  openai: 'OPENAI_BASE_URL',
  'openai-compatible': 'OPENAI_BASE_URL',
  ollama: 'OLLAMA_HOST',
}

// A runtime secret-env entry: a vault credential reference resolved to a raw
// value only at runtime dispatch. Structurally matches the gateway adapter's
// RuntimeSecretEnvEntry and the port's CloudTurnSecretEnvEntry.
export interface ProviderSecretEnvEntry {
  name: string
  credentialRef: { credentialId: string; versionId?: string }
}

// Translates a configured provider into the runtime env contract consumed by
// session runtimes: the base URL as a plain env var, and the credential as a
// secret env credential reference that the lease/cloud dispatch seam resolves
// at materialization time. Workers AI runs on the platform binding and
// contributes nothing.
export function providerRuntimeEnv(config: SessionProviderConfig | null): {
  env: Record<string, string>
  secretEnv: ProviderSecretEnvEntry[]
} {
  if (!config || providerFamily(config.type) === 'workers-ai') {
    return { env: {}, secretEnv: [] }
  }
  const family = providerFamily(config.type)
  const env: Record<string, string> = {}
  const baseUrlEnv = FAMILY_BASE_URL_ENV[family]
  if (config.baseUrl && baseUrlEnv) {
    env[baseUrlEnv] = config.baseUrl
  }
  const secretEnv: ProviderSecretEnvEntry[] = []
  const credentialEnv = FAMILY_CREDENTIAL_ENV[family]
  if (config.credentialId && credentialEnv) {
    secretEnv.push({
      name: credentialEnv,
      credentialRef: {
        credentialId: config.credentialId,
        ...(config.credentialVersionId ? { versionId: config.credentialVersionId } : {}),
      },
    })
  }
  return { env, secretEnv }
}

// Single source for the session's runtime provider + model. The session's pinned
// modelProvider wins; otherwise the agent snapshot's providerId (falling back to
// the platform default). The model prefers the session modelConfig, then the
// agent snapshot, else null (the engine resolves the provider default).
export function resolveSessionProviderModel(
  session: { modelProvider: string | null },
  agentSnapshot: Record<string, unknown>,
  modelConfig: Record<string, unknown>,
): { provider: string; model: string | null } {
  const provider =
    session.modelProvider ?? (typeof agentSnapshot.providerId === 'string' ? agentSnapshot.providerId : 'workers-ai')
  const model =
    typeof modelConfig.model === 'string'
      ? modelConfig.model
      : typeof agentSnapshot.model === 'string'
        ? agentSnapshot.model
        : null
  return { provider, model }
}
