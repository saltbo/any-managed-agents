import { and, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { vaultCredentials, vaultCredentialVersions } from '../db/schema'
import type { Env } from '../env'
import { decryptSecretValue } from '../vaultCrypto'

type Db = ReturnType<typeof drizzle>

export type RuntimeSecretEnvItem = { name?: unknown; ref?: unknown }

// Resolves vault credential-version refs into the runtime secret env. Both
// dispatch paths use this seam: self-hosted lease materialization and cloud
// session startup. Resolution semantics per provider:
// - ama-managed and cloudflare-secrets versions decrypt the stored ciphertext.
// - external-vault versions pass the safe reference through; the runtime
//   resolves it via its approved vault binding, so the control plane never
//   holds the raw value.
// Resolved values exist only in the runtime dispatch; they are never written
// to D1, session events, audit records, or logs.
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
        status: vaultCredentialVersions.status,
        credentialStatus: vaultCredentials.status,
        metadata: vaultCredentialVersions.metadata,
        externalVaultPath: vaultCredentialVersions.externalVaultPath,
        secretRef: vaultCredentialVersions.secretRef,
      })
      .from(vaultCredentialVersions)
      .innerJoin(vaultCredentials, eq(vaultCredentialVersions.credentialId, vaultCredentials.id))
      .where(
        and(
          eq(vaultCredentialVersions.id, ref),
          eq(vaultCredentialVersions.organizationId, scope.organizationId),
          or(eq(vaultCredentialVersions.projectId, scope.projectId), isNull(vaultCredentialVersions.projectId)),
        ),
      )
      .get()
    if (!version) {
      throw new Error(`Runtime credential reference ${ref} cannot be resolved`)
    }
    if (version.status === 'revoked' || version.credentialStatus === 'revoked') {
      throw new Error(`Runtime credential reference ${ref} is revoked by vault policy`)
    }
    if (version.status === 'deleted') {
      throw new Error(`Runtime credential reference ${ref} cannot be resolved`)
    }
    if (version.externalVaultPath) {
      resolved[name] = version.secretRef
      continue
    }
    const metadata = parseMetadata(version.metadata)
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value !== 'string') {
      throw new Error(`Runtime credential reference ${ref} cannot be resolved`)
    }
    resolved[name] = value
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
