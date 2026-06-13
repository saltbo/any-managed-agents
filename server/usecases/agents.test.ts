import type { AgentConfig } from '@server/domain/agent'
import { describe, expect, it } from 'vitest'
import { createAgent, readAgentMemory, replaceAgentMemory, resolveHandoffCandidates, updateAgent } from './agents'
import type { Deps } from './deps'
import {
  AgentArchivedError,
  type AgentMemoryRecord,
  type AgentRecord,
  AgentValidationError,
  type AgentVersionRecord,
  type AuditEntry,
  type AuthScope,
} from './ports'

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

function agentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Agent',
    description: null,
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...config(),
    ...overrides,
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
    insertVersion: async (agent, cfg, createdAt): Promise<AgentVersionRecord> => ({
      id: 'agentver_new',
      agentId: agent.id,
      projectId: agent.projectId,
      version: 2,
      createdAt,
      ...cfg,
    }),
    listVersions: async () => [],
    findVersion: async () => null,
    insert: async (input, createdAt): Promise<AgentRecord> =>
      agentRecord({
        id: 'agent_new',
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
    findMemory: async () => null,
    insertMemory: async () => {},
    replaceMemory: async () => {},
    providerEnabled: async () => true,
    modelAvailable: async () => true,
    connectorConnected: async () => true,
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
    connections: undefined as unknown as Deps['connections'],
    policies: undefined as unknown as Deps['policies'],
    accessRules: undefined as unknown as Deps['accessRules'],
    budgets: undefined as unknown as Deps['budgets'],
    mcp: undefined as unknown as Deps['mcp'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    projects: undefined as unknown as Deps['projects'],
    federatedTenants: undefined as unknown as Deps['federatedTenants'],
    sessionEvents: undefined as unknown as Deps['sessionEvents'],
    audit: { record: async (_auth, entry) => void auditLog.push(entry) },
    policy: {
      resolveToolPolicy: async () => overrides.toolPolicy ?? {},
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

describe('[spec: agents/create] createAgent', () => {
  it('inserts the agent, snapshots version 1, and sets it current', async () => {
    const setCurrent: string[] = []
    const deps = fakeDeps({
      repo: { setCurrentVersion: async (_agentId, versionId) => void setCurrent.push(versionId) },
    })
    const agent = await createAgent(deps, auth, { name: 'Research', description: null, config: config() })
    expect(agent.currentVersionId).toBe('agentver_new')
    expect(agent.version).toBe(2)
    expect(setCurrent).toEqual(['agentver_new'])
  })

  it('rejects a disabled provider reference', async () => {
    const deps = fakeDeps({ repo: { providerEnabled: async () => false } })
    await expect(
      createAgent(deps, auth, { name: 'x', description: null, config: config({ providerId: 'provider_x' }) }),
    ).rejects.toMatchObject({ fields: { providerId: expect.any(String) } })
  })

  it('rejects an unavailable model', async () => {
    const deps = fakeDeps({ repo: { modelAvailable: async () => false } })
    await expect(
      createAgent(deps, auth, {
        name: 'x',
        description: null,
        config: config({ providerId: 'provider_x', model: 'unknown' }),
      }),
    ).rejects.toMatchObject({ fields: { model: expect.any(String) } })
  })

  it('rejects a disconnected mcp connector', async () => {
    const deps = fakeDeps({ repo: { connectorConnected: async () => false } })
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
          accessRules: [],
          toolPolicy: {},
          mcpPolicy: {},
          sandboxPolicy: {},
        }),
        evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
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
})

describe('[spec: agents/update] updateAgent', () => {
  it('snapshots a new version when a runtime field changes', async () => {
    const inserted: AgentConfig[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, cfg, createdAt) => {
          inserted.push(cfg)
          return { id: 'agentver_2', agentId: agent.id, projectId: agent.projectId, version: 2, createdAt, ...cfg }
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { instructions: 'New' })
    expect(inserted).toHaveLength(1)
    expect(result.agent.version).toBe(2)
    expect(result.agent.currentVersionId).toBe('agentver_2')
    expect(result.agent.instructions).toBe('New')
  })

  it('does not snapshot when only name/description change', async () => {
    let versioned = false
    const deps = fakeDeps({
      repo: {
        insertVersion: async (agent, cfg, createdAt) => {
          versioned = true
          return { id: 'x', agentId: agent.id, projectId: agent.projectId, version: 2, createdAt, ...cfg }
        },
      },
    })
    const result = await updateAgent(deps, auth, agentRecord(), { description: 'Just a description' })
    expect(versioned).toBe(false)
    expect(result.agent.version).toBe(1)
    expect(result.agent.description).toBe('Just a description')
  })

  it('archives via {archived:true} and reports the transition', async () => {
    const result = await updateAgent(deps(), auth, agentRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.agent.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived agent', async () => {
    await expect(
      updateAgent(deps(), auth, agentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }), { description: 'x' }),
    ).rejects.toBeInstanceOf(AgentArchivedError)
  })

  it('unarchives an archived agent via {archived:false}', async () => {
    const result = await updateAgent(deps(), auth, agentRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }), {
      archived: false,
    })
    expect(result.agent.archivedAt).toBeNull()
  })

  it('merges metadata, dropping keys set to null', async () => {
    const result = await updateAgent(deps(), auth, agentRecord({ metadata: { owner: 'platform', remove: 'stale' } }), {
      metadata: { owner: 'runtime', remove: null },
    })
    expect(result.agent.metadata).toEqual({ owner: 'runtime' })
  })

  function deps() {
    return fakeDeps()
  }
})

describe('[spec: agents/handoff] resolveHandoffCandidates', () => {
  const worker = agentRecord({ id: 'agent_worker', role: 'worker', capabilityTags: ['implementation'] })
  const reviewer = agentRecord({ id: 'agent_reviewer', role: 'reviewer' })

  it('resolves by an explicit requested role', async () => {
    const deps = fakeDeps({ repo: { liveAgents: async () => [worker, reviewer] } })
    const candidates = await resolveHandoffCandidates(deps, 'project_1', agentRecord({ id: 'agent_lead' }), {
      role: 'worker',
    })
    expect(candidates.map((candidate) => candidate.id)).toEqual(['agent_worker'])
  })

  it('falls back to policy targets when no target is requested', async () => {
    const deps = fakeDeps({ repo: { liveAgents: async () => [worker, reviewer] } })
    const lead = agentRecord({ id: 'agent_lead', handoffPolicy: { targets: [{ capability: 'implementation' }] } })
    const candidates = await resolveHandoffCandidates(deps, 'project_1', lead, {})
    expect(candidates.map((candidate) => candidate.id)).toEqual(['agent_worker'])
  })

  it('excludes the requesting agent from its own candidates', async () => {
    const self = agentRecord({ id: 'agent_self', role: 'worker', capabilityTags: ['implementation'] })
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
    const inserted: AgentMemoryRecord[] = []
    const deps = fakeDeps({ repo: { insertMemory: async (record) => void inserted.push(record) } })
    const memory = await readAgentMemory(deps, 'project_1', agentRecord())
    expect(memory.content).toBe('')
    expect(inserted).toHaveLength(1)
  })

  it('replaces the whole singleton on PUT', async () => {
    const existing: AgentMemoryRecord = {
      agentId: 'agent_1',
      projectId: 'project_1',
      content: 'old',
      metadata: { keep: 'no' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const deps = fakeDeps({ repo: { findMemory: async () => existing } })
    const memory = await replaceAgentMemory(deps, 'project_1', agentRecord(), {
      content: 'new',
      metadata: { fresh: 'yes' },
    })
    expect(memory.content).toBe('new')
    expect(memory.metadata).toEqual({ fresh: 'yes' })
  })

  it('rejects secret material in memory metadata', async () => {
    await expect(
      replaceAgentMemory(fakeDeps(), 'project_1', agentRecord(), {
        content: 'x',
        metadata: { secretValue: 'raw-secret' },
      }),
    ).rejects.toMatchObject({ fields: { metadata: expect.any(String) } })
  })
})
