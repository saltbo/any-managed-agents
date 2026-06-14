import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import {
  type AuthScope,
  type ModelDiscoveryTaskRecord,
  type ProviderModelRecord,
  type ProviderRecord,
  ProviderReferencedError,
  ProviderValidationError,
} from './ports'
import { createProvider, deleteProvider, runModelDiscovery, updateProvider } from './providers'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function providerRecord(overrides: Partial<ProviderRecord> = {}): ProviderRecord {
  return {
    id: 'provider_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    type: 'openai',
    displayName: 'OpenAI',
    baseUrl: null,
    isDefault: false,
    enabled: true,
    credentialId: null,
    credentialVersionId: null,
    credentialStatus: 'missing',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function modelRecord(modelId: string): ProviderModelRecord {
  return {
    id: `model_${modelId}`,
    providerId: 'provider_1',
    modelId,
    displayName: modelId,
    capabilities: ['text'],
    contextWindow: null,
    pricing: {},
    availability: 'available',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function taskRecord(overrides: Partial<ModelDiscoveryTaskRecord> = {}): ModelDiscoveryTaskRecord {
  return {
    id: 'mdtask_1',
    providerId: 'provider_1',
    state: 'running',
    discoveredCount: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(
  overrides: { repo?: Partial<Deps['providers']>; catalog?: Partial<Deps['providerCatalog']> } = {},
): Deps {
  const repo: Deps['providers'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    platformDefault: (projectId) => providerRecord({ id: 'workers-ai', projectId, type: 'workers-ai' }),
    insert: async (input, createdAt) =>
      providerRecord({ id: 'provider_new', ...input, createdAt, updatedAt: createdAt, enabled: true }),
    update: async (_p, _id, fields, updatedAt) => providerRecord({ ...fields, updatedAt }),
    delete: async () => {},
    clearDefaults: async () => {},
    setCatalogStatus: async () => {},
    agentReferences: async () => false,
    listModels: async () => [],
    platformDefaultModels: () => [modelRecord('default')],
    findModel: async () => null,
    upsertModel: async (input) => ({ record: modelRecord(input.modelId), created: true }),
    deleteModel: async () => {},
    insertDiscoveryTask: async () => taskRecord(),
    updateDiscoveryTask: async (_p, _id, fields, updatedAt) =>
      taskRecord({ state: fields.state, discoveredCount: fields.discoveredCount, error: fields.error, updatedAt }),
    findDiscoveryTask: async () => null,
    ...overrides.repo,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: undefined as unknown as Deps['environments'],
    providers: repo,
    providerCatalog: { fetchCatalog: async () => [], ...overrides.catalog },
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    connections: undefined as unknown as Deps['connections'],
    policies: undefined as unknown as Deps['policies'],
    accessRules: undefined as unknown as Deps['accessRules'],
    budgets: undefined as unknown as Deps['budgets'],
    mcp: undefined as unknown as Deps['mcp'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    triggerDispatch: undefined as unknown as Deps['triggerDispatch'],
    projects: undefined as unknown as Deps['projects'],
    federatedTenants: undefined as unknown as Deps['federatedTenants'],
    runners: undefined as unknown as Deps['runners'],
    workItems: undefined as unknown as Deps['workItems'],
    leases: undefined as unknown as Deps['leases'],
    runtimeSecretEnv: undefined as unknown as Deps['runtimeSecretEnv'],
    cloudTurnQueue: undefined as unknown as Deps['cloudTurnQueue'],
    runnerChannel: undefined as unknown as Deps['runnerChannel'],
    sandboxRuntime: undefined as unknown as Deps['sandboxRuntime'],
    sessionOrchestration: undefined as unknown as Deps['sessionOrchestration'],
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
        accessRules: [],
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

describe('[spec: providers/create] createProvider', () => {
  it('clears existing defaults when creating a default provider', async () => {
    let cleared = false
    const deps = fakeDeps({
      repo: {
        clearDefaults: async () => {
          cleared = true
        },
      },
    })
    await createProvider(deps, auth, {
      type: 'openai',
      displayName: 'Default',
      baseUrl: null,
      isDefault: true,
      credentialId: null,
      credentialVersionId: null,
      metadata: {},
      rateLimits: {},
      budgetPolicy: {},
    })
    expect(cleared).toBe(true)
  })

  it('inserts a non-default provider without clearing defaults', async () => {
    let cleared = false
    const deps = fakeDeps({
      repo: {
        clearDefaults: async () => {
          cleared = true
        },
      },
    })
    const provider = await createProvider(deps, auth, {
      type: 'openai',
      displayName: 'Secondary',
      baseUrl: null,
      isDefault: false,
      credentialId: null,
      credentialVersionId: null,
      metadata: {},
      rateLimits: {},
      budgetPolicy: {},
    })
    expect(cleared).toBe(false)
    expect(provider.type).toBe('openai')
  })

  it('rejects an openai-compatible provider without a base URL', async () => {
    await expect(
      createProvider(fakeDeps(), auth, {
        type: 'openai-compatible',
        displayName: 'Gateway',
        baseUrl: null,
        isDefault: false,
        credentialId: null,
        credentialVersionId: null,
        metadata: {},
        rateLimits: {},
        budgetPolicy: {},
      }),
    ).rejects.toMatchObject({ fields: { baseUrl: expect.any(String) } })
  })
})

describe('[spec: providers/update] updateProvider', () => {
  it('rejects switching to openai-compatible without a base URL', async () => {
    await expect(
      updateProvider(fakeDeps(), auth, providerRecord({ type: 'openai', baseUrl: null }), {
        type: 'openai-compatible',
      }),
    ).rejects.toBeInstanceOf(ProviderValidationError)
  })

  it('clears the credential when credential patch is null', async () => {
    const deps = fakeDeps({
      repo: { update: async (_p, _id, fields, updatedAt) => providerRecord({ ...fields, updatedAt }) },
    })
    const updated = await updateProvider(deps, auth, providerRecord({ credentialId: 'cred_1' }), {
      credential: { credentialId: null, credentialVersionId: null },
    })
    expect(updated.credentialId).toBeNull()
  })

  it('clears existing defaults when promoting a provider to default via update', async () => {
    let cleared = false
    const deps = fakeDeps({
      repo: {
        clearDefaults: async () => {
          cleared = true
        },
      },
    })
    await updateProvider(deps, auth, providerRecord({ isDefault: false }), { isDefault: true })
    expect(cleared).toBe(true)
  })

  it('retains existing baseUrl when patch does not include baseUrl', async () => {
    const deps = fakeDeps({
      repo: { update: async (_p, _id, fields, updatedAt) => providerRecord({ ...fields, updatedAt }) },
    })
    const updated = await updateProvider(
      deps,
      auth,
      providerRecord({ type: 'openai-compatible', baseUrl: 'https://existing.example/v1' }),
      { displayName: 'Renamed' },
    )
    expect(updated.baseUrl).toBe('https://existing.example/v1')
  })

  it('updates baseUrl when explicitly included in the patch', async () => {
    const deps = fakeDeps({
      repo: { update: async (_p, _id, fields, updatedAt) => providerRecord({ ...fields, updatedAt }) },
    })
    const updated = await updateProvider(
      deps,
      auth,
      providerRecord({ type: 'openai-compatible', baseUrl: 'https://old.example/v1' }),
      { baseUrl: 'https://new.example/v1' },
    )
    expect(updated.baseUrl).toBe('https://new.example/v1')
  })
})

describe('[spec: providers/delete] deleteProvider', () => {
  it('rejects deleting a provider still referenced by agents', async () => {
    const deps = fakeDeps({ repo: { agentReferences: async () => true } })
    await expect(deleteProvider(deps, auth, providerRecord())).rejects.toBeInstanceOf(ProviderReferencedError)
  })

  it('deletes an unreferenced provider', async () => {
    let deleted = false
    const deps = fakeDeps({
      repo: {
        delete: async () => {
          deleted = true
        },
      },
    })
    await deleteProvider(deps, auth, providerRecord())
    expect(deleted).toBe(true)
  })
})

describe('[spec: providers/discovery] runModelDiscovery', () => {
  it('discovers the Workers AI catalog from the binding default', async () => {
    const upserted: string[] = []
    const deps = fakeDeps({
      repo: {
        upsertModel: async (input) => {
          upserted.push(input.modelId)
          return { record: modelRecord(input.modelId), created: true }
        },
      },
    })
    const result = await runModelDiscovery(deps, auth, providerRecord({ type: 'workers-ai' }), '@cf/test/model')
    expect(result.outcome).toBe('succeeded')
    expect(result.discoveredCount).toBe(1)
    expect(upserted).toEqual(['@cf/test/model'])
  })

  it('upserts every fetched model and marks the task succeeded', async () => {
    const deps = fakeDeps({
      catalog: {
        fetchCatalog: async () => [
          {
            modelId: 'a',
            displayName: 'A',
            capabilities: ['text'],
            contextWindow: null,
            pricing: {},
            availability: 'available',
            metadata: {},
          },
          {
            modelId: 'b',
            displayName: 'B',
            capabilities: ['text'],
            contextWindow: 8000,
            pricing: {},
            availability: 'available',
            metadata: {},
          },
        ],
      },
    })
    const result = await runModelDiscovery(
      deps,
      auth,
      providerRecord({ type: 'openai-compatible', baseUrl: 'https://x/v1' }),
      undefined,
    )
    expect(result.outcome).toBe('succeeded')
    expect(result.discoveredCount).toBe(2)
  })

  it('normalizes a fetch failure into a failed task with a stable category', async () => {
    let catalogStatus: { modelCatalogState: string } | null = null
    const deps = fakeDeps({
      catalog: {
        fetchCatalog: async () => {
          throw Object.assign(new Error('HTTP 404'), { status: 404 })
        },
      },
      repo: {
        setCatalogStatus: async (_p, _id, status) => {
          catalogStatus = status
        },
      },
    })
    const result = await runModelDiscovery(
      deps,
      auth,
      providerRecord({ type: 'openai-compatible', baseUrl: 'https://x/v1' }),
      undefined,
    )
    expect(result.outcome).toBe('failed')
    expect(result.category).toBe('model_unavailable')
    expect(catalogStatus).toMatchObject({ modelCatalogState: 'error' })
  })

  it('uses the built-in Workers AI default model when defaultModel is undefined', async () => {
    const upserted: string[] = []
    const deps = fakeDeps({
      repo: {
        upsertModel: async (input) => {
          upserted.push(input.modelId)
          return { record: modelRecord(input.modelId), created: true }
        },
      },
    })
    const result = await runModelDiscovery(deps, auth, providerRecord({ type: 'workers-ai' }), undefined)
    expect(result.outcome).toBe('succeeded')
    expect(upserted[0]).toMatch(/^@cf\//)
  })

  it('includes retryAfterSeconds in the failed task error when the provider returns a retry hint', async () => {
    let savedError: Record<string, unknown> | null = null
    const deps = fakeDeps({
      catalog: {
        fetchCatalog: async () => {
          throw Object.assign(new Error('Rate limit'), { status: 429, retryAfterSeconds: 30 })
        },
      },
      repo: {
        updateDiscoveryTask: async (_p, _id, fields, updatedAt) => {
          savedError = fields.error as Record<string, unknown>
          return taskRecord({ state: fields.state ?? 'failed', error: fields.error, updatedAt })
        },
      },
    })
    const result = await runModelDiscovery(
      deps,
      auth,
      providerRecord({ type: 'openai-compatible', baseUrl: 'https://x/v1' }),
      undefined,
    )
    expect(result.outcome).toBe('failed')
    expect(savedError).toMatchObject({ retryAfterSeconds: 30 })
  })
})
