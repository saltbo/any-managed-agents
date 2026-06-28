import type { EnvironmentConfig } from '@server/domain/environment'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { createEnvironment, updateEnvironment } from './environments'
import {
  type AuthScope,
  EnvironmentArchivedError,
  type EnvironmentRecord,
  EnvironmentValidationError,
  type EnvironmentVersionRecord,
} from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function config(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    packages: [],
    variables: {},
    credentialRefs: [],
    hostingMode: 'cloud',
    networkPolicy: { mode: 'unrestricted' },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: {},
    runtimeConfig: {},
    metadata: {},
    ...overrides,
  }
}

function environmentRecord(overrides: Partial<EnvironmentRecord> = {}): EnvironmentRecord {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Workspace',
    description: null,
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...config(),
    ...overrides,
  }
}

function fakeDeps(overrides: { repo?: Partial<Deps['environments']> } = {}): Deps {
  const repo: Deps['environments'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insertVersion: async (environment, cfg, createdAt): Promise<EnvironmentVersionRecord> => ({
      id: 'envver_new',
      environmentId: environment.id,
      projectId: environment.projectId,
      version: 2,
      createdAt,
      ...cfg,
    }),
    listVersions: async () => [],
    findVersion: async () => null,
    insert: async (input, createdAt): Promise<EnvironmentRecord> =>
      environmentRecord({
        id: 'env_new',
        currentVersionId: null,
        version: 0,
        name: input.name,
        description: input.description,
        createdAt,
        updatedAt: createdAt,
        ...input.config,
      }),
    setCurrentVersion: async () => {},
    update: async () => {},
    unarchive: async () => {},
    credentialActive: async () => true,
    credentialVersionUsable: async () => true,
    connectorConnected: async () => true,
    ...overrides.repo,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: repo,
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    connections: undefined as unknown as Deps['connections'],
    policies: undefined as unknown as Deps['policies'],
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

describe('[spec: environments/create] createEnvironment', () => {
  it('inserts the environment, snapshots version 1, and sets it current', async () => {
    const setCurrent: string[] = []
    const deps = fakeDeps({
      repo: { setCurrentVersion: async (_id, versionId) => void setCurrent.push(versionId) },
    })
    const environment = await createEnvironment(deps, auth, { name: 'Node', description: null, config: config() })
    expect(environment.currentVersionId).toBe('envver_new')
    expect(environment.version).toBe(2)
    expect(setCurrent).toEqual(['envver_new'])
  })

  it('rejects an inactive credential reference', async () => {
    const deps = fakeDeps({ repo: { credentialActive: async () => false } })
    await expect(
      createEnvironment(deps, auth, {
        name: 'x',
        description: null,
        config: config({ credentialRefs: [{ credentialId: 'cred_missing' }] }),
      }),
    ).rejects.toMatchObject({ fields: { 'credentialRefs[0]': expect.any(String) } })
  })

  it('rejects an unusable pinned credential version', async () => {
    const deps = fakeDeps({ repo: { credentialVersionUsable: async () => false } })
    await expect(
      createEnvironment(deps, auth, {
        name: 'x',
        description: null,
        config: config({ credentialRefs: [{ credentialId: 'cred_1', versionId: 'credver_bad' }] }),
      }),
    ).rejects.toMatchObject({ fields: { 'credentialRefs[0]': expect.any(String) } })
  })

  it('rejects a disconnected mcp connector', async () => {
    const deps = fakeDeps({ repo: { connectorConnected: async () => false } })
    await expect(
      createEnvironment(deps, auth, {
        name: 'x',
        description: null,
        config: config({ mcpPolicy: { allowedConnectors: ['linear'] } }),
      }),
    ).rejects.toMatchObject({ fields: { mcpPolicy: expect.any(String) } })
  })

  it('rejects secret material in free-form config objects', async () => {
    await expect(
      createEnvironment(fakeDeps(), auth, {
        name: 'x',
        description: null,
        config: config({ metadata: { apiKey: 'raw-secret' } }),
      }),
    ).rejects.toBeInstanceOf(EnvironmentValidationError)
  })
})

describe('[spec: environments/update] updateEnvironment', () => {
  it('snapshots a new version when a runtime field changes', async () => {
    const inserted: EnvironmentConfig[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (environment, cfg, createdAt) => {
          inserted.push(cfg)
          return {
            id: 'envver_2',
            environmentId: environment.id,
            projectId: environment.projectId,
            version: 2,
            createdAt,
            ...cfg,
          }
        },
      },
    })
    const result = await updateEnvironment(deps, auth, environmentRecord(), { packages: [{ name: 'vite' }] })
    expect(inserted).toHaveLength(1)
    expect(result.environment.version).toBe(2)
    expect(result.environment.currentVersionId).toBe('envver_2')
  })

  it('does not snapshot when only name/description change', async () => {
    let versioned = false
    const deps = fakeDeps({
      repo: {
        insertVersion: async (environment, cfg, createdAt) => {
          versioned = true
          return {
            id: 'x',
            environmentId: environment.id,
            projectId: environment.projectId,
            version: 2,
            createdAt,
            ...cfg,
          }
        },
      },
    })
    const result = await updateEnvironment(deps, auth, environmentRecord(), { name: 'Renamed' })
    expect(versioned).toBe(false)
    expect(result.environment.version).toBe(1)
    expect(result.environment.name).toBe('Renamed')
  })

  it('archives via {archived:true} and reports the transition', async () => {
    const result = await updateEnvironment(fakeDeps(), auth, environmentRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.environment.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived environment', async () => {
    await expect(
      updateEnvironment(fakeDeps(), auth, environmentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }), {
        packages: [{ name: 'x' }],
      }),
    ).rejects.toBeInstanceOf(EnvironmentArchivedError)
  })

  it('unarchives an archived environment via {archived:false}', async () => {
    const result = await updateEnvironment(
      fakeDeps(),
      auth,
      environmentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      {
        archived: false,
      },
    )
    expect(result.environment.archivedAt).toBeNull()
    expect(result.unarchived).toBe(true)
  })

  it('is a no-op when patching an archived environment with archived:true', async () => {
    const archived = environmentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' })
    const result = await updateEnvironment(fakeDeps(), auth, archived, { archived: true })
    expect(result.environment.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.archived).toBe(false)
    expect(result.unarchived).toBe(false)
  })

  it('is a no-op when patching an archived environment with an empty patch', async () => {
    const archived = environmentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' })
    const result = await updateEnvironment(fakeDeps(), auth, archived, {})
    expect(result.environment.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.unarchived).toBe(false)
  })
})

