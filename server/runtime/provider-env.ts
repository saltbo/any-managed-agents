import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import { providerFamily } from '../domain/provider-adapter'
import {
  PLATFORM_DEFAULT_PROVIDER,
  type SessionProviderConfig,
  type SessionProviderResolution,
} from '../domain/runtime/provider'
import type { RuntimeSecretEnvEntry } from './secret-env'
import type { Db } from './session-base'

export {
  PLATFORM_DEFAULT_PROVIDER,
  type SessionProviderConfig,
  type SessionProviderResolution,
} from '../domain/runtime/provider'

function sessionProviderConfig(row: {
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

// Resolves the agent's provider reference to its configured connection
// details. A null provider id means "use the project default provider"; a
// project without a configured default falls back to the platform Workers AI
// binding, which needs no configuration row.
export async function resolveSessionProviderConfig(
  db: Db,
  projectId: string,
  providerId: string | null,
): Promise<SessionProviderResolution> {
  if (providerId === PLATFORM_DEFAULT_PROVIDER) {
    return { ok: true, config: null }
  }
  const repo = createRuntimeOrchestrationRepo(db)
  if (providerId === null) {
    const row = await repo.defaultProviderConfig(projectId)
    if (!row) {
      return { ok: true, config: null }
    }
    return sessionProviderConfig(row)
  }
  const row = await repo.namedProviderConfig(projectId, providerId)
  if (!row) {
    return { ok: false, reason: 'not_found' }
  }
  return sessionProviderConfig(row)
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

// Translates a configured provider into the runtime env contract consumed by
// session runtimes: the base URL as a plain env var, and the credential as a
// secret env credential reference that the lease/cloud dispatch seam resolves
// at materialization time. Workers AI runs on the platform binding and
// contributes nothing.
export function providerRuntimeEnv(config: SessionProviderConfig | null): {
  env: Record<string, string>
  secretEnv: RuntimeSecretEnvEntry[]
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
  const secretEnv: RuntimeSecretEnvEntry[] = []
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
