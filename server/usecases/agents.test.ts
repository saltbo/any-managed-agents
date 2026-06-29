import type { Agent, AgentConfig, AgentMemory, AgentVersion } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import { describe, expect, it } from 'vitest'
import { createAgent, readAgentMemory, replaceAgentMemory, resolveHandoffCandidates, updateAgent } from './agents'
import type { Deps } from './deps'
import { AgentArchivedError, AgentValidationError, type AuditEntry, type AuthScope } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function config(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    instructions: null,
    providerId: null,
    model: null,
    skills: [],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: { enabled: false },
    tools: [],
    mcpConnectors: [],
    metadata: {},
    ...overrides,
  }
}

function agentRecord(
  overrides: {
    metadata?: Partial<Agent['metadata']>
    spec?: Partial<Agent['spec']>
    status?: Partial<Agent['status']>
  } = {},
): Agent {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'agent_1',
        pid: 'project_1',
        name: 'Agent',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: { ...config(), ...overrides.spec },
    status: { phase: 'active', currentVersionId: 'agentver_1', version: 1, ...overrides.status },
  }
}

function agentVersion(
  agent: Agent,
  cfg: AgentConfig,
  createdAt: string,
  values: Partial<AgentVersion> = {},
): AgentVersion {
  return {
    metadata: resourceMetadata({
      uid: 'agentver_new',
      pid: agent.metadata.pid,
      name: 'v2',
      createdAt,
      updatedAt: createdAt,
    }),
    spec: cfg,
    status: { agentId: agent.metadata.uid, version: 2 },
    ...values,
  }
}

