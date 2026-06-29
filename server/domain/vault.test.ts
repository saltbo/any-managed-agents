import { describe, expect, it } from 'vitest'
import {
  credentialScopedSecretRef,
  secretReference,
  secretRefIdentity,
  secretRefPinsVersion,
  stripStoredSecretMetadata,
} from './vault'

describe('[spec: vaults/secret-reference] secretReference', () => {
  it('builds a managed reference and derives a reference name', () => {
    const ref = secretReference(
      { vaultId: 'vault_abc', credentialId: 'vaultcred_abc', versionId: 'vaultver_abc' },
      1,
      'Opaque',
      { stringData: { value: 'token' } },
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
      'Opaque',
      {
        stringData: { value: 'token' },
        referenceName: 'CUSTOM',
      },
    )
    expect(ref.referenceName).toBe('CUSTOM')
    expect(ref.secretRef).toBe('ama://vaults/vault_abc/credentials/vaultcred_abc/versions/vaultver_3')
  })

  it('requires string data', () => {
    expect(() => secretReference({ vaultId: 'vault_abc', credentialId: 'c', versionId: 'v' }, 1, 'Opaque', {})).toThrow(
      /At least one data key is required/,
    )
  })
})

describe('[spec: vaults/secret-reference] stripStoredSecretMetadata', () => {
  it('removes stored secret material from version metadata', () => {
    expect(
      stripStoredSecretMetadata({
        encryptedSecretValue: 'x',
        encryptedSecretData: { value: 'x' },
        localSecretValue: 'y',
        rotatedBy: 'op',
      }),
    ).toEqual({ rotatedBy: 'op' })
  })
})

describe('[spec: vaults/version-delete] secretRefPinsVersion', () => {
  const version = { vaultId: 'vault_1', credentialId: 'cred_1', id: 'ver_1' }

  it('matches a reference pinning the exact version', () => {
    expect(secretRefPinsVersion('ama://vaults/vault_1/credentials/cred_1/versions/ver_1', version)).toBe(true)
  })

  it('ignores a credential reference without a pinned version', () => {
    expect(secretRefPinsVersion('ama://vaults/vault_1/credentials/cred_1', version)).toBe(false)
  })

  it('ignores a reference to a different credential or version', () => {
    expect(secretRefPinsVersion('ama://vaults/vault_1/credentials/cred_2/versions/ver_1', version)).toBe(false)
    expect(secretRefPinsVersion('ama://vaults/vault_1/credentials/cred_1/versions/ver_2', version)).toBe(false)
    expect(secretRefPinsVersion(null, version)).toBe(false)
  })
})

describe('[spec: vaults/secret-reference] secretRefIdentity', () => {
  it('parses vault, credential, and credential-version refs', () => {
    expect(secretRefIdentity('ama://vaults/vault_1')).toEqual({ vaultId: 'vault_1' })
    expect(secretRefIdentity(credentialScopedSecretRef({ vaultId: 'vault_1', credentialId: 'cred_1' }))).toEqual({
      vaultId: 'vault_1',
      credentialId: 'cred_1',
    })
    expect(secretRefIdentity('ama://vaults/vault_1/credentials/cred_1/versions/ver_1')).toEqual({
      vaultId: 'vault_1',
      credentialId: 'cred_1',
      versionId: 'ver_1',
    })
  })
})
