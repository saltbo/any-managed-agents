import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const encryptSecretValueMock = vi.fn()

vi.mock('../../vaultCrypto', () => ({
  encryptSecretValue: encryptSecretValueMock,
}))

const { createSecretStoreGateway } = await import('./secret-store')

afterEach(() => {
  vi.unstubAllGlobals()
  encryptSecretValueMock.mockReset()
})

const encryptedValue = { version: 'v1', algorithm: 'AES-GCM', iv: 'aaa', ciphertext: 'bbb' }

function makeEnv(overrides: Partial<Env> = {}, omit: ReadonlyArray<keyof Env> = []): Env {
  const base: Record<string, unknown> = {
    AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32),
    AMA_WORKERS_AI_ACCOUNT_ID: 'acct_123',
    AMA_CLOUDFLARE_SECRETS_STORE_ID: 'store_123',
    AMA_CLOUDFLARE_API_TOKEN: 'tok_abc',
    ...overrides,
  }
  for (const key of omit) {
    delete base[key as string]
  }
  return base as unknown as Env
}

function makeFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('[spec: secret-store/gateway] createSecretStoreGateway — store', () => {
  it('returns gateway with store and delete methods', () => {
    const gateway = createSecretStoreGateway(makeEnv())
    expect(typeof gateway.store).toBe('function')
    expect(typeof gateway.delete).toBe('function')
  })

  it('returns undefined for external-vault provider when path prefix is approved', async () => {
    const env = makeEnv({ AMA_APPROVED_EXTERNAL_VAULT_PREFIXES: 'vault://prod/' })
    const gateway = createSecretStoreGateway(env)
    const result = await gateway.store(
      {
        provider: 'external-vault',
        referenceName: 'MY_KEY',
        externalVaultPath: 'vault://prod/secret/my-key',
        secretRef: 'vault://prod/secret/my-key',
        hasSecret: true,
        metadata: {},
      },
      {},
    )
    expect(result).toBeUndefined()
  })

  it('throws for external-vault when the path does not match any approved prefix', async () => {
    const env = makeEnv({ AMA_APPROVED_EXTERNAL_VAULT_PREFIXES: 'vault://prod/' })
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.store(
        {
          provider: 'external-vault',
          referenceName: 'MY_KEY',
          externalVaultPath: 'vault://dev/secret',
          secretRef: 'vault://dev/secret',
          hasSecret: true,
          metadata: {},
        },
        {},
      ),
    ).rejects.toThrow(/not approved/)
  })

  it('throws for external-vault when no prefixes are configured', async () => {
    const env = makeEnv()
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.store(
        {
          provider: 'external-vault',
          referenceName: 'MY_KEY',
          externalVaultPath: 'vault://prod/secret',
          secretRef: 'vault://prod/secret',
          hasSecret: true,
          metadata: {},
        },
        {},
      ),
    ).rejects.toThrow(/not approved/)
  })

  it('throws when secretValue is missing for ama-managed provider', async () => {
    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.store(
        {
          provider: 'ama-managed',
          referenceName: 'MY_KEY',
          secretRef: 'ama-managed:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        {},
      ),
    ).rejects.toThrow(/secretValue is required/)
  })

  it('returns encryptedSecretValue for ama-managed provider', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const gateway = createSecretStoreGateway(makeEnv())
    const result = await gateway.store(
      {
        provider: 'ama-managed',
        referenceName: 'MY_KEY',
        secretRef: 'ama-managed:MY_KEY',
        externalVaultPath: null,
        hasSecret: true,
        metadata: {},
      },
      { secretValue: 'raw-secret' },
    )
    expect(result).toEqual({ encryptedSecretValue: encryptedValue })
    expect(encryptSecretValueMock).toHaveBeenCalledWith(expect.any(Object), 'raw-secret')
  })

  it('stores to Cloudflare Secrets API and returns both cloudflareSecretId and encryptedSecretValue', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const fetchMock = makeFetch({ result: [{ id: 'cf-secret-id-abc' }] })
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createSecretStoreGateway(makeEnv())
    const result = await gateway.store(
      {
        provider: 'cloudflare-secrets',
        referenceName: 'MY_KEY',
        secretRef: 'cf:MY_KEY',
        externalVaultPath: null,
        hasSecret: true,
        metadata: {},
      },
      { secretValue: 'raw-secret' },
    )
    expect(result).toEqual({
      cloudflareSecretId: 'cf-secret-id-abc',
      encryptedSecretValue: encryptedValue,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/secrets'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses test-mode shortcut when AMA_LOCAL_SECRET_STORE is "test"', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ AMA_LOCAL_SECRET_STORE: 'test' })
    const gateway = createSecretStoreGateway(env)
    const result = await gateway.store(
      {
        provider: 'cloudflare-secrets',
        referenceName: 'MY_KEY',
        secretRef: 'cf:MY_KEY',
        externalVaultPath: null,
        hasSecret: true,
        metadata: {},
      },
      { secretValue: 'raw-secret' },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    const typedResult = result as Record<string, unknown> | undefined
    expect(typedResult?.cloudflareSecretId).toMatch(/^test-cloudflare-secret:MY_KEY:/)
    expect(typedResult?.encryptedSecretValue).toBe(encryptedValue)
  })

  it('throws when Cloudflare secret storage POST fails', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    vi.stubGlobal('fetch', makeFetch({}, false))

    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.store(
        {
          provider: 'cloudflare-secrets',
          referenceName: 'MY_KEY',
          secretRef: 'cf:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        { secretValue: 'raw-secret' },
      ),
    ).rejects.toThrow(/storage failed/)
  })

  it('throws when Cloudflare POST response has no secret id', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    vi.stubGlobal('fetch', makeFetch({ result: [{}] }))

    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.store(
        {
          provider: 'cloudflare-secrets',
          referenceName: 'MY_KEY',
          secretRef: 'cf:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        { secretValue: 'raw-secret' },
      ),
    ).rejects.toThrow(/did not return a secret id/)
  })

  it('throws when AMA_WORKERS_AI_ACCOUNT_ID is missing for cloudflare-secrets', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const env = makeEnv({}, ['AMA_WORKERS_AI_ACCOUNT_ID'])
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.store(
        {
          provider: 'cloudflare-secrets',
          referenceName: 'MY_KEY',
          secretRef: 'cf:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        { secretValue: 'raw-secret' },
      ),
    ).rejects.toThrow(/AMA_WORKERS_AI_ACCOUNT_ID/)
  })

  it('throws when AMA_CLOUDFLARE_SECRETS_STORE_ID is missing for cloudflare-secrets', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const env = makeEnv({}, ['AMA_CLOUDFLARE_SECRETS_STORE_ID'])
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.store(
        {
          provider: 'cloudflare-secrets',
          referenceName: 'MY_KEY',
          secretRef: 'cf:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        { secretValue: 'raw-secret' },
      ),
    ).rejects.toThrow(/AMA_CLOUDFLARE_SECRETS_STORE_ID/)
  })

  it('throws when AMA_CLOUDFLARE_API_TOKEN is missing for cloudflare-secrets', async () => {
    encryptSecretValueMock.mockResolvedValueOnce(encryptedValue)
    const env = makeEnv({}, ['AMA_CLOUDFLARE_API_TOKEN'])
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.store(
        {
          provider: 'cloudflare-secrets',
          referenceName: 'MY_KEY',
          secretRef: 'cf:MY_KEY',
          externalVaultPath: null,
          hasSecret: true,
          metadata: {},
        },
        { secretValue: 'raw-secret' },
      ),
    ).rejects.toThrow(/AMA_CLOUDFLARE_API_TOKEN/)
  })
})