function memoryRecord(content: string, metadata: Record<string, unknown> = {}): AgentMemory {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: resourceMetadata({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'memory',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: { agentId: 'agent_1', content, metadata },
    status: { phase: 'active' },
  }
}

// A hand-written fake repo. Each spy records calls; behavior is overridable.
function fakeDeps(
  overrides: { repo?: Partial<Deps['agents']>; toolPolicy?: Record<string, unknown>; audit?: AuditEntry[] } = {},
): Deps {
  const auditLog = overrides.audit ?? []
  const repo: Deps['agents'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    liveAgents: async () => [],
    latestVersionNumber: async () => null,
    insertVersion: async (agent, cfg, createdAt): Promise<AgentVersion> => agentVersion(agent, cfg, createdAt),
    listVersions: async () => [],
    findVersion: async () => null,
    insert: async (input, createdAt): Promise<Agent> =>
      agentRecord({
        metadata: {
          uid: 'agent_new',
          name: input.name,
          description: input.description,
          createdAt,
          updatedAt: createdAt,
        },
        spec: input.config,
        status: { currentVersionId: null, version: 0 },
      }),
    setCurrentVersion: async () => {},
    update: async () => {},
    unarchive: async () => {},
    findMemory: async () => null,
    insertMemory: async () => {},
    replaceMemory: async () => {},
    providerEnabled: async () => true,
    connectorAvailable: async () => true,
    ...overrides.repo,
  }
  return {
    agents: repo,
    // The agents usecase never reaches for these ports; the fakes only satisfy
    // the aggregate Deps shape.
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
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
    audit: { record: async (_auth, entry) => void auditLog.push(entry) },
    policy: {
      resolveToolPolicy: async () => overrides.toolPolicy ?? {},
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

describe('[spec: agents/create] createAgent', () => {
  it('inserts the agent, snapshots version 1, and sets it current', async () => {
    const setCurrent: string[] = []
    const deps = fakeDeps({
      repo: { setCurrentVersion: async (_agentId, versionId) => void setCurrent.push(versionId) },
    })
    const agent = await createAgent(deps, auth, { name: 'Research', description: null, config: config() })
    expect(agent.status.currentVersionId).toBe('agentver_new')
    expect(agent.status.version).toBe(2)
    expect(setCurrent).toEqual(['agentver_new'])
  })

  it('rejects a disabled provider reference', async () => {
    const deps = fakeDeps({ repo: { providerEnabled: async () => false } })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, config: config({ providerId: 'provider_x' }) }),
    ).rejects.toMatchObject({ fields: { providerId: expect.any(String) } })
  })

  it('accepts a non-catalog model — model validity is resolved at session creation', async () => {
    // A self-hosted agent legitimately pins a runner-native model id (e.g. `opus`)
    // that never appears in the global catalog; createAgent must not reject it.
    const agent = await createAgent(fakeDeps(), auth, {
      name: 'x',
      description: null,
      config: config({ providerId: 'provider_x', model: 'opus' }),
    })
    expect(agent.spec.model).toBe('opus')
  })

  it('rejects a disconnected mcp connector', async () => {
    const deps = fakeDeps({ repo: { connectorAvailable: async () => false } })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, config: config({ mcpConnectors: ['github'] }) }),
    ).rejects.toMatchObject({ fields: { mcpConnectors: expect.any(String) } })
  })

  it('resolves the tool policy only when tools are present', async () => {
    let resolved = 0
    const deps: Deps = {
      ...fakeDeps(),
      policy: {
        resolveToolPolicy: async () => {
          resolved += 1
          return {}
        },
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
    await createAgent(deps, auth, { name: 'x', description: null, config: config() })
    expect(resolved).toBe(0)
    await createAgent(deps, auth, {
      name: 'y',
      description: null,
      config: config({
        tools: [
          { name: 'web.search', description: null, inputSchema: {}, approvalMode: 'per_call', policyMetadata: {} },
        ],
      }),
    })
    expect(resolved).toBe(1)
  })

  it('rejects a policy-blocked tool', async () => {
    const deps = fakeDeps({ toolPolicy: { blockedTools: ['repo.delete'] } })
    await expect(
      createAgent(deps, auth, {
        name: 'x',
        description: null,
        config: config({
          tools: [
            {
              name: 'repo.delete',
              description: null,
              inputSchema: {},
              approvalMode: 'project_policy',
              policyMetadata: {},
            },
          ],
        }),
      }),
    ).rejects.toMatchObject({ fields: { tools: expect.stringContaining('blocked') } })
  })

  it('rejects an invalid skill reference format', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        config: config({ skills: ['not-a-valid-skill'] }),
      }),
    ).rejects.toMatchObject({ fields: { skills: expect.any(String) } })
  })

  it('rejects raw secret material in subagents', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        config: config({ subagents: [{ apiKey: 'raw-secret' }] }),
      }),
    ).rejects.toMatchObject({ fields: { subagents: expect.any(String) } })
  })

  it('rejects an invalid capability tag format', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        config: config({ capabilityTags: ['invalid tag with space'] }),
      }),
    ).rejects.toMatchObject({ fields: { capabilityTags: expect.any(String) } })
  })

  it('rejects raw secret material in handoffPolicy config secrets', async () => {
    await expect(
      createAgent(fakeDeps(), auth, {
        name: 'x',
        description: null,
        config: config({ handoffPolicy: { secretToken: 'raw-secret' } }),
      }),
    ).rejects.toMatchObject({ fields: expect.objectContaining({}) })
  })

  it('validates successfully when provider and model are both valid', async () => {
    const agent = await createAgent(fakeDeps(), auth, {
      name: 'x',
      description: null,
      config: config({ providerId: 'provider_x', model: 'gpt-4' }),
    })
    expect(agent.spec.providerId).toBe('provider_x')
    expect(agent.spec.model).toBe('gpt-4')
  })

  it('passes validation when a non-empty mcpConnectors list contains only catalog connectors', async () => {
    const agent = await createAgent(fakeDeps(), auth, {
      name: 'x',
      description: null,
      config: config({ mcpConnectors: ['github'] }),
    })
    expect(agent.spec.mcpConnectors).toEqual(['github'])
  })
})

