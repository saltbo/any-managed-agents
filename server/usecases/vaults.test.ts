import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import {
  type CredentialRecord,
  type CredentialVersionRecord,
  type VaultRecord,
  VaultSecretError,
  VaultVersionReferencedError,
} from './ports'
import { createCredential, deleteCredentialVersion, rotateCredential } from './vaults'

function vault(overrides: Partial<VaultRecord> = {}): VaultRecord {
  return {
    id: 'vault_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Vault',
    description: null,
    scope: 'project',
    metadata: {},
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function credential(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: 'vaultcred_1',
    vaultId: 'vault_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Token',
    type: 'api_key',
    connectorBinding: {},
    metadata: {},
    state: 'active',
    activeVersionId: 'vaultver_1',
    revokedAt: null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function version(overrides: Partial<CredentialVersionRecord> = {}): CredentialVersionRecord {
  return {
    id: 'vaultver_2',
    credentialId: 'vaultcred_1',
    vaultId: 'vault_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    version: 2,
    provider: 'cloudflare-secrets',
    secretRef: 'cloudflare-secret:X',
    externalVaultPath: null,
    referenceName: 'X',
    state: 'active',
    hasSecret: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    revokedAt: null,
    ...overrides,
  }
}

function fakeDeps(
  overrides: { vaults?: Partial<Deps['vaults']>; secretStore?: Partial<Deps['secretStore']> } = {},
): Deps {
  const vaults: Deps['vaults'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insert: async () => vault(),
    update: async () => {},
    hasCredentials: async () => false,
    listCredentials: async () => ({ rows: [], hasMore: false }),
    findCredential: async () => null,
    activeVersion: async () => null,
    latestVersionNumber: async () => 1,
    insertCredentialWithVersion: async (cred, ver) => ({
      credential: credential({ id: ver.credentialId, name: cred.name, activeVersionId: ver.id }),
      version: version({ id: ver.id, version: ver.version }),
    }),
    updateCredential: async () => {},
    listVersions: async () => ({ rows: [], hasMore: false }),
    findVersion: async () => null,
    insertVersionRotation: async (ver) => version({ id: ver.id, version: ver.version }),
    deleteVersion: async () => {},
    versionHasActiveReferences: async () => false,
    ...overrides.vaults,
  }
  const secretStore: Deps['secretStore'] = {
    store: async () => ({ encryptedSecretValue: 'cipher' }),
    delete: async () => {},
    ...overrides.secretStore,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults,
    secretStore,
    connectors: undefined as unknown as Deps['connectors'],
    connections: undefined as unknown as Deps['connections'],
    policies: undefined as unknown as Deps['policies'],
    accessRules: undefined as unknown as Deps['accessRules'],
    budgets: undefined as unknown as Deps['budgets'],
    mcp: undefined as unknown as Deps['mcp'],
    sessionEvents: undefined as unknown as Deps['sessionEvents'],
    audit: { record: async () => {} },
    policy: {
      resolveToolPolicy: async () => ({}),
      resolveMcpPolicy: async () => ({}),
      evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
      resolveEffective: async () => ({
        source: { type: 'platform_default', id: 'workers-ai-default' },
        sources: [],
        accessRules: [],
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
      }),
      evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
    },
  }
}

describe('[spec: vaults/credential-create] createCredential', () => {
  it('stores the secret and inserts the credential with its first version', async () => {
    let stored = false
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          stored = true
          return { encryptedSecretValue: 'cipher' }
        },
      },
    })
    const result = await createCredential(deps, vault(), {
      name: 'Token',
      type: 'api_key',
      connectorBinding: {},
      metadata: {},
      secret: { secretValue: 'raw' },
    })
    expect(stored).toBe(true)
    expect(result.version.version).toBe(1)
    expect(result.credential.activeVersionId).toBe(result.version.id)
  })

  it('maps an invalid secret reference to a VaultSecretError', async () => {
    await expect(
      createCredential(fakeDeps(), vault(), {
        name: 'Token',
        type: 'api_key',
        connectorBinding: {},
        metadata: {},
        secret: { provider: 'external-vault' },
      }),
    ).rejects.toBeInstanceOf(VaultSecretError)
  })

  it('maps a secret-store failure to a VaultSecretError', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw new Error('Cloudflare secret storage failed')
        },
      },
    })
    await expect(
      createCredential(deps, vault(), {
        name: 'Token',
        type: 'api_key',
        connectorBinding: {},
        metadata: {},
        secret: { secretValue: 'raw' },
      }),
    ).rejects.toBeInstanceOf(VaultSecretError)
  })
})

describe('[spec: vaults/credential-rotate] rotateCredential', () => {
  it('creates the next version and supersedes the previous active version', async () => {
    let supersededOf: string | null | undefined
    const deps = fakeDeps({
      vaults: {
        latestVersionNumber: async () => 1,
        insertVersionRotation: async (ver, previous) => {
          supersededOf = previous
          return version({ id: ver.id, version: ver.version })
        },
      },
    })
    const result = await rotateCredential(deps, credential({ activeVersionId: 'vaultver_1' }), {
      secretValue: 'raw',
    })
    expect(result.version.version).toBe(2)
    expect(supersededOf).toBe('vaultver_1')
  })
})

describe('[spec: vaults/version-delete] deleteCredentialVersion', () => {
  it('refuses to delete the active version', async () => {
    await expect(
      deleteCredentialVersion(fakeDeps(), credential({ activeVersionId: 'vaultver_2' }), version({ id: 'vaultver_2' })),
    ).rejects.toBeInstanceOf(VaultVersionReferencedError)
  })

  it('refuses to delete a version pinned by live runtime metadata', async () => {
    const deps = fakeDeps({ vaults: { versionHasActiveReferences: async () => true } })
    await expect(
      deleteCredentialVersion(deps, credential({ activeVersionId: 'vaultver_1' }), version()),
    ).rejects.toBeInstanceOf(VaultVersionReferencedError)
  })

  it('deletes the stored secret then the version row', async () => {
    const order: string[] = []
    const deps = fakeDeps({
      secretStore: { delete: async () => void order.push('secret') },
      vaults: { versionHasActiveReferences: async () => false, deleteVersion: async () => void order.push('row') },
    })
    await deleteCredentialVersion(deps, credential({ activeVersionId: 'vaultver_1' }), version())
    expect(order).toEqual(['secret', 'row'])
  })
})
