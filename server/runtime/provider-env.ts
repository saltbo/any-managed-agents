import { createRuntimeOrchestrationRepo } from '../adapters/repos/runtime-orchestration'
import {
  PLATFORM_DEFAULT_PROVIDER,
  providerConfigFromRow,
  providerRuntimeEnv as providerRuntimeEnvRule,
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
    return providerConfigFromRow(row)
  }
  const row = await repo.namedProviderConfig(projectId, providerId)
  if (!row) {
    return { ok: false, reason: 'not_found' }
  }
  return providerConfigFromRow(row)
}

// Translates a configured provider into the runtime env contract. The pure rule
// lives in domain/runtime/provider; this re-export keeps the import path stable.
export function providerRuntimeEnv(config: SessionProviderConfig | null): {
  env: Record<string, string>
  secretEnv: RuntimeSecretEnvEntry[]
} {
  return providerRuntimeEnvRule(config)
}
