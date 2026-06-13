import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const resolveRuntimeSecretEnvMock = vi.fn()

vi.mock('../../runtime/secret-env', () => ({
  resolveRuntimeSecretEnv: resolveRuntimeSecretEnvMock,
}))

const { createRuntimeSecretEnvGateway } = await import('./runtime-secret-env')

const env = { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env
const fakeDb = {} as Parameters<typeof createRuntimeSecretEnvGateway>[1]

const scope = { organizationId: 'org_1', projectId: 'project_1' }
const items = [{ name: 'API_KEY', credentialRef: { credentialId: 'cred_1' } }]

describe('[spec: runtime-secret-env/gateway] createRuntimeSecretEnvGateway', () => {
  it('returns an object with a resolve method', () => {
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    expect(typeof gateway.resolve).toBe('function')
  })

  it('delegates resolve to resolveRuntimeSecretEnv with all arguments', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ API_KEY: 'secret-value' })
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    const result = await gateway.resolve(scope, items)
    expect(resolveRuntimeSecretEnvMock).toHaveBeenCalledWith(env, fakeDb, scope, items)
    expect(result).toEqual({ API_KEY: 'secret-value' })
  })

  it('returns the resolved map from the underlying resolver', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValueOnce({ TOKEN: 'tok_abc', SECRET: 'sec_xyz' })
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    const result = await gateway.resolve(scope, [])
    expect(result).toEqual({ TOKEN: 'tok_abc', SECRET: 'sec_xyz' })
  })

  it('propagates resolver rejection to the caller', async () => {
    resolveRuntimeSecretEnvMock.mockRejectedValueOnce(new Error('credential not found'))
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    await expect(gateway.resolve(scope, items)).rejects.toThrow('credential not found')
  })

  it('passes the env and db bindings through on each call', async () => {
    resolveRuntimeSecretEnvMock.mockResolvedValue({})
    const gateway = createRuntimeSecretEnvGateway(env, fakeDb)
    await gateway.resolve(scope, items)
    const [calledEnv, calledDb] = resolveRuntimeSecretEnvMock.mock.calls.at(-1) ?? []
    expect(calledEnv).toBe(env)
    expect(calledDb).toBe(fakeDb)
  })
})