describe('[spec: agents/update] updateAgent', () => {
  it('snapshots a new version when a runtime field changes', async () => {
    const inserted: AgentConfig[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, cfg, createdAt) => {
          inserted.push(cfg)
          return agentVersion(agent, cfg, createdAt, {
            metadata: resourceMetadata({
              uid: 'agentver_2',
              pid: agent.metadata.pid,
              name: 'v2',
              createdAt,
              updatedAt: createdAt,
            }),
          })
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { instructions: 'New' })
    expect(inserted).toHaveLength(1)
    expect(result.agent.status.version).toBe(2)
    expect(result.agent.status.currentVersionId).toBe('agentver_2')
    expect(result.agent.spec.instructions).toBe('New')
  })

  it('does not snapshot when only name/description change', async () => {
    let versioned = false
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, cfg, createdAt) => {
          versioned = true
          return agentVersion(agent, cfg, createdAt)
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { description: 'Just a description' })
    expect(versioned).toBe(false)
    expect(result.agent.status.version).toBe(1)
    expect(result.agent.metadata.description).toBe('Just a description')
  })

  it('archives via {archived:true} and reports the transition', async () => {
    const result = await updateAgent(deps(), auth, agentRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.agent.metadata.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived agent', async () => {
    await expect(
      updateAgent(
        deps(),
        auth,
        agentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
        { description: 'x' },
      ),
    ).rejects.toBeInstanceOf(AgentArchivedError)
  })

  it('unarchives an archived agent via {archived:false}', async () => {
    const result = await updateAgent(
      deps(),
      auth,
      agentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
      {
        archived: false,
      },
    )
    expect(result.agent.metadata.archivedAt).toBeNull()
  })

  it('merges metadata, dropping keys set to null', async () => {
    const result = await updateAgent(
      deps(),
      auth,
      agentRecord({ spec: { metadata: { owner: 'platform', remove: 'stale' } } }),
      {
        metadata: { owner: 'runtime', remove: null },
      },
    )
    expect(result.agent.spec.metadata).toEqual({ owner: 'runtime' })
  })

  function deps() {
    return fakeDeps()
  }
})

describe('[spec: agents/handoff] resolveHandoffCandidates', () => {
  const worker = agentRecord({
    metadata: { uid: 'agent_worker' },
    spec: { role: 'worker', capabilityTags: ['implementation'] },
  })
  const reviewer = agentRecord({ metadata: { uid: 'agent_reviewer' }, spec: { role: 'reviewer' } })

  it('resolves by an explicit requested role', async () => {
    const deps = fakeDeps({ repo: { liveAgents: async () => [worker, reviewer] } })
    const candidates = await resolveHandoffCandidates(
      deps,
      'project_1',
      agentRecord({ metadata: { uid: 'agent_lead' } }),
      {
        role: 'worker',
      },
    )
    expect(candidates.map((candidate) => candidate.id)).toEqual(['agent_worker'])
  })

  it('falls back to policy targets when no target is requested', async () => {
    const deps = fakeDeps({ repo: { liveAgents: async () => [worker, reviewer] } })
    const lead = agentRecord({
      metadata: { uid: 'agent_lead' },
      spec: { handoffPolicy: { targets: [{ capability: 'implementation' }] } },
    })
    const candidates = await resolveHandoffCandidates(deps, 'project_1', lead, {})
    expect(candidates.map((candidate) => candidate.id)).toEqual(['agent_worker'])
  })

  it('excludes the requesting agent from its own candidates', async () => {
    const self = agentRecord({
      metadata: { uid: 'agent_self' },
      spec: { role: 'worker', capabilityTags: ['implementation'] },
    })
    const deps = fakeDeps({ repo: { liveAgents: async () => [self, worker] } })
    const candidates = await resolveHandoffCandidates(deps, 'project_1', self, { role: 'worker' })
    expect(candidates.map((candidate) => candidate.id)).toEqual(['agent_worker'])
  })

  it('throws a validation error when no target is requested or configured', async () => {
    await expect(resolveHandoffCandidates(fakeDeps(), 'project_1', agentRecord(), {})).rejects.toBeInstanceOf(
      AgentValidationError,
    )
  })
})

