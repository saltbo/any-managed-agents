import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnvFromEntry } from '@server/domain/runtime/execution-inputs'
import type { Env } from '../../env'

const secretVersionForResolutionMock = vi.fn()
const vaultVersionsForResolutionMock = vi.fn()
const decryptSecretValueMock = vi.fn()

vi.mock('../repos/runtime-orchestration', () => ({
  createRuntimeOrchestrationRepo: () => ({
    secretVersionForResolution: secretVersionForResolutionMock,
    vaultVersionsForResolution: vaultVersionsForResolutionMock,
  }),
}))

vi.mock('../../vault-crypto', () => ({
  decryptSecretValue: decryptSecretValueMock,
}))

const { createRuntimeSecretGateway } = await import('./runtime-secrets')

const env = { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env
const fakeDb = {} as Parameters<typeof createRuntimeSecretGateway>[1]

const scope = { organizationId: 'org_1', projectId: 'project_1' }
const items: EnvFromEntry[] = [
  { type: 'secret', name: 'API_KEY', secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1' },
]

describe('[spec: runtime-secrets/gateway] createRuntimeSecretGateway', () => {
  beforeEach(() => {
    secretVersionForResolutionMock.mockReset()
    vaultVersionsForResolutionMock.mockReset()
    decryptSecretValueMock.mockReset()
  })

  it('returns env and volume resolver methods', () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    expect(typeof gateway.resolveEnv).toBe('function')
    expect(typeof gateway.resolveVolumes).toBe('function')
  })

  it('decrypts the stored ciphertext for an AMA credential version', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretValue: 'cipher' }),
      secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret-value')
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    const result = await gateway.resolveEnv(scope, items)
    expect(result).toEqual({ API_KEY: 'secret-value' })
    expect(decryptSecretValueMock).toHaveBeenCalledWith(env, 'cipher')
  })

  it('returns an empty map when envFrom is empty', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    const result = await gateway.resolveEnv(scope, [])
    expect(result).toEqual({})
  })

  it('throws when a credential reference cannot be resolved', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce(null)
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(gateway.resolveEnv(scope, items)).rejects.toThrow('cannot be resolved')
  })

  it('throws when the credential is revoked by vault policy', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({ state: 'revoked', metadata: '{}', secretRef: 'ref' })
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(gateway.resolveEnv(scope, items)).rejects.toThrow('revoked by vault policy')
  })
})
