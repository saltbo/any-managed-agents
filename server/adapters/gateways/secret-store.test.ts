import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const encryptSecretValueMock = vi.fn()

vi.mock('../../vault-crypto', () => ({
  encryptSecretValue: encryptSecretValueMock,
}))

const { createSecretStoreGateway } = await import('./secret-store')

afterEach(() => {
  encryptSecretValueMock.mockReset()
})

const encryptedValue = { version: 'v1', algorithm: 'AES-GCM', iv: 'aaa', ciphertext: 'bbb' }

function makeEnv(): Env {
  return { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as Env
}

describe('[spec: secret-store/gateway] createSecretStoreGateway', () => {
  it('returns a gateway with a store method', () => {
    const gateway = createSecretStoreGateway(makeEnv())
    expect(typeof gateway.store).toBe('function')
  })

  it('throws when secretValue is missing', async () => {
    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.store(
        {
          provider: 'ama',
          referenceName: 'MY_KEY',
          secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
          hasSecret: true,
          metadata: {},
        },
        {},
      ),
    ).rejects.toThrow(/secretValue is required/)
  })

  it('encrypts managed secret values and returns encrypted metadata', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const gateway = createSecretStoreGateway(makeEnv())
    const result = await gateway.store(
      {
        provider: 'ama',
        referenceName: 'MY_KEY',
        secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
        hasSecret: true,
        metadata: {},
      },
      { secretValue: 'raw-secret' },
    )
    expect(result).toEqual({ encryptedSecretValue: encryptedValue })
    expect(encryptSecretValueMock).toHaveBeenCalledWith(expect.any(Object), 'raw-secret')
  })
})
