import { describe, expect, it } from 'vitest'
import { createConnection, executeToolCall, listConnectionTools, updateConnection } from './connections'
import type { Deps } from './deps'
import {
  type AuthScope,
  ConnectionConflictError,
  ConnectionPolicyDeniedError,
  type ConnectionRecord,
  type ConnectionToolRecord,
  ConnectionValidationError,
  type ConnectorRecord,
  type ToolCallRecord,
} from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function connector(overrides: Partial<ConnectorRecord> = {}): ConnectorRecord {
  return {
    id: 'github',
    name: 'GitHub',
    description: '',
    category: 'development',
    trustLevel: 'verified',
    capabilities: [],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: [],
    tools: [],
    metadata: {},
    availability: 'available',
    createdAt: 'T',
    updatedAt: 'T',
    ...overrides,
  }
}

function connection(overrides: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: 'conn_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    connectorId: 'github',
    credentialId: 'cred_1',
    credentialVersionId: 'ver_1',
    endpointUrl: 'https://mcp.example/mcp',
    approvalMode: 'project_policy',
    state: 'connected',
    lastError: null,
    metadata: {},
    connectedAt: 'T',
    disconnectedAt: null,
    createdAt: 'T',
    updatedAt: 'T',
    ...overrides,
  }
}

function tool(overrides: Partial<ConnectionToolRecord> = {}): ConnectionToolRecord {
  return {
    id: 'contool_1',
    connectionId: 'conn_1',
    connectorId: 'github',
    name: 'repo.read',
    description: null,
    inputSchema: {},
    approvalMode: 'project_policy',
    policyMetadata: {},
    availability: 'available',
    createdAt: 'T',
    updatedAt: 'T',
    ...overrides,
  }
}

const session = { id: 'sess_1', agentSnapshot: null, environmentSnapshot: null }

function fakeDeps(
  overrides: {
    connections?: Partial<Deps['connections']>
    mcp?: Partial<Deps['mcp']>
    policy?: Partial<Deps['policy']>
    sessionEvents?: Partial<Deps['sessionEvents']>
  } = {},
): Deps {
  const connections: Deps['connections'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    findByConnector: async () => null,
    insert: async (input, timestamp) => connection({ id: 'conn_new', ...input, connectedAt: timestamp }),
    update: async (id, fields) => connection({ id, ...fields }),
    resolveCredential: async () => ({ credentialId: 'cred_1', credentialVersionId: 'ver_1' }),
    findSession: async () => session,
    listTools: async () => [],
    findTool: async () => null,
    replaceCatalogTools: async () => {},
    replaceServerTools: async () => {},
    insertToolCall: async (execution): Promise<ToolCallRecord> => ({
      id: execution.id,
      connectionId: execution.connectionId,
      connectorId: execution.connectorId,
      toolName: execution.toolName,
      sessionId: execution.sessionId,
      state: execution.state,
      input: execution.input,
      output: execution.output,
      error: execution.error,
      durationMs: execution.durationMs,
      createdAt: execution.createdAt,
    }),
    listToolCalls: async () => ({ rows: [], hasMore: false }),
    findToolCall: async () => null,
    ...overrides.connections,
  }
  const mcp: Deps['mcp'] = {
    upstreamError: { type: 'mcp_upstream_error', message: 'MCP tool call failed.' },
    normalizeError: () => ({ type: 'mcp_network_error', message: 'MCP server could not be reached.' }),
    validateToolInput: () => {},
    listTools: async () => [],
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: null, isError: false }),
    ...overrides.mcp,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: undefined as unknown as Deps['environments'],
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    connections,
    policies: undefined as unknown as Deps['policies'],
    budgets: undefined as unknown as Deps['budgets'],
    mcp,
    sessionEvents: { append: async () => 'event_1', ...overrides.sessionEvents },
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
      ...overrides.policy,
    },
  }
}

describe('[spec: connections/create] createConnection', () => {
  it('rejects an unavailable connector', async () => {
    await expect(
      createConnection(fakeDeps(), auth, connector({ availability: 'unavailable' }), input()),
    ).rejects.toBeInstanceOf(ConnectionConflictError)
  })

  it('denies a governance-blocked connector', async () => {
    const deps = fakeDeps({ policy: { resolveMcpPolicy: async () => ({ blockedConnectors: ['github'] }) } })
    await expect(createConnection(deps, auth, connector(), input())).rejects.toBeInstanceOf(ConnectionPolicyDeniedError)
  })

  it('rejects a duplicate connection for the same connector', async () => {
    const deps = fakeDeps({ connections: { findByConnector: async () => connection() } })
    await expect(createConnection(deps, auth, connector(), input())).rejects.toBeInstanceOf(ConnectionConflictError)
  })

  it('requires a vault credential for connectors that need one', async () => {
    const deps = fakeDeps({
      connections: { resolveCredential: async () => ({ credentialId: null, credentialVersionId: null }) },
    })
    await expect(createConnection(deps, auth, connector(), { ...input(), credentialRef: null })).rejects.toBeInstanceOf(
      ConnectionValidationError,
    )
  })

  it('seeds catalog tools after persisting the connection', async () => {
    let seeded = false
    const deps = fakeDeps({
      connections: {
        replaceCatalogTools: async () => {
          seeded = true
        },
      },
    })
    const created = await createConnection(deps, auth, connector({ tools: [] }), input())
    expect(created.connectorId).toBe('github')
    expect(seeded).toBe(true)
  })
})