describe('[spec: environments/create] createEnvironment — secret variables', () => {
  it('rejects secret material in environment variables', async () => {
    await expect(
      createEnvironment(fakeDeps(), auth, {
        name: 'x',
        description: null,
        // Deliberately malformed: a raw string where a variable descriptor is
        // expected — the create path must reject it at the input boundary.
        config: config({ variables: { API_KEY: 'raw-secret' } as unknown as EnvironmentConfig['variables'] }),
      }),
    ).rejects.toBeInstanceOf(EnvironmentValidationError)
  })

  it('accepts a pinned credential version when it is usable', async () => {
    const environment = await createEnvironment(fakeDeps(), auth, {
      name: 'Pinned',
      description: null,
      config: config({ credentialRefs: [{ credentialId: 'cred_1', versionId: 'credver_1' }] }),
    })
    expect(environment.credentialRefs).toHaveLength(1)
  })

  it('accepts environments with connected mcp connectors in the mcp policy', async () => {
    const environment = await createEnvironment(fakeDeps(), auth, {
      name: 'With MCP',
      description: null,
      config: config({ mcpPolicy: { allowedConnectors: ['linear'] } }),
    })
    expect(environment.mcpPolicy).toMatchObject({ allowedConnectors: ['linear'] })
  })
})

describe('[spec: environments/update] updateEnvironment — description branch', () => {
  it('explicitly sets description to null when provided in patch', async () => {
    const result = await updateEnvironment(fakeDeps(), auth, environmentRecord({ description: 'old desc' }), {
      description: null,
    })
    expect(result.environment.description).toBeNull()
  })

  it('explicitly sets description to a string when provided in patch', async () => {
    const result = await updateEnvironment(fakeDeps(), auth, environmentRecord({ description: null }), {
      description: 'new desc',
    })
    expect(result.environment.description).toBe('new desc')
  })
})
