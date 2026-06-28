// Pure vault credential rules: secret-reference construction, credential/version
// state machine, and reference-pinning checks. Zero outward imports — directly
// unit-testable. Secret storage is a boundary and lives behind the SecretStore
// gateway, not here.

export const SECRET_PROVIDERS = ['ama'] as const
export const VAULT_SCOPES = ['project', 'organization'] as const
export const CREDENTIAL_STATES = ['active', 'revoked'] as const
export const VERSION_STATES = ['active', 'superseded', 'revoked'] as const

export type SecretProvider = (typeof SECRET_PROVIDERS)[number]
export type VaultScope = (typeof VAULT_SCOPES)[number]
export type CredentialState = (typeof CREDENTIAL_STATES)[number]
export type VersionState = (typeof VERSION_STATES)[number]

export interface SecretMaterial {
  secretValue?: string | undefined
  referenceName?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

export interface SecretIdentity {
  vaultId: string
  credentialId: string
  versionId: string
}

// The safe (secret-free) reference fields a credential version persists. The
// actual secret value never appears here — it goes to the SecretStore gateway.
export interface SecretReference {
  provider: SecretProvider
  secretRef: string
  referenceName: string
  hasSecret: boolean
  metadata: Record<string, unknown>
}

function secretReferenceName(credentialId: string, version: number, requestedName: string | undefined) {
  return requestedName ?? `AMA_${credentialId.toUpperCase()}_V${version}`
}

function uriPathSegment(value: string) {
  return encodeURIComponent(value)
}

export function credentialVersionSecretRef(identity: SecretIdentity) {
  return `ama://vaults/${uriPathSegment(identity.vaultId)}/credentials/${uriPathSegment(identity.credentialId)}/versions/${uriPathSegment(identity.versionId)}`
}

export function amaSecretRef(vaultId: string) {
  return `ama://vaults/${uriPathSegment(vaultId)}`
}

export function vaultIdFromRef(secretRef: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(secretRef)
  } catch {
    return null
  }
  if (parsed.protocol !== 'ama:' || parsed.hostname !== 'vaults') {
    return null
  }
  const [vaultId, ...rest] = parsed.pathname.split('/').filter(Boolean)
  return vaultId && rest.length === 0 ? decodeURIComponent(vaultId) : null
}

export function secretRefPinsVersion(secretRef: unknown, version: { id: string; credentialId: string; vaultId: string }) {
  return typeof secretRef === 'string' && secretRef === credentialVersionSecretRef({
    vaultId: version.vaultId,
    credentialId: version.credentialId,
    versionId: version.id,
  })
}

// Builds the safe reference for a credential version from the requested secret
// material, validating the provider-specific field combination. Throws on an
// invalid combination so the http layer maps it to a 400.
export function secretReference(identity: SecretIdentity, version: number, values: SecretMaterial): SecretReference {
  if (!values.secretValue) {
    throw new Error('secretValue is required for AMA vault credentials')
  }
  const referenceName = secretReferenceName(identity.credentialId, version, values.referenceName)
  return {
    provider: 'ama',
    secretRef: credentialVersionSecretRef(identity),
    referenceName,
    hasSecret: true,
    metadata: values.metadata ?? {},
  }
}

// Stored secret material (ciphertext, legacy local values) lives only in the
// D1 row. It must never leave through API responses or audit snapshots.
const STORED_SECRET_METADATA_KEYS = ['encryptedSecretValue', 'localSecretValue'] as const

export function stripStoredSecretMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...metadata }
  for (const key of STORED_SECRET_METADATA_KEYS) {
    delete safe[key]
  }
  return safe
}

// Credential references are { credentialId, versionId? } objects everywhere in
// v1 (docs/api-v1-design.md §1.4). A reference without versionId resolves to
// the credential's active version, which can never be deleted, so only pinned
// references block deleting a specific version.
export function credentialRefPinsVersion(ref: unknown, version: { credentialId: string; id: string }) {
  if (!ref || typeof ref !== 'object') {
    return false
  }
  const record = ref as { credentialId?: unknown; versionId?: unknown }
  return record.credentialId === version.credentialId && record.versionId === version.id
}