describe('[spec: connections/tools] listConnectionTools', () => {
  it('rejects a connection that is not connected', async () => {
    await expect(listConnectionTools(fakeDeps(), connection({ state: 'disabled' }))).rejects.toBeInstanceOf(
      ConnectionConflictError,
    )
  })

  it('syncs from the MCP server when an endpoint is configured', async () => {
    let synced = false
    const deps = fakeDeps({
      mcp: { listTools: async () => [{ name: 'repo.read', description: null, inputSchema: {} }] },
      connections: {
        replaceServerTools: async () => {
          synced = true
        },
        listTools: async () => [tool()],
      },
    })
    const tools = await listConnectionTools(deps, connection())
    expect(synced).toBe(true)
    expect(tools).toHaveLength(1)
  })

  it('serves catalog tools without syncing for endpoint-less connections', async () => {
    let synced = false
    const deps = fakeDeps({
      connections: {
        replaceServerTools: async () => {
          synced = true
        },
        listTools: async () => [tool()],
      },
    })
    await listConnectionTools(deps, connection({ endpointUrl: null }))
    expect(synced).toBe(false)
  })
})

describe('[spec: connections/tool-call] executeToolCall', () => {
  it('returns a denied outcome and records the policy decision event', async () => {
    let decisionEvent = false
    const deps = fakeDeps({
      policy: {
        evaluateMcpTool: async () => ({ allowed: false, category: 'mcp', rule: 'github', message: 'blocked' }),
      },
      sessionEvents: {
        append: async (values) => {
          if (values.type === 'policy.decision') decisionEvent = true
          return 'event_1'
        },
      },
    })
    const outcome = await executeToolCall(deps, auth, connection(), session, tool(), 'repo.read', {})
    expect(outcome.kind).toBe('denied')
    expect(decisionEvent).toBe(true)
  })

  it('returns endpoint_missing when allowed but no endpoint is configured', async () => {
    const outcome = await executeToolCall(
      fakeDeps(),
      auth,
      connection({ endpointUrl: null }),
      session,
      tool(),
      'repo.read',
      {},
    )
    expect(outcome.kind).toBe('endpoint_missing')
  })

  it('persists a success record and emits start/end events', async () => {
    const events: string[] = []
    const deps = fakeDeps({
      sessionEvents: {
        append: async (v) => {
          events.push(v.type)
          return 'event_1'
        },
      },
    })
    const outcome = await executeToolCall(deps, auth, connection(), session, tool(), 'repo.read', { repo: 'x' })
    expect(outcome.kind).toBe('completed')
    if (outcome.kind === 'completed') {
      expect(outcome.record.state).toBe('success')
    }
    expect(events).toEqual(['policy.decision', 'tool_execution_start', 'tool_execution_end'])
  })

  it('persists an error record when the MCP call fails', async () => {
    const deps = fakeDeps({
      mcp: {
        callTool: async () => {
          throw new Error('boom')
        },
        normalizeError: () => ({ type: 'mcp_upstream_error', message: 'MCP tool call failed.' }),
      },
    })
    const outcome = await executeToolCall(deps, auth, connection(), session, tool(), 'repo.read', {})
    expect(outcome.kind).toBe('completed')
    if (outcome.kind === 'completed') {
      expect(outcome.record.state).toBe('error')
      expect(outcome.record.error?.type).toBe('mcp_upstream_error')
    }
  })

  it('emits policy.decision with tool resource type when category is tool', async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = []
    const deps = fakeDeps({
      policy: {
        evaluateMcpTool: async () => ({ allowed: false, category: 'tool', rule: 'blocked-tool', message: 'blocked' }),
      },
      sessionEvents: {
        append: async (v) => {
          events.push({ type: v.type, payload: v.payload as Record<string, unknown> })
          return 'event_1'
        },
      },
    })
    const outcome = await executeToolCall(deps, auth, connection(), session, tool(), 'repo.read', {})
    expect(outcome.kind).toBe('denied')
    const decisionEvent = events.find((e) => e.type === 'policy.decision')
    expect(decisionEvent?.payload.resourceType).toBe('tool')
    expect(decisionEvent?.payload.resourceId).toBe('repo.read')
  })

  it('includes structuredContent in the output when the MCP call returns it', async () => {
    const deps = fakeDeps({
      mcp: {
        callTool: async () => ({
          content: [{ type: 'text', text: 'result' }],
          structuredContent: { score: 0.9 },
          isError: false,
        }),
      },
    })
    const outcome = await executeToolCall(deps, auth, connection(), session, tool(), 'repo.read', {})
    expect(outcome.kind).toBe('completed')
    if (outcome.kind === 'completed') {
      expect(outcome.record.output).toMatchObject({ structuredContent: { score: 0.9 } })
    }
  })
})