describe('[spec: secret-store/gateway] createSecretStoreGateway — delete', () => {
  it('is a no-op for non-cloudflare-secrets provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createSecretStoreGateway(makeEnv())
    await gateway.delete({ provider: 'ama-managed', hasSecret: true, metadata: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a no-op when hasSecret is false', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createSecretStoreGateway(makeEnv())
    await gateway.delete({ provider: 'cloudflare-secrets', hasSecret: false, metadata: { cloudflareSecretId: 'id' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('is a no-op in test mode even for cloudflare-secrets with a secret', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const env = makeEnv({ AMA_LOCAL_SECRET_STORE: 'test' })
    const gateway = createSecretStoreGateway(env)
    await gateway.delete({ provider: 'cloudflare-secrets', hasSecret: true, metadata: { cloudflareSecretId: 'id' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls the Cloudflare DELETE endpoint with the correct secret id', async () => {
    const fetchMock = makeFetch({})
    vi.stubGlobal('fetch', fetchMock)

    const gateway = createSecretStoreGateway(makeEnv())
    await gateway.delete({
      provider: 'cloudflare-secrets',
      hasSecret: true,
      metadata: { cloudflareSecretId: 'cf-secret-id-abc' },
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toContain('cf-secret-id-abc')
    expect(init?.method).toBe('DELETE')
  })

  it('throws when cloudflareSecretId is missing in metadata', async () => {
    const gateway = createSecretStoreGateway(makeEnv())
    await expect(gateway.delete({ provider: 'cloudflare-secrets', hasSecret: true, metadata: {} })).rejects.toThrow(
      /Cloudflare secret id is required/,
    )
  })

  it('throws when cloudflareSecretId is not a string', async () => {
    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.delete({ provider: 'cloudflare-secrets', hasSecret: true, metadata: { cloudflareSecretId: 42 } }),
    ).rejects.toThrow(/Cloudflare secret id is required/)
  })

  it('throws when the DELETE response is not ok', async () => {
    vi.stubGlobal('fetch', makeFetch({}, false))

    const gateway = createSecretStoreGateway(makeEnv())
    await expect(
      gateway.delete({
        provider: 'cloudflare-secrets',
        hasSecret: true,
        metadata: { cloudflareSecretId: 'cf-secret-id-abc' },
      }),
    ).rejects.toThrow(/deletion failed/)
  })

  it('throws when AMA_WORKERS_AI_ACCOUNT_ID is missing on delete', async () => {
    const env = makeEnv({}, ['AMA_WORKERS_AI_ACCOUNT_ID'])
    const gateway = createSecretStoreGateway(env)
    await expect(
      gateway.delete({ provider: 'cloudflare-secrets', hasSecret: true, metadata: { cloudflareSecretId: 'id' } }),
    ).rejects.toThrow(/AMA_WORKERS_AI_ACCOUNT_ID/)
  })
})
