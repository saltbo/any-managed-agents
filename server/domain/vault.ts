// Pure vault credential rules: secret-reference construction, credential/version
// state machine, and reference-pinning checks. Zero outward imports — directly
// unit-testable. Secret storage (crypto, Cloudflare secrets) is a boundary and
// lives behind the SecretStore gateway, not here.

export const SECRET_PROVIDERS = ['ama-managed', 'cloudflare-secrets', 'external-vault'] as const
export const VAULT_SCOPES = ['project', 'organization'] as const
export const CREDENTIAL_STATES = ['active', 'revoked'] as const
export const VERSION_STATES = ['active', 'superseded', 'revoked'] as const

export type SecretProvider = (typeof SECRET_PROVIDERS)[number]
export type VaultScope = (typeof VAULT_SCOPES)[number]
export type CredentialState = (typeof CREDENTIAL_STATES)[number]
export type VersionState = (typeof VERSION_STATES)[number]

export interface SecretMaterial {
  provider?: SecretProvider | undefined
  secretValue?: string | undefined
  externalVaultPath?: string | undefined
  referenceName?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

// The safe (secret-free) reference fields a credential version persists. The
// actual secret value never appears here — it goes to the SecretStore gateway.
export interface SecretReference {
  provider: SecretProvider
  secretRef: string
  externalVaultPath: string | null
  referenceName: string
  hasSecret: boolean
  metadata: Record<string, unknown>
}

function secretReferenceName(credentialId: string, version: number, requestedName: string | undefined) {
  return requestedName ?? `AMA_${credentialId.toUpperCase()}_V${version}`
}

// Builds the safe reference for a credential version from the requested secret
// material, validating the provider-specific field combination. Throws on an
// invalid combination so the http layer maps it to a 400.
export function secretReference(credentialId: string, version: number, values: SecretMaterial): SecretReference {
  const provider = values.provider ?? 'cloudflare-secrets'
  if (provider === 'external-vault') {
    if (values.secretValue) {
      throw new Error('secretValue is not accepted for external-vault credentials')
    }
    if (!values.externalVaultPath) {
      throw new Error('externalVaultPath is required for external-vault credentials')
    }
    return {
      provider,
      secretRef: values.externalVaultPath,
      externalVaultPath: values.externalVaultPath,
      referenceName: values.referenceName ?? values.externalVaultPath,
      hasSecret: true,
      metadata: values.metadata ?? {},
    }
  }
  if (provider === 'ama-managed') {
    if (!values.secretValue) {
      throw new Error('secretValue is required for ama-managed credentials')
    }
    if (values.externalVaultPath) {
      throw new Error('externalVaultPath is not accepted for ama-managed credentials')
    }
    const referenceName = secretReferenceName(credentialId, version, values.referenceName)
    return {
      provider,
      secretRef: `ama-managed:${referenceName}`,
      externalVaultPath: null,
      referenceName,
      hasSecret: true,
      metadata: values.metadata ?? {},
    }
  }

  if (!values.secretValue) {
    throw new Error('secretValue is required for cloudflare-secrets credentials')
  }
  if (values.externalVaultPath) {
    throw new Error('externalVaultPath is not accepted for cloudflare-secrets credentials')
  }
  const referenceName = secretReferenceName(credentialId, version, values.referenceName)
  return {
    provider,
    secretRef: `cloudflare-secret:${referenceName}`,
    externalVaultPath: null,
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