describe('[spec: agents/memory] memory', () => {
  it('materializes an empty memory singleton on first read', async () => {
    const inserted: AgentMemory[] = []
    const deps = fakeDeps({ repo: { insertMemory: async (record) => void inserted.push(record) } })
    const memory = await readAgentMemory(deps, 'project_1', agentRecord())
    expect(memory.spec.content).toBe('')
    expect(inserted).toHaveLength(1)
  })

  it('replaces the whole singleton on PUT', async () => {
    const existing = memoryRecord('old', { keep: 'no' })
    const deps = fakeDeps({ repo: { findMemory: async () => existing } })
    const memory = await replaceAgentMemory(deps, 'project_1', agentRecord(), {
      content: 'new',
      metadata: { fresh: 'yes' },
    })
    expect(memory.spec.content).toBe('new')
    expect(memory.spec.metadata).toEqual({ fresh: 'yes' })
  })

  it('rejects secret material in memory metadata', async () => {
    await expect(
      replaceAgentMemory(fakeDeps(), 'project_1', agentRecord(), {
        content: 'x',
        metadata: { secretValue: 'raw-secret' },
      }),
    ).rejects.toMatchObject({ fields: { metadata: expect.any(String) } })
  })

  it('returns the existing memory record without inserting on read when it already exists', async () => {
    const existing = memoryRecord('stored content', { version: '2' })
    let insertCalled = false
    const deps = fakeDeps({
      repo: {
        findMemory: async () => existing,
        insertMemory: async () => {
          insertCalled = true
        },
      },
    })
    const memory = await readAgentMemory(deps, 'project_1', agentRecord())
    expect(memory.spec.content).toBe('stored content')
    expect(insertCalled).toBe(false)
  })

  it('inserts and returns a new singleton on first replace when no memory exists', async () => {
    const inserted: AgentMemory[] = []
    const deps = fakeDeps({
      repo: {
        findMemory: async () => null,
        insertMemory: async (record) => void inserted.push(record),
      },
    })
    const memory = await replaceAgentMemory(deps, 'project_1', agentRecord(), {
      content: 'initial',
      metadata: { created: true },
    })
    expect(memory.spec.content).toBe('initial')
    expect(memory.spec.metadata).toEqual({ created: true })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.spec.content).toBe('initial')
  })
})

describe('[spec: agents/update] updateAgent — archived idempotent', () => {
  it('is a no-op when patching an archived agent with archived:true', async () => {
    const archived = agentRecord({
      metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateAgent(fakeDeps(), auth, archived, { archived: true })
    expect(result.agent.metadata.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.archived).toBe(false)
  })

  it('is a no-op when patching an archived agent with an empty patch', async () => {
    const archived = agentRecord({
      metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateAgent(fakeDeps(), auth, archived, {})
    expect(result.agent.metadata.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.archived).toBe(false)
  })

  it('updates providerId, model, and role when explicitly patched', async () => {
    const result = await updateAgent(fakeDeps(), auth, agentRecord(), {
      providerId: 'provider_new',
      model: 'gpt-4',
      role: 'analyst',
    })
    expect(result.agent.spec.providerId).toBe('provider_new')
    expect(result.agent.spec.model).toBe('gpt-4')
    expect(result.agent.spec.role).toBe('analyst')
  })

  it('resolves a handoff by an explicit capability', async () => {
    const worker = agentRecord({
      metadata: { uid: 'agent_worker' },
      spec: { role: 'worker', capabilityTags: ['build'] },
    })
    const deps = fakeDeps({ repo: { liveAgents: async () => [worker] } })
    const candidates = await resolveHandoffCandidates(
      deps,
      'project_1',
      agentRecord({ metadata: { uid: 'agent_lead' } }),
      {
        capability: 'build',
      },
    )
    expect(candidates.map((c) => c.id)).toEqual(['agent_worker'])
  })
})
