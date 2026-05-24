import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type {
  Agent,
  AuditRecord,
  AuthContext,
  Environment,
  GovernancePolicy,
  McpConnection,
  McpConnector,
  Provider,
  Session,
  SessionEvent,
  UsageSummary,
  Vault,
  VaultCredential,
} from './lib/api'

const now = '2026-05-23T00:00:00.000Z'
const authContext: AuthContext = {
  user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
  organization: { id: 'org_1', name: 'Acme' },
  project: { id: 'project_1', name: 'Control Plane' },
  roles: ['owner'],
  permissions: ['agents:write'],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function noContent() {
  return new Response(null, { status: 204 })
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: 'Runtime',
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: { NODE_ENV: { description: 'mode', required: false } },
    secretRefs: [{ name: 'npm_token', ref: 'secret:npm' }],
    networkPolicy: { mode: 'restricted' },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: { memoryMb: 1024 },
    runtimeImage: { image: 'node:24' },
    metadata: {},
    status: 'active',
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Coding agent',
    description: 'Runs tasks',
    instructions: 'Do the task',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    systemPrompt: 'Do the task',
    allowedTools: ['read', 'write'],
    mcpConnectors: [],
    sandboxPolicy: { network: 'enabled' },
    defaultEnvironmentId: 'env_1',
    metadata: {},
    status: 'active',
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: 'project_1',
      version: 1,
      instructions: 'Do the task',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      systemPrompt: 'Do the task',
      allowedTools: ['read', 'write'],
      mcpConnectors: [],
      sandboxPolicy: { network: 'enabled' },
      defaultEnvironmentId: 'env_1',
      metadata: {},
      createdAt: now,
    },
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: {
      ...environment(),
      environmentId: 'env_1',
      version: 1,
    },
    durableObjectName: 'session_1',
    sandboxId: 'sandbox_1',
    piRuntimeId: 'pi_1',
    piProcessId: 'process_1',
    runtimeEndpointPath: '/api/sessions/session_1/runtime',
    agentUrl: '/api/sessions/session_1/runtime',
    modelProvider: 'workers-ai',
    modelConfig: { model: '@cf/moonshotai/kimi-k2.6' },
    status: 'idle',
    statusReason: null,
    metadata: {},
    startedAt: now,
    stoppedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'event_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence: 1,
    type: 'message',
    visibility: 'transcript',
    role: 'assistant',
    parentEventId: null,
    correlationId: null,
    payload: { text: 'AMA task completed' },
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    projectId: 'project_1',
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    status: 'active',
    hasCredential: false,
    credentialStatus: 'not_required',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogStatus: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function vault(overrides: Partial<Vault> = {}): Vault {
  return {
    id: 'vault_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Provider credentials',
    description: 'Secrets',
    scope: 'project',
    metadata: {},
    status: 'active',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function credential(overrides: Partial<VaultCredential> = {}): VaultCredential {
  return {
    id: 'vaultcred_1',
    vaultId: 'vault_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Workers token',
    type: 'api_key',
    connectorBinding: { connectorId: 'workers-ai', name: 'apiKey' },
    metadata: {},
    status: 'active',
    activeVersionId: 'vaultver_1',
    activeVersion: {
      id: 'vaultver_1',
      credentialId: 'vaultcred_1',
      vaultId: 'vault_1',
      organizationId: 'org_1',
      projectId: 'project_1',
      version: 1,
      provider: 'cloudflare-secrets',
      secretRef: 'cloudflare-secret:WORKERS_AI',
      externalVaultPath: null,
      referenceName: 'WORKERS_AI',
      status: 'active',
      hasSecret: true,
      metadata: {},
      createdAt: now,
      supersededAt: null,
      revokedAt: null,
      deletedAt: null,
    },
    revokedAt: null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function mcpConnector(overrides: Partial<McpConnector> = {}): McpConnector {
  return {
    id: 'mcp_catalog_1',
    connectorId: 'github',
    name: 'GitHub',
    description: 'Repository access',
    category: 'source-control',
    trustLevel: 'official',
    capabilities: ['repo'],
    supportedAuthModes: ['api_key'],
    setupRequirements: ['credential'],
    tools: [{ name: 'repo.read', description: 'Read repository', approvalMode: 'project_policy' }],
    metadata: {},
    status: 'available',
    policyStatus: 'allowed',
    connectionStatus: 'connected',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function mcpConnection(overrides: Partial<McpConnection> = {}): McpConnection {
  return {
    id: 'mcpconn_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    connectorId: 'github',
    hasCredential: true,
    endpointUrl: null,
    approvalMode: 'project_policy',
    status: 'connected',
    lastError: null,
    metadata: {},
    connectedAt: now,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function governancePolicy(overrides: Partial<GovernancePolicy> = {}): GovernancePolicy {
  return {
    id: 'governance_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    scope: 'project',
    providerRules: [],
    modelRules: [],
    toolPolicy: {},
    mcpPolicy: { defaultEffect: 'allow' },
    sandboxPolicy: {},
    budgetPolicy: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function usageSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    totals: {
      key: {},
      records: 1,
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      durationMs: 1000,
      costMicros: 42,
      currency: 'USD',
    },
    groups: [],
    ...overrides,
  }
}

function auditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    actorUserId: 'user_1',
    actorType: 'user',
    action: 'agent.create',
    resourceType: 'agent',
    resourceId: 'agent_1',
    outcome: 'success',
    requestId: 'req_1',
    correlationId: null,
    sessionId: null,
    policyCategory: null,
    metadata: {},
    before: {},
    after: { name: 'Coding agent' },
    createdAt: now,
    ...overrides,
  }
}

function mockConsoleApi(seed?: {
  environments?: Environment[]
  agents?: Agent[]
  sessions?: Session[]
  detailSessions?: Session[]
  events?: SessionEvent[]
}) {
  const state = {
    environments: seed?.environments ?? [],
    agents: seed?.agents ?? [],
    sessions: seed?.sessions ?? [],
    detailSessions: seed?.detailSessions ?? [],
    events: seed?.events ?? [],
    providers: [provider()],
    vaults: [vault()],
    credentials: [credential()],
    mcpConnectors: [mcpConnector()],
    mcpConnections: [mcpConnection()],
    governancePolicy: governancePolicy(),
    usageSummary: usageSummary(),
    auditRecords: [auditRecord()],
  }

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/auth/me') {
      return jsonResponse(authContext)
    }
    if (url === '/api/auth/logout') {
      return noContent()
    }
    if (url.startsWith('/api/providers/') && method === 'GET') {
      const found = state.providers.find((item) => url === `/api/providers/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Provider not found' } }, 404)
    }
    if (url === '/api/providers' && method === 'GET') {
      return jsonResponse({ data: state.providers })
    }
    if (url === '/api/providers' && method === 'POST') {
      const created = provider({ id: 'provider_created', displayName: 'Workers AI' })
      state.providers = [created]
      return jsonResponse(created)
    }
    if (url === '/api/vaults' && method === 'GET') {
      return jsonResponse({ data: state.vaults })
    }
    if (url === '/api/vaults' && method === 'POST') {
      const created = vault({ id: 'vault_created' })
      state.vaults = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/vaults/') && url.endsWith('/credentials') && method === 'GET') {
      const vaultId = url.split('/')[3]
      return vaultId === 'vault_1' ? jsonResponse({ data: state.credentials }) : jsonResponse({ data: [] })
    }
    if (url.startsWith('/api/vaults/') && method === 'GET') {
      const found = state.vaults.find((item) => url === `/api/vaults/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Vault not found' } }, 404)
    }
    if (url === '/api/mcp/connectors' && method === 'GET') {
      return jsonResponse({ data: state.mcpConnectors })
    }
    if (url === '/api/mcp/connections' && method === 'GET') {
      return jsonResponse({ data: state.mcpConnections })
    }
    if (url === '/api/governance/policy' && method === 'GET') {
      return jsonResponse(state.governancePolicy)
    }
    if (url === '/api/usage/summary' && method === 'GET') {
      return jsonResponse(state.usageSummary)
    }
    if (url === '/api/audit-records' && method === 'GET') {
      return jsonResponse({ data: state.auditRecords })
    }
    if (url === '/api/environments' && method === 'GET') {
      return jsonResponse({ data: state.environments })
    }
    if (url === '/api/environments' && method === 'POST') {
      const created = environment({ id: 'env_created', name: 'Node workspace' })
      state.environments = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/environments/') && method === 'GET') {
      const found = state.environments.find((item) => url === `/api/environments/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Environment not found' } }, 404)
    }
    if (url === '/api/agents' && method === 'GET') {
      return jsonResponse({ data: state.agents })
    }
    if (url === '/api/agents' && method === 'POST') {
      const created = agent({ id: 'agent_created', defaultEnvironmentId: state.environments[0]?.id ?? null })
      state.agents = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/agents/') && url.endsWith('/sessions') && method === 'POST') {
      const agentId = url.split('/')[3] ?? ''
      const created = session({ agentId })
      state.sessions = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/agents/') && method === 'GET') {
      const found = state.agents.find((item) => url === `/api/agents/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Agent not found' } }, 404)
    }
    if (url === '/api/sessions' && method === 'GET') {
      return jsonResponse({ data: state.sessions })
    }
    if (url.startsWith('/api/sessions/') && url.endsWith('/events') && method === 'GET') {
      return url === '/api/sessions/session_1/events'
        ? jsonResponse({ data: state.events })
        : jsonResponse({ data: [] })
    }
    if (url.startsWith('/api/sessions/') && url.endsWith('/runtime') && method === 'POST') {
      state.events = [event()]
      return jsonResponse({ accepted: true })
    }
    if (url.startsWith('/api/sessions/') && url.endsWith('/runtime') && method === 'GET') {
      return new Response('{"type":"agent_end","message":"AMA task completed"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }
    if (url === '/api/sessions/session_1/stop' && method === 'POST') {
      state.sessions = [session({ status: 'stopped', stoppedAt: now })]
      return jsonResponse(state.sessions[0])
    }
    if (url === '/api/sessions/session_1' && method === 'DELETE') {
      state.sessions = [session({ status: 'archived', archivedAt: now })]
      return noContent()
    }
    if (url.startsWith('/api/sessions/') && method === 'GET') {
      const found = [...state.detailSessions, ...state.sessions].find((item) => url === `/api/sessions/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Session not found' } }, 404)
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })

  return { fetchMock, state }
}

function primaryNav() {
  return within(screen.getByRole('navigation', { name: 'Primary' }))
}

async function confirmAction(triggerName: string, confirmName = triggerName) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: confirmName }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('shows the FlareAuth login action when the session is missing', async () => {
    window.history.pushState({}, '', '/sessions?status=idle')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ error: { message: 'Authentication required' } }, 401),
    )

    render(<App />)

    expect(await screen.findByText('Continue with FlareAuth')).toBeTruthy()
    expect(screen.getByText('Sign in through FlareAuth to open the control plane.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue with FlareAuth' })).toHaveProperty(
      'href',
      'http://localhost:3000/api/auth/login?returnTo=%2Fsessions%3Fstatus%3Didle',
    )
  })

  it('drives the v1 console from resource creation through runtime events', async () => {
    const { fetchMock } = mockConsoleApi()

    render(<App />)

    expect(await screen.findByText('First run workflow')).toBeTruthy()
    expect(screen.getByText('GET /api/providers')).toBeTruthy()
    expect(screen.getByText('1. Provider')).toBeTruthy()
    expect(screen.getByText('2. Environment')).toBeTruthy()
    expect(screen.getByText('3. Agent')).toBeTruthy()
    expect(screen.getByText('4. Session')).toBeTruthy()
    expect(screen.getByText('5. Integration')).toBeTruthy()
    expect(screen.getByText(/restish :\/api\/openapi\.json/)).toBeTruthy()
    fireEvent.click(primaryNav().getByRole('link', { name: 'Agents' }))
    expect(await screen.findByText('No agents')).toBeTruthy()
    expect(screen.queryByText('Acceptance Path')).toBeNull()
    expect(document.querySelector('[data-slot="button"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="card"]')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create Environment' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Create Agent' })).toBeNull()
    expect(primaryNav().getByRole('link', { name: 'Quickstart' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Agents' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Environments' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Sessions' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Providers' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Vaults' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'MCP' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Usage' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Audit' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Settings' })).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Environments' }))
    expect(window.location.pathname).toBe('/environments')
    expect(screen.getByRole('heading', { name: 'Environments' })).toBeTruthy()
    expect(screen.getByText('No environments')).toBeTruthy()
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(window.location.pathname).toBe('/sessions')
    expect(screen.getByText('No sessions')).toBeTruthy()
    fireEvent.click(primaryNav().getByRole('link', { name: 'Environments' }))
    expect(window.location.pathname).toBe('/environments')

    fireEvent.click(screen.getByRole('button', { name: 'Create environment' }))
    expect(await screen.findByRole('heading', { name: 'Create Environment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save environment' }))
    expect(await screen.findByText('Environment created')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create Environment' })).toBeNull()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Agents' }))
    expect(window.location.pathname).toBe('/agents')
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByRole('heading', { name: 'Create Agent' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expect(await screen.findByText('Agent created')).toBeTruthy()
    expect(screen.getByText('Coding agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(await screen.findByText('Session started')).toBeTruthy()
    expect(window.location.pathname).toBe('/sessions')
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()
    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('No transcript events yet.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))
    expect(await screen.findByText('Task sent to runtime')).toBeTruthy()
    expect(screen.getAllByText(/AMA task completed/).length).toBeGreaterThan(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session_1/runtime',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders planned resource and detail routes', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [session()],
      events: [
        event({ visibility: 'transcript', role: 'assistant', payload: { text: 'hello' } }),
        event({ id: 'event_2', type: 'tool', visibility: 'debug', payload: { tool: 'read' } }),
      ],
    })

    window.history.pushState({}, '', '/agents/agent_1')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy()
    expect(await screen.findByText('Version snapshot')).toBeTruthy()
    expect(screen.getByText('Recent sessions')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Providers' }))
    expect(await screen.findByText('Workers AI')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Workers AI' }))
    expect(await screen.findByText('Rate limits')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Vaults' }))
    expect(await screen.findByText('Provider credentials')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Provider credentials' }))
    expect(await screen.findByText('Credential metadata')).toBeTruthy()
    expect(screen.getByText('Raw secret values are not returned by the control plane.')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'MCP' }))
    expect(await screen.findByText('MCP connectors')).toBeTruthy()
    expect(screen.getByText(/repo.read/)).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Usage' }))
    expect(await screen.findByText('Usage summary')).toBeTruthy()
    expect(screen.getByText('Prompt tokens')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Audit' }))
    expect(await screen.findByText('agent.create')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Settings' }))
    expect(await screen.findByText('Governance settings')).toBeTruthy()
  })

  it('boots directly into environment and session detail routes', async () => {
    const { fetchMock } = mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [session(), session({ id: 'session_stale', runtimeEndpointPath: '/api/sessions/stale-list/runtime' })],
      detailSessions: [
        session({
          id: 'session_stale',
          runtimeEndpointPath: '/api/sessions/session_stale/runtime',
        }),
        session({
          id: 'session_archived',
          status: 'archived',
          runtimeEndpointPath: '/api/sessions/session_archived/runtime',
        }),
      ],
      events: [
        event({ visibility: 'transcript', role: 'assistant', payload: { text: 'hello' } }),
        event({ id: 'event_2', type: 'tool', visibility: 'debug', payload: { tool: 'read' } }),
      ],
    })

    window.history.pushState({}, '', '/environments/env_1')
    const { unmount } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Environments' })).toBeTruthy()
    expect(await screen.findByText('Agents using this environment')).toBeTruthy()
    expect(screen.getByText('Sessions using this environment')).toBeTruthy()

    unmount()
    window.history.pushState({}, '', '/sessions/session_1')
    const sessionRoute = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()
    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('Transcript and runtime events')).toBeTruthy()
    expect(await screen.findByText(/hello/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Debug' })).toBeTruthy()

    sessionRoute.unmount()
    window.history.pushState({}, '', '/sessions/session_stale')
    const staleRoute = render(<App />)

    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(await screen.findByText('session_stale')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))
    await screen.findByText('Task sent to runtime')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session_stale/runtime',
      expect.objectContaining({ method: 'POST' }),
    )

    staleRoute.unmount()
    window.history.pushState({}, '', '/sessions/session_archived')
    const archivedRoute = render(<App />)

    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(await screen.findByText('session_archived')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))
    await screen.findByText('Task sent to runtime')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session_archived/runtime',
      expect.objectContaining({ method: 'POST' }),
    )

    archivedRoute.unmount()
    window.history.pushState({}, '', '/sessions/missing')
    render(<App />)

    expect(await screen.findByText('Session not found')).toBeTruthy()
    expect(screen.queryByText('Session detail')).toBeNull()
  })

  it('shows error, stopped, and archived session states', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [
        session({ status: 'error', statusReason: 'Runtime crashed' }),
        session({ id: 'session_stopped', status: 'stopped', stoppedAt: now }),
        session({ id: 'session_archived', status: 'archived', archivedAt: now }),
      ],
      events: [event({ type: 'error', payload: { message: 'Runtime crashed' } })],
    })

    render(<App />)

    await screen.findByText('First run workflow')
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(await screen.findByText('Runtime crashed')).toBeTruthy()
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)

    await confirmAction('Stop session')
    expect(await screen.findByText('Session stopped')).toBeTruthy()
    const statusRows = screen.getAllByText('Status').map((label) => label.closest('div'))
    expect(statusRows.some((row) => row && within(row).queryByText('stopped'))).toBe(true)

    await confirmAction('Archive session')
    expect(await screen.findByText('Session archived')).toBeTruthy()
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)
  })

  it('surfaces load failures after the loading state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return jsonResponse(authContext)
      }
      return jsonResponse({ error: { message: 'Control plane unavailable' } }, 503)
    })

    render(<App />)

    expect(screen.getByText('Loading console')).toBeTruthy()
    expect(await screen.findByText('Control plane unavailable')).toBeTruthy()
  })

  it('renders sessions, runtime events, and sends tasks through the runtime endpoint', async () => {
    const runtimeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ accepted: true })
      }
      return new Response('{"type":"agent_end","message":"AMA task completed"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return jsonResponse({
          user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
          organization: { id: 'org_1', name: 'Acme' },
          project: { id: 'project_1', name: 'Control Plane' },
          roles: ['owner'],
          permissions: ['agents:write'],
        })
      }
      if (url === '/api/agents') {
        return jsonResponse({ data: [agentFixture] })
      }
      if (url === '/api/agents/agent_1') {
        return jsonResponse(agentFixture)
      }
      if (url === '/api/environments') {
        return jsonResponse({ data: [environmentFixture] })
      }
      if (url === '/api/environments/env_1') {
        return jsonResponse(environmentFixture)
      }
      if (url === '/api/providers') {
        return jsonResponse({ data: [provider()] })
      }
      if (url === '/api/providers/workers-ai') {
        return jsonResponse(provider())
      }
      if (url === '/api/vaults') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/mcp/connectors') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/mcp/connections') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/governance/policy') {
        return jsonResponse(governancePolicy())
      }
      if (url === '/api/usage/summary') {
        return jsonResponse(usageSummary())
      }
      if (url === '/api/audit-records') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/sessions/session_1/events') {
        return jsonResponse({
          data: [
            {
              id: 'event_1',
              organizationId: 'org_1',
              projectId: 'project_1',
              sessionId: 'session_1',
              sequence: 1,
              type: 'lifecycle',
              visibility: 'transcript',
              role: null,
              parentEventId: null,
              correlationId: null,
              payload: { status: 'idle', reason: 'runtime_ready' },
              metadata: {},
              createdAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        })
      }
      if (url === '/api/sessions/session_1') {
        return jsonResponse(sessionFixture)
      }
      if (url.startsWith('/api/sessions')) {
        return jsonResponse({ data: [sessionFixture] })
      }
      if (url === '/runtime/sessions/session_1/rpc') {
        return await runtimeFetch(input, init)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Control Plane')).toBeTruthy())
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))

    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('/runtime/sessions/session_1/rpc')).toBeTruthy()
    expect(await screen.findByText(/runtime_ready/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))

    await waitFor(() => expect(runtimeFetch).toHaveBeenCalled())
    expect(runtimeFetch.mock.calls[0]?.[0]).toBe('/runtime/sessions/session_1/rpc')
    expect(runtimeFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
    expect(await screen.findByText(/agent_end/)).toBeTruthy()
  })
})

const environmentFixture = {
  id: 'env_1',
  projectId: 'project_1',
  name: 'Node workspace',
  description: 'Runtime',
  packages: [{ name: 'tsx', version: 'latest' }],
  variables: { NODE_ENV: { description: 'mode', required: false } },
  secretRefs: [],
  networkPolicy: { mode: 'restricted' },
  mcpPolicy: {},
  packageManagerPolicy: {},
  resourceLimits: { memoryMb: 1024 },
  runtimeImage: { image: 'node:24' },
  metadata: {},
  status: 'active',
  archivedAt: null,
  currentVersionId: 'envver_1',
  version: 1,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

const agentFixture = {
  id: 'agent_1',
  projectId: 'project_1',
  name: 'Coding agent',
  description: 'Runs tasks',
  instructions: 'Do the task',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  systemPrompt: 'Do the task',
  allowedTools: ['read', 'write'],
  mcpConnectors: [],
  sandboxPolicy: { network: 'enabled' },
  defaultEnvironmentId: 'env_1',
  metadata: {},
  status: 'active',
  archivedAt: null,
  currentVersionId: 'agentver_1',
  version: 1,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

const sessionFixture = {
  id: 'session_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  agentId: 'agent_1',
  agentVersionId: 'agentver_1',
  agentSnapshot: {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    instructions: 'Do the task',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    systemPrompt: 'Do the task',
    allowedTools: ['read', 'write'],
    mcpConnectors: [],
    sandboxPolicy: { network: 'enabled' },
    defaultEnvironmentId: 'env_1',
    metadata: {},
    createdAt: '2026-05-23T00:00:00.000Z',
  },
  environmentId: 'env_1',
  environmentVersionId: 'envver_1',
  environmentSnapshot: null,
  durableObjectName: 'session_1',
  sandboxId: 'session_1',
  piRuntimeId: 'pi_session_1',
  piProcessId: 'proc_session_1',
  runtimeEndpointPath: '/runtime/sessions/session_1/rpc',
  agentUrl: '/agents/managed-agent/session_1',
  modelProvider: 'workers-ai',
  modelConfig: { model: '@cf/moonshotai/kimi-k2.6' },
  status: 'idle',
  statusReason: null,
  metadata: {},
  startedAt: '2026-05-23T00:00:00.000Z',
  stoppedAt: null,
  archivedAt: null,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}
