import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const credentialForResolutionMock = vi.fn()
const credentialVersionForResolutionMock = vi.fn()
const decryptSecretValueMock = vi.fn()

vi.mock('../repos/runtime-orchestration', () => ({
  createRuntimeOrchestrationRepo: () => ({
    credentialForResolution: credentialForResolutionMock,
    credentialVersionForResolution: credentialVersionForResolutionMock,
  }),
}))

vi.mock('../../vault-crypto', () => ({
  decryptSecretValue: decryptSecretValueMock,
}))

const { createRuntimeSecretEnvGateway, resolveRuntimeSecretEnv } = await import('./runtime-secret-env')

const env = { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env
const fakeDb = {} as Parameters<typeof createRuntimeSecretEnvGateway>[1]

const scope = { organizationId: 'org_1', projectId: 'project_1' }
const items = [{ name: 'API_KEY', credentialRef: { credentialId: 'cred_1' } }]

describe('[spec: runtime-secret-env/gateway] createRuntimeSecretEnvGateway', () => {
  beforeEach(() => {
    credentialForResolutionMock.mockReset()
    credentialVersionForResolutionMock.mockReset()
    decryptSecretValueMock.mockReset()
  })

  it('returns an object with a resolve method', () => {
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    expect(typeof gateway.resolve).toBe('function')
  })

  it('decrypts the stored ciphertext for an ama-managed credential version', async () => {
    credentialForResolutionMock.mockResolvedValueOnce({ state: 'active', activeVersionId: 'ver_1' })
    credentialVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretValue: 'cipher' }),
      externalVaultPath: null,
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret-value')
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    const result = await gateway.resolve(scope, items)
    expect(result).toEqual({ API_KEY: 'secret-value' })
    expect(decryptSecretValueMock).toHaveBeenCalledWith(env, 'cipher')
  })

  it('passes through the safe reference for an external-vault version', async () => {
    credentialForResolutionMock.mockResolvedValueOnce({ state: 'active', activeVersionId: 'ver_1' })
    credentialVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: '{}',
      externalVaultPath: '/secret/path',
      secretRef: 'external-ref',
    })
    const result = await resolveRuntimeSecretEnv(env, fakeDb, scope, items)
    expect(result).toEqual({ API_KEY: 'external-ref' })
    expect(decryptSecretValueMock).not.toHaveBeenCalled()
  })

  it('returns an empty map when items is not an array', async () => {
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    const result = await gateway.resolve(scope, undefined)
    expect(result).toEqual({})
  })

  it('throws when a credential reference cannot be resolved', async () => {
    credentialForResolutionMock.mockResolvedValueOnce(null)
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    await expect(gateway.resolve(scope, items)).rejects.toThrow('cred_1 cannot be resolved')
  })

  it('throws when the credential is revoked by vault policy', async () => {
    credentialForResolutionMock.mockResolvedValueOnce({ state: 'revoked', activeVersionId: 'ver_1' })
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    await expect(gateway.resolve(scope, items)).rejects.toThrow('cred_1 is revoked by vault policy')
  })
})
