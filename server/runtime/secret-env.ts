import { and, eq, isNull, or } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import { vaultCredentials, vaultCredentialVersions } from '../db/schema'
import type { Env } from '../env'
import { decryptSecretValue } from '../vaultCrypto'

type Db = ReturnType<typeof drizzle>

// Vault credential reference: the only way secrets are referenced anywhere
// (docs/api-v1-design.md §1.4). No versionId pins the credential's active
// version.
export interface RuntimeCredentialRef {
  credentialId: string
  versionId?: string
}

export interface RuntimeSecretEnvEntry {
  name: string
  credentialRef: RuntimeCredentialRef
}

function parseSecretEnvEntry(item: unknown): RuntimeSecretEnvEntry | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const { name, credentialRef } = item as { name?: unknown; credentialRef?: unknown }
  if (typeof name !== 'string' || !credentialRef || typeof credentialRef !== 'object') {
    return null
  }
  const { credentialId, versionId } = credentialRef as { credentialId?: unknown; versionId?: unknown }
  if (typeof credentialId !== 'string') {
    return null
  }
  return {
    name,
    credentialRef: { credentialId, ...(typeof versionId === 'string' ? { versionId } : {}) },
  }
}

// Resolves vault credential references into the runtime secret env. Both
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
    const entry = parseSecretEnvEntry(item)
    if (!entry) {
      continue
    }
    const { credentialId } = entry.credentialRef
    const credential = await db
      .select({ state: vaultCredentials.state, activeVersionId: vaultCredentials.activeVersionId })
      .from(vaultCredentials)
      .where(
        and(
          eq(vaultCredentials.id, credentialId),
          eq(vaultCredentials.organizationId, scope.organizationId),
          or(eq(vaultCredentials.projectId, scope.projectId), isNull(vaultCredentials.projectId)),
        ),
      )
      .get()
    if (!credential) {
      throw new Error(`Runtime credential reference ${credentialId} cannot be resolved`)
    }
    if (credential.state === 'revoked') {
      throw new Error(`Runtime credential reference ${credentialId} is revoked by vault policy`)
    }
    const versionId = entry.credentialRef.versionId ?? credential.activeVersionId
    if (!versionId) {
      throw new Error(`Runtime credential reference ${credentialId} cannot be resolved`)
    }
    const version = await db
      .select({
        state: vaultCredentialVersions.state,
        metadata: vaultCredentialVersions.metadata,
        externalVaultPath: vaultCredentialVersions.externalVaultPath,
        secretRef: vaultCredentialVersions.secretRef,
      })
      .from(vaultCredentialVersions)
      .where(
        and(
          eq(vaultCredentialVersions.id, versionId),
          eq(vaultCredentialVersions.credentialId, credentialId),
          eq(vaultCredentialVersions.organizationId, scope.organizationId),
          or(eq(vaultCredentialVersions.projectId, scope.projectId), isNull(vaultCredentialVersions.projectId)),
        ),
      )
      .get()
    // Deleted versions are physically removed, so a missing row is unresolvable.
    if (!version) {
      throw new Error(`Runtime credential reference ${credentialId} cannot be resolved`)
    }
    if (version.state === 'revoked') {
      throw new Error(`Runtime credential reference ${credentialId} is revoked by vault policy`)
    }
    if (version.externalVaultPath) {
      resolved[entry.name] = version.secretRef
      continue
    }
    const metadata = parseMetadata(version.metadata)
    const value = await decryptSecretValue(env, metadata?.encryptedSecretValue)
    if (typeof value !== 'string') {
      throw new Error(`Runtime credential reference ${credentialId} cannot be resolved`)
    }
    resolved[entry.name] = value
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