describe('[spec: connections/tools] listConnectionTools — timeout metadata', () => {
  it('uses a custom requestTimeoutMs from connection metadata when syncing tools', async () => {
    const targets: { timeoutMs: number }[] = []
    const deps = fakeDeps({
      mcp: {
        listTools: async (target) => {
          targets.push(target as { timeoutMs: number })
          return []
        },
      },
      connections: { listTools: async () => [] },
    })
    await listConnectionTools(deps, connection({ metadata: { requestTimeoutMs: 5000 } }))
    expect(targets[0]!.timeoutMs).toBe(5000)
  })
})

describe('[spec: connections/create] createConnection — credential error branches', () => {
  it('wraps a non-Error resolve failure as a ConnectionConflictError', async () => {
    const deps = fakeDeps({
      connections: {
        resolveCredential: async () => {
          throw 'string error'
        },
      },
    })
    await expect(createConnection(deps, auth, connector(), input())).rejects.toBeInstanceOf(ConnectionConflictError)
  })

  it('includes the Error message when resolveCredential throws an Error instance during create', async () => {
    const deps = fakeDeps({
      connections: {
        resolveCredential: async () => {
          throw new Error('credential lookup failed')
        },
      },
    })
    const error = await createConnection(deps, auth, connector(), input()).catch((e) => e)
    expect(error).toBeInstanceOf(ConnectionConflictError)
    expect(error.message).toContain('credential lookup failed')
  })
})

describe('[spec: connections/update] updateConnection', () => {
  it('rejects clearing a required credential', async () => {
    const deps = fakeDeps({
      connections: { resolveCredential: async () => ({ credentialId: null, credentialVersionId: null }) },
    })
    await expect(
      updateConnection(deps, auth, connection(), connector(), { credentialRef: null }),
    ).rejects.toBeInstanceOf(ConnectionValidationError)
  })

  it('applies a state transition', async () => {
    const deps = fakeDeps({ connections: { update: async (id, fields) => connection({ id, ...fields }) } })
    const updated = await updateConnection(deps, auth, connection(), connector(), { state: 'disconnected' })
    expect(updated.state).toBe('disconnected')
    expect(updated.disconnectedAt).not.toBeNull()
  })

  it('wraps a non-Error resolve failure during update as a ConnectionConflictError', async () => {
    const deps = fakeDeps({
      connections: {
        resolveCredential: async () => {
          throw 'string error'
        },
      },
    })
    await expect(
      updateConnection(deps, auth, connection(), connector(), { credentialRef: { credentialId: 'cred_new' } }),
    ).rejects.toBeInstanceOf(ConnectionConflictError)
  })

  it('includes the Error message when resolveCredential throws an Error instance during update', async () => {
    const deps = fakeDeps({
      connections: {
        resolveCredential: async () => {
          throw new Error('update credential lookup failed')
        },
      },
    })
    const error = await updateConnection(deps, auth, connection(), connector(), {
      credentialRef: { credentialId: 'cred_new' },
    }).catch((e) => e)
    expect(error).toBeInstanceOf(ConnectionConflictError)
    expect(error.message).toContain('update credential lookup failed')
  })

  it('resolves a new credential when credentialRef is provided in the update patch', async () => {
    const deps = fakeDeps({
      connections: {
        resolveCredential: async () => ({ credentialId: 'cred_new', credentialVersionId: 'ver_new' }),
        update: async (id, fields) => connection({ id, ...fields }),
      },
    })
    const updated = await updateConnection(deps, auth, connection(), connector(), {
      credentialRef: { credentialId: 'cred_new' },
    })
    expect(updated.credentialId).toBe('cred_new')
  })

  it('retains existing state when patch does not specify state', async () => {
    const deps = fakeDeps({ connections: { update: async (id, fields) => connection({ id, ...fields }) } })
    const updated = await updateConnection(deps, auth, connection({ state: 'connected' }), connector(), {
      endpointUrl: 'https://new.example/mcp',
    })
    expect(updated.state).toBe('connected')
  })

  it('retains existing endpointUrl when patch does not include endpointUrl', async () => {
    const deps = fakeDeps({ connections: { update: async (id, fields) => connection({ id, ...fields }) } })
    const updated = await updateConnection(deps, auth, connection(), connector(), { approvalMode: 'per_call' })
    expect(updated.endpointUrl).toBe('https://mcp.example/mcp')
  })

  it('sets endpointUrl to null when explicitly patched to null', async () => {
    const deps = fakeDeps({ connections: { update: async (id, fields) => connection({ id, ...fields }) } })
    const updated = await updateConnection(deps, auth, connection(), connector(), { endpointUrl: null })
    expect(updated.endpointUrl).toBeNull()
  })
})

function input() {
  return {
    connectorId: 'github',
    endpointUrl: 'https://mcp.example/mcp',
    credentialRef: { credentialId: 'cred_1' },
    approvalMode: undefined,
    metadata: {},
  }
}
