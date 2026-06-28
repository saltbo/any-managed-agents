import { describe, expect, it } from 'vitest'
import { credentialRefPinsVersion, secretReference, stripStoredSecretMetadata } from './vault'

describe('[spec: vaults/secret-reference] secretReference', () => {
  it('builds a managed reference and derives a reference name', () => {
    const ref = secretReference(
      { vaultId: 'vault_abc', credentialId: 'vaultcred_abc', versionId: 'vaultver_abc' },
      1,
      { secretValue: 'token' },
    )
    expect(ref).toMatchObject({
      provider: 'ama',
      referenceName: 'AMA_VAULTCRED_ABC_V1',
      secretRef: 'ama://vaults/vault_abc/credentials/vaultcred_abc/versions/vaultver_abc',
      hasSecret: true,
    })
  })

  it('honours an explicit reference name and version number', () => {
    const ref = secretReference(
      { vaultId: 'vault_abc', credentialId: 'vaultcred_abc', versionId: 'vaultver_3' },
      3,
      { secretValue: 'token', referenceName: 'CUSTOM' },
    )
    expect(ref.referenceName).toBe('CUSTOM')
    expect(ref.secretRef).toBe('ama://vaults/vault_abc/credentials/vaultcred_abc/versions/vaultver_3')
  })

  it('requires a secret value', () => {
    expect(() => secretReference({ vaultId: 'vault_abc', credentialId: 'c', versionId: 'v' }, 1, {})).toThrow(
      /secretValue is required/,
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
