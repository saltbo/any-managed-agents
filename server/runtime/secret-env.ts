import { and, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { vaultCredentialVersions } from '../db/schema'
import type { Env } from '../env'
import { decryptSecretValue } from '../vaultCrypto'

type Db = ReturnType<typeof drizzle>

export type RuntimeSecretEnvItem = { name?: unknown; ref?: unknown }

// Resolves vault credential-version refs into plain env values. Both dispatch
// paths use this: self-hosted lease materialization and cloud session startup.
export async function resolveRuntimeSecretEnv(
  env: Env,
  db: Db,
  scope: { organizationId: string; projectId: string },
  items: unknown,
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  if (!Array.isArray(items)) {
    return resolved
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const { name, ref } = item as RuntimeSecretEnvItem
    if (typeof name !== 'string' || typeof ref !== 'string') {
      continue
    }
    const version = await db
      .select({
        metadata: vaultCredentialVersions.metadata,
        externalVaultPath: vaultCredentialVersions.externalVaultPath,
      })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, ref),
          eq(vaultCredentialVersions.organizationId, scope.organizationId),
          or(eq(vaultCredentialVersions.projectId, scope.projectId), isNull(vaultCredentialVersions.projectId)),
          eq(vaultCredentialVersions.status, 'active'),
        ),
      )
      .get()
    if (version?.externalVaultPath) {
      // External-vault credentials stay references: the runtime resolves them
      // through its approved vault binding, so the control plane never holds
      // the raw value and must not fail the dispatch.
      continue
    }
    const metadata = version ? parseMetadata(version.metadata) : null
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value === 'string') {
      resolved[name] = value
      continue
    }
    const legacyValue = metadata?.localSecretValue
    if (typeof legacyValue === 'string') {
      resolved[name] = legacyValue
      continue
    }
    throw new Error(`Runtime secret ${ref} cannot be resolved`)
  }
  return resolved
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
