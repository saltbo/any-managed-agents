import { and, eq } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { providerConfigs } from '../db/schema'
import { providerFamily } from '../providers/adapters'

type Db = ReturnType<typeof drizzle>

export const PLATFORM_DEFAULT_PROVIDER = 'workers-ai'

export type SessionProviderConfig = {
  id: string
  type: string
  baseUrl: string | null
  credentialSecretRef: string | null
}

export type SessionProviderResolution =
  | { ok: true; config: SessionProviderConfig | null }
  | { ok: false; reason: 'not_found' | 'unavailable' }

// Resolves the agent's provider id to its configured connection details.
// The bare platform default needs no configuration row; every other provider
// id must reference an active provider_configs row in the project.
export async function resolveSessionProviderConfig(
  db: Db,
  projectId: string,
  providerId: string,
): Promise<SessionProviderResolution> {
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return { ok: true, config: null }
  }
  const row = await db
    .select({
      id: providerConfigs.id,
      type: providerConfigs.type,
      baseUrl: providerConfigs.baseUrl,
      status: providerConfigs.status,
      credentialSecretRef: providerConfigs.credentialSecretRef,
    })
    .from(providerConfigs)
    .where(and(eq(providerConfigs.id, providerId), eq(providerConfigs.projectId, projectId)))
    .get()
  if (!row) {
    return { ok: false, reason: 'not_found' }
  }
  if (row.status !== 'active') {
    return { ok: false, reason: 'unavailable' }
  }
  return {
    ok: true,
    config: { id: row.id, type: row.type, baseUrl: row.baseUrl, credentialSecretRef: row.credentialSecretRef },
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

// Vault credential version refs are the only credential references the
// dispatch seam can materialize; other reference schemes stay inert metadata.
const VAULT_CREDENTIAL_VERSION_REF = /^vaultver_[A-Za-z0-9_]+$/

export function providerCredentialEnvName(providerType: string) {
  return FAMILY_CREDENTIAL_ENV[providerFamily(providerType)] ?? null
}

// Translates a configured provider into the runtime env contract consumed by
// session runtimes: the base URL as a plain env var, and the credential as a
// secret env ref that the lease/cloud dispatch seam resolves at materialization
// time. Workers AI runs on the platform binding and contributes nothing.
export function providerRuntimeEnv(config: SessionProviderConfig | null): {
  env: Record<string, string>
  secretEnv: Array<{ name: string; ref: string }>
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
  const secretEnv: Array<{ name: string; ref: string }> = []
  const credentialEnv = FAMILY_CREDENTIAL_ENV[family]
  if (config.credentialSecretRef && credentialEnv && VAULT_CREDENTIAL_VERSION_REF.test(config.credentialSecretRef)) {
    secretEnv.push({ name: credentialEnv, ref: config.credentialSecretRef })
  }
  return { env, secretEnv }
}
