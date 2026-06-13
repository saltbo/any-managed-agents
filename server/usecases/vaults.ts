import type { SecretMaterial, VaultScope } from '@server/domain/vault'
import { secretReference } from '@server/domain/vault'
import type { Deps } from './deps'
import {
  type CredentialRecord,
  type CredentialVersionRecord,
  type VaultRecord,
  VaultSecretError,
  VaultVersionReferencedError,
} from './ports'

// Merges the safe reference metadata with the stored secret metadata (ciphertext,
// cloudflareSecretId) the gateway returned.
function versionMetadata(
  reference: { metadata: Record<string, unknown> },
  stored: Record<string, unknown> | undefined,
) {
  return { ...reference.metadata, ...(stored ?? {}) }
}

export interface CreateCredentialInputDto {
  name: string
  type: string
  connectorBinding: Record<string, unknown>
  metadata: Record<string, unknown>
  secret: SecretMaterial
}

export interface CreateCredentialResult {
  credential: CredentialRecord
  version: CredentialVersionRecord
}

// Creates a credential and its first version: builds the safe reference, stores
// the secret material through the gateway, and inserts both rows atomically.
// Throws VaultSecretError on invalid material or storage failure.
export async function createCredential(
  deps: Deps,
  vault: VaultRecord,
  input: CreateCredentialInputDto,
): Promise<CreateCredentialResult> {
  const timestamp = new Date().toISOString()
  const credentialId = newId('vaultcred')
  let reference: ReturnType<typeof secretReference>
  try {
    reference = secretReference(credentialId, 1, input.secret)
  } catch (error) {
    throw secretError(error)
  }
  let stored: Record<string, unknown> | undefined
  try {
    stored = await deps.secretStore.store(reference, input.secret)
  } catch (error) {
    throw secretError(error)
  }
  return await deps.vaults.insertCredentialWithVersion(
    {
      vaultId: vault.id,
      organizationId: vault.organizationId,
      projectId: vault.projectId,
      name: input.name,
      type: input.type,
      connectorBinding: input.connectorBinding,
      metadata: input.metadata,
    },
    {
      id: newId('vaultver'),
      credentialId,
      vaultId: vault.id,
      organizationId: vault.organizationId,
      projectId: vault.projectId,
      version: 1,
      reference,
      metadata: versionMetadata(reference, stored),
    },
    timestamp,
  )
}

// Rotates a credential by creating a new active version and superseding the
// previous one. Throws VaultSecretError on invalid material or storage failure.
export async function rotateCredential(
  deps: Deps,
  credential: CredentialRecord,
  secret: SecretMaterial,
): Promise<{ credential: CredentialRecord; version: CredentialVersionRecord }> {
  const timestamp = new Date().toISOString()
  let reference: ReturnType<typeof secretReference>
  let stored: Record<string, unknown> | undefined
  let nextVersion: number
  try {
    nextVersion = (await deps.vaults.latestVersionNumber(credential.id)) + 1
    reference = secretReference(credential.id, nextVersion, secret)
    stored = await deps.secretStore.store(reference, secret)
  } catch (error) {
    throw secretError(error)
  }
  const version = await deps.vaults.insertVersionRotation(
    {
      id: newId('vaultver'),
      credentialId: credential.id,
      vaultId: credential.vaultId,
      organizationId: credential.organizationId,
      projectId: credential.projectId,
      version: nextVersion,
      reference,
      metadata: versionMetadata(reference, stored),
    },
    credential.activeVersionId,
    timestamp,
  )
  return { credential: { ...credential, activeVersionId: version.id, updatedAt: timestamp }, version }
}

// Deletes an unused credential version. The active version and versions pinned
// by live runtime metadata cannot be deleted; raises
// VaultVersionReferencedError, mapped to 409. Cloudflare secret deletion is a
// boundary; failures become VaultSecretError (400).
export async function deleteCredentialVersion(
  deps: Deps,
  credential: CredentialRecord,
  version: CredentialVersionRecord,
): Promise<void> {
  if (credential.activeVersionId === version.id) {
    throw new VaultVersionReferencedError('Active credential version cannot be deleted')
  }
  if (await deps.vaults.versionHasActiveReferences(version)) {
    throw new VaultVersionReferencedError('Credential version is referenced by active runtime metadata')
  }
  try {
    await deps.secretStore.delete({
      provider: version.provider,
      hasSecret: version.hasSecret,
      metadata: version.metadata,
    })
  } catch (error) {
    throw secretError(error)
  }
  await deps.vaults.deleteVersion(version.id)
}

function secretError(error: unknown) {
  return new VaultSecretError(error instanceof Error ? error.message : 'Invalid secret reference')
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export type { VaultScope }
