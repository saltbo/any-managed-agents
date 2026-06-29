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
    provider: 'ama',
    secretRef: 'ama://vaults/vault_x/credentials/cred_x/versions/ver_x',
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
    policies: undefined as unknown as Deps['policies'],
    budgets: undefined as unknown as Deps['budgets'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    triggerDispatch: undefined as unknown as Deps['triggerDispatch'],
    projects: undefined as unknown as Deps['projects'],
    federatedTenants: undefined as unknown as Deps['federatedTenants'],
    runners: undefined as unknown as Deps['runners'],
    workItems: undefined as unknown as Deps['workItems'],
    leases: undefined as unknown as Deps['leases'],
    runtimeSecrets: undefined as unknown as Deps['runtimeSecrets'],
    cloudTurnQueue: undefined as unknown as Deps['cloudTurnQueue'],
    runnerChannel: undefined as unknown as Deps['runnerChannel'],
    cloudRuntime: undefined as unknown as Deps['cloudRuntime'],
    runtimeWorkspace: undefined as unknown as Deps['runtimeWorkspace'],
    sandboxExecutor: undefined as unknown as Deps['sandboxExecutor'],
    amaTurnExecutor: undefined as unknown as Deps['amaTurnExecutor'],
    sessionOrchestration: undefined as unknown as Deps['sessionOrchestration'],
    sessionEventStore: undefined as unknown as Deps['sessionEventStore'],
    sessions: undefined as unknown as Deps['sessions'],
    createApprovalGate: undefined as unknown as Deps['createApprovalGate'],
    rereadStartedSession: false,
    sessionEvents: undefined as unknown as Deps['sessionEvents'],
    audit: { record: async () => {} },
    policy: {
      resolveToolPolicy: async () => ({}),
      resolveMcpPolicy: async () => ({}),
      evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
      resolveEffective: async () => ({
        source: { type: 'platform_default', id: 'workers-ai-default' },
        sources: [],
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
      }),
      evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
      evaluateSandboxRuntime: async () => ({ allowed: true, category: 'sandbox', rule: null, message: '' }),
      policyBlocksSandboxOperation: async () => null,
      toolPolicyRequiresApproval: async () => false,
      evaluateProviderForSession: async () => ({
        decision: { allowed: true, category: 'provider', rule: null, message: '' },
        override: null,
      }),
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

  it('merges version metadata even when the secret store returns undefined', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => undefined as unknown as Record<string, unknown>,
      },
    })
    const result = await createCredential(deps, vault(), {
      name: 'Token',
      type: 'api_key',
      connectorBinding: {},
      metadata: {},
      secret: { secretValue: 'raw' },
    })
    expect(result.credential.activeVersionId).toBeDefined()
  })

  it('maps an invalid secret reference to a VaultSecretError', async () => {
    await expect(
      createCredential(fakeDeps(), vault(), {
        name: 'Token',
        type: 'api_key',
        connectorBinding: {},
        metadata: {},
        secret: {},
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

  it('maps a secret-store failure during rotation to a VaultSecretError', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw new Error('Cloudflare rotation storage failed')
        },
      },
    })
    await expect(rotateCredential(deps, credential(), { secretValue: 'raw' })).rejects.toBeInstanceOf(VaultSecretError)
  })
})

describe('[spec: vaults/credential-delete] deleteCredentialVersion', () => {
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

  it('deletes the version row after reference checks pass', async () => {
    let deletedVersionId: string | null = null
    const deps = fakeDeps({
      vaults: {
        versionHasActiveReferences: async () => false,
        deleteVersion: async (versionId) => {
          deletedVersionId = versionId
        },
      },
    })
    await deleteCredentialVersion(deps, credential({ activeVersionId: 'vaultver_1' }), version())
    expect(deletedVersionId).toBe('vaultver_2')
  })

  it('uses a fallback message when the secret-store throws a non-Error during rotation', async () => {
    const deps = fakeDeps({
      secretStore: {
        store: async () => {
          throw 'string failure'
        },
      },
    })
    const error = await rotateCredential(deps, credential(), { secretValue: 'raw' }).catch((e) => e)
    expect(error).toBeInstanceOf(VaultSecretError)
    expect(error.message).toBe('Invalid secret reference')
  })
})
