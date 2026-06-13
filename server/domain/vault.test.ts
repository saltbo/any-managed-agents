import { describe, expect, it } from 'vitest'
import { credentialRefPinsVersion, secretReference, stripStoredSecretMetadata } from './vault'

describe('[spec: vaults/secret-reference] secretReference', () => {
  it('builds a cloudflare-secrets reference by default and derives a reference name', () => {
    const ref = secretReference('vaultcred_abc', 1, { secretValue: 'token' })
    expect(ref).toMatchObject({
      provider: 'cloudflare-secrets',
      referenceName: 'AMA_VAULTCRED_ABC_V1',
      secretRef: 'cloudflare-secret:AMA_VAULTCRED_ABC_V1',
      externalVaultPath: null,
      hasSecret: true,
    })
  })

  it('honours an explicit reference name and version number', () => {
    const ref = secretReference('vaultcred_abc', 3, { secretValue: 'token', referenceName: 'CUSTOM' })
    expect(ref.referenceName).toBe('CUSTOM')
    expect(ref.secretRef).toBe('cloudflare-secret:CUSTOM')
  })

  it('builds an ama-managed reference', () => {
    const ref = secretReference('c', 1, { provider: 'ama-managed', secretValue: 'token' })
    expect(ref.secretRef).toBe('ama-managed:AMA_C_V1')
  })

  it('builds an external-vault reference from the approved path', () => {
    const ref = secretReference('c', 1, { provider: 'external-vault', externalVaultPath: 'vault://team/x' })
    expect(ref).toMatchObject({
      provider: 'external-vault',
      secretRef: 'vault://team/x',
      externalVaultPath: 'vault://team/x',
      referenceName: 'vault://team/x',
    })
  })

  it('rejects a secret value for external-vault credentials', () => {
    expect(() =>
      secretReference('c', 1, { provider: 'external-vault', externalVaultPath: 'vault://x', secretValue: 'no' }),
    ).toThrow(/secretValue is not accepted/)
  })

  it('requires an external path for external-vault credentials', () => {
    expect(() => secretReference('c', 1, { provider: 'external-vault' })).toThrow(/externalVaultPath is required/)
  })

  it('requires a secret value for cloudflare-secrets credentials', () => {
    expect(() => secretReference('c', 1, {})).toThrow(/secretValue is required/)
  })

  it('rejects an external path for cloudflare-secrets credentials', () => {
    expect(() => secretReference('c', 1, { secretValue: 'token', externalVaultPath: 'vault://x' })).toThrow(
      /externalVaultPath is not accepted/,
    )
  })
})

describe('[spec: vaults/secret-reference] stripStoredSecretMetadata', () => {
  it('removes stored secret material from version metadata', () => {
    expect(stripStoredSecretMetadata({ encryptedSecretValue: 'x', localSecretValue: 'y', rotatedBy: 'op' })).toEqual({
      rotatedBy: 'op',
    })
  })
})

describe('[spec: vaults/secret-reference] secretReference ama-managed validation', () => {
  it('requires a secret value for ama-managed credentials', () => {
    expect(() => secretReference('c', 1, { provider: 'ama-managed' })).toThrow(/secretValue is required/)
  })

  it('rejects an external path for ama-managed credentials', () => {
    expect(() =>
      secretReference('c', 1, { provider: 'ama-managed', secretValue: 'token', externalVaultPath: 'vault://x' }),
    ).toThrow(/externalVaultPath is not accepted/)
  })

  it('uses a custom reference name for ama-managed when provided', () => {
    const ref = secretReference('c', 1, { provider: 'ama-managed', secretValue: 'token', referenceName: 'MY_SECRET' })
    expect(ref.referenceName).toBe('MY_SECRET')
    expect(ref.secretRef).toBe('ama-managed:MY_SECRET')
  })
})

describe('[spec: vaults/version-delete] credentialRefPinsVersion', () => {
  const version = { credentialId: 'cred_1', id: 'ver_1' }

  it('matches a reference pinning the exact version', () => {
    expect(credentialRefPinsVersion({ credentialId: 'cred_1', versionId: 'ver_1' }, version)).toBe(true)
  })

  it('ignores a reference without a pinned version (resolves to active)', () => {
    expect(credentialRefPinsVersion({ credentialId: 'cred_1' }, version)).toBe(false)
  })

  it('ignores a reference to a different credential or version', () => {
    expect(credentialRefPinsVersion({ credentialId: 'cred_2', versionId: 'ver_1' }, version)).toBe(false)
    expect(credentialRefPinsVersion({ credentialId: 'cred_1', versionId: 'ver_2' }, version)).toBe(false)
    expect(credentialRefPinsVersion(null, version)).toBe(false)
  })
})
