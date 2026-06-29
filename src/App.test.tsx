import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type {
  Agent,
  AuditRecord,
  AuthContext,
  Connector,
  Environment,
  Provider,
  Session,
  SessionEnvironmentSnapshot,
  SessionEvent,
  UsageSummary,
  Vault,
  VaultCredential,
} from './lib/api'
import { buildTestSession, type TestSessionOverrides } from './testing/session'

const now = '2026-05-23T00:00:00.000Z'
const authContext: AuthContext = {
  user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
  organization: { id: 'org_1', name: 'Acme' },
  project: { id: 'project_1', name: 'Control Plane' },
  roles: ['owner'],
  permissions: ['agents:write'],
}

const runtimeCommandSinkKey = '__AMA_TEST_RUNTIME_COMMANDS__'

function runtimeCommandSink() {
  return globalThis as typeof globalThis & { [runtimeCommandSinkKey]?: unknown[] }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installMockRuntimeWebSocket(options: { closeAfterAgentEnd?: boolean } = {}) {
  const sentCommands: unknown[] = []
  const socketUrls: string[] = []
  runtimeCommandSink()[runtimeCommandSinkKey] = sentCommands
  class MockRuntimeWebSocket extends EventTarget {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readonly url: string
    readyState = MockRuntimeWebSocket.CONNECTING

    constructor(url: string) {
      super()
      this.url = url
      socketUrls.push(url)
      queueMicrotask(() => {
        this.readyState = MockRuntimeWebSocket.OPEN
        this.dispatchEvent(new Event('open'))
      })
    }

    send(data: string) {
      const command = JSON.parse(data) as { id?: string; type?: string; message?: string }
      sentCommands.push(command)
      this.emit({ type: 'response', id: command.id, command: command.type, success: true })
      if (command.type === 'prompt' || command.type === 'follow_up') {
        const content = `Received: ${command.message}`
        this.emit({
          type: 'message_update',
          id: `${command.id}_assistant`,
          message: { role: 'assistant', content },
          assistantMessageEvent: { text: content },
        })
        this.emit({
          type: 'tool_execution_end',
          id: `${command.id}_tool`,
          toolCall: { id: `${command.id}_tool`, name: 'write_file', output: { ok: true }, durationMs: 4 },
        })
        this.emit({
          type: 'message_end',
          id: `${command.id}_assistant`,
          message: { role: 'assistant', content },
        })
        this.emit({ type: 'turn_end', id: `${command.id}_end`, stage: 'agent_completed', willRetry: false })
        if (options.closeAfterAgentEnd) {
          queueMicrotask(() => this.close())
        }
      }
    }

    close() {
      this.readyState = MockRuntimeWebSocket.CLOSED
      this.dispatchEvent(new Event('close'))
    }

    private emit(payload: Record<string, unknown>) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })))
    }
  }

  vi.stubGlobal('WebSocket', MockRuntimeWebSocket)
  return { sentCommands, socketUrls }
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: 'Runtime',
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: { NODE_ENV: { description: 'mode', required: false } },
    hostingMode: 'cloud',
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: { memoryMb: 1024 },
    runtimeConfig: { image: 'node:24' },
    metadata: {},
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function sessionEnvironmentSnapshot(overrides: Partial<SessionEnvironmentSnapshot> = {}): SessionEnvironmentSnapshot {
  return {
    id: 'envver_1',
    environmentId: 'env_1',
    projectId: 'project_1',
    version: 1,
    packages: [],
    variables: {},
    hostingMode: 'cloud',
    networkPolicy: { mode: 'unrestricted' },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: {},
    runtimeConfig: { image: 'node:24' },
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Coding agent',
    description: 'Runs work',
    instructions: 'Do the work',
    providerId: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: ['ama@coding-agent'],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: { enabled: false },
    tools: [
      { name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
      { name: 'write', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
    ],
    mcpConnectors: [],
    metadata: {},
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function session(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ environmentSnapshot: sessionEnvironmentSnapshot(), ...overrides })
}

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'event_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence: 1,
    type: 'message_end',
    visibility: 'runtime',
    role: null,
    parentEventId: null,
    correlationId: null,
    payload: { type: 'message_end', message: { role: 'assistant', content: 'AMA message completed' } },
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    slug: 'workers-ai',
    displayName: 'Workers AI',
    enabled: true,
    metadata: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function vault(overrides: Partial<Vault> = {}): Vault {
  return {
    id: 'vault_1',
    projectId: 'project_1',
    name: 'Provider credentials',
    description: 'Secrets',
    scope: 'project',
    metadata: {},
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
    projectId: 'project_1',
    name: 'Workers token',
    type: 'opaque',
    metadata: {},
    state: 'active',
    activeVersionId: 'vaultver_1',
    activeVersion: {
      id: 'vaultver_1',
      credentialId: 'vaultcred_1',
      vaultId: 'vault_1',
      projectId: 'project_1',
      version: 1,
      provider: 'ama',
      secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
      referenceName: 'WORKERS_AI',
      state: 'active',
      hasSecret: true,
      dataKeys: ['value'],
      metadata: {},
      createdAt: now,
      supersededAt: null,
      revokedAt: null,
    },
    revokedAt: null,
    revokedByUserId: null,
    revokeReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function mcpConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Repository access',
    category: 'source-control',
    trustLevel: 'official',
    capabilities: ['repo'],
    supportedAuthModes: ['api_key'],
    setupRequirements: ['credential'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository',
        inputSchema: {},
        approvalMode: 'project_policy',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function usageSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    groupBy: 'provider',
    totals: {
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

function normalizeMockUrl(input: RequestInfo | URL) {
  const url = String(input)
  return url.endsWith('?') ? url.slice(0, -1) : url
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
    usageSummary: usageSummary(),
    auditRecords: [auditRecord()],
  }

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = normalizeMockUrl(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/v1/projects') {
      return jsonResponse({
        data: [
          {
            id: authContext.project.id,
            organizationId: authContext.organization.id,
            name: authContext.project.name,
            createdAt: now,
            updatedAt: now,
          },
        ],
        pagination: {
          limit: 1,
          nextCursor: null,
          hasMore: false,
          firstId: authContext.project.id,
          lastId: authContext.project.id,
        },
      })
    }
    if (url.startsWith('/api/v1/runtime/sessions/') && url.endsWith('/rpc') && method === 'POST') {
      const command = JSON.parse(String(init?.body ?? '{}')) as { id?: string; type?: string; message?: string }
      runtimeCommandSink()[runtimeCommandSinkKey]?.push(command)
      const sessionId = url.split('/')[5] ?? 'session_1'
      const sequence = state.events.length
      if (command.type === 'prompt') {
        const content = `Received: ${command.message}`
        state.events = [
          ...state.events,
          event({
            id: `${command.id}_response`,
            sessionId,
            sequence: sequence + 1,
            type: 'turn_end',
            payload: { type: 'turn_end', stage: 'command_completed', status: 'success' },
          }),
          event({
            id: `${command.id}_user`,
            sessionId,
            sequence: sequence + 2,
            type: 'message_end',
            payload: { type: 'message_end', message: { role: 'user', content: command.message ?? '' } },
          }),
          event({
            id: `${command.id}_tool`,
            sessionId,
            sequence: sequence + 3,
            type: 'tool_execution_end',
            payload: {
              type: 'tool_execution_end',
              toolCall: { id: `${command.id}_tool`, name: 'write_file', output: { ok: true }, durationMs: 4 },
            },
          }),
          event({
            id: `${command.id}_assistant`,
            sessionId,
            sequence: sequence + 4,
            type: 'message_end',
            payload: { type: 'message_end', message: { role: 'assistant', content } },
          }),
          event({
            id: `${command.id}_agent_end`,
            sessionId,
            sequence: sequence + 5,
            type: 'turn_end',
            payload: {
              type: 'turn_end',
              id: `${command.id}_agent_end`,
              stage: 'agent_completed',
              willRetry: false,
            },
          }),
        ]
      }
      return jsonResponse({ id: command.id, type: 'response', command: command.type, success: true })
    }
    if (url.startsWith('/api/v1/providers/') && method === 'GET') {
      const found = state.providers.find((item) => url === `/api/v1/providers/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Provider not found' } }, 404)
    }
    if (url === '/api/v1/providers' && method === 'GET') {
      return jsonResponse({ data: state.providers })
    }
    if (url === '/api/v1/providers' && method === 'POST') {
      const created = provider({ id: 'provider_created', displayName: 'Workers AI' })
      state.providers = [created]
      return jsonResponse(created)
    }
    if (url === '/api/v1/vaults' && method === 'GET') {
      return jsonResponse({ data: state.vaults })
    }
    if (url === '/api/v1/vaults' && method === 'POST') {
      const created = vault({ id: 'vault_created' })
      state.vaults = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/v1/vaults/') && url.endsWith('/credentials') && method === 'GET') {
      const vaultId = url.split('/')[4]
      return vaultId === 'vault_1' ? jsonResponse({ data: state.credentials }) : jsonResponse({ data: [] })
    }
    if (url.startsWith('/api/v1/vaults/') && method === 'GET') {
      const found = state.vaults.find((item) => url === `/api/v1/vaults/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Vault not found' } }, 404)
    }
    if (url === '/api/v1/connectors' && method === 'GET') {
      return jsonResponse({ data: state.mcpConnectors })
    }
    if (url.startsWith('/api/v1/usage-summary') && method === 'GET') {
      return jsonResponse(state.usageSummary)
    }
    if ((url === '/api/v1/audit-records' || url.startsWith('/api/v1/audit-records?')) && method === 'GET') {
      return jsonResponse({ data: state.auditRecords })
    }
    if (url === '/api/v1/environments' && method === 'GET') {
      return jsonResponse({ data: state.environments })
    }
    if (url === '/api/v1/environments' && method === 'POST') {
      const created = environment({ id: 'env_created', name: 'Node workspace' })
      state.environments = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/v1/environments/') && method === 'GET') {
      const found = state.environments.find((item) => url === `/api/v1/environments/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Environment not found' } }, 404)
    }
    if (url === '/api/v1/agents' && method === 'GET') {
      return jsonResponse({ data: state.agents })
    }
    if (url === '/api/v1/agents' && method === 'POST') {
      const created = agent({ id: 'agent_created' })
      state.agents = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/v1/agents/') && url.endsWith('/versions') && method === 'GET') {
      const found = state.agents.find((item) => url === `/api/v1/agents/${item.id}/versions`)
      return found
        ? jsonResponse({ data: [session({ agentId: found.id }).status.bindings.agent.snapshot] })
        : jsonResponse({ data: [] })
    }
    if (url === '/api/v1/sessions' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        agentId: string
        environmentId: string
        name?: string
        metadata?: Record<string, string>
        volumes?: Session['spec']['volumes']
      }
      const created = session({
        agentId: body.agentId,
        environmentId: body.environmentId,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        metadata: { ...session().metadata, annotations: body.metadata ?? {} },
        spec: { ...session().spec, volumes: body.volumes ?? [] },
      })
      state.sessions = [created]
      return jsonResponse(created)
    }
    if (url.startsWith('/api/v1/agents/') && method === 'GET') {
      const found = state.agents.find((item) => url === `/api/v1/agents/${item.id}`)
      return found ? jsonResponse(found) : jsonResponse({ error: { message: 'Agent not found' } }, 404)
    }
    if (url === '/api/v1/sessions' && method === 'GET') {
      return jsonResponse({ data: state.sessions })
    }
    if (url.startsWith('/api/v1/sessions/') && url.endsWith('/connection') && method === 'GET') {
      const sessionId = url.split('/')[4]
      const found = [...state.detailSessions, ...state.sessions].find((item) => item.metadata.uid === sessionId)
      return jsonResponse({
        sessionId,
        transport: 'ama-runtime-rpc',
        path: `/api/v1/runtime/sessions/${sessionId}/rpc`,
        state: found?.status.phase ?? 'idle',
        stateReason: found?.status.reason ?? null,
      })
    }
    if (url.startsWith('/api/v1/sessions/') && url.includes('/events') && method === 'GET') {
      const sessionId = url.split('/')[4]
      return jsonResponse({ data: state.events.filter((item) => item.sessionId === sessionId) })
    }
    if (url === '/api/v1/sessions/session_1' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { state?: string; archived?: boolean }
      if (body.archived) {
        const archived = session({ archivedAt: now })
        state.sessions = [archived]
        return jsonResponse(archived)
      }
      const stopped = session({ phase: 'stopped', stoppedAt: now })
      state.sessions = [stopped]
      return jsonResponse(stopped)
    }
    if (url.startsWith('/api/v1/sessions/') && method === 'GET') {
      const found = [...state.detailSessions, ...state.sessions].find(
        (item) => url === `/api/v1/sessions/${item.metadata.uid}`,
      )
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
  const trigger = screen.queryByRole('button', { name: triggerName })
  if (trigger) {
    fireEvent.click(trigger)
  } else {
    const actions = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actions)
    fireEvent.click(actions)
    fireEvent.click(await screen.findByRole('menuitem', { name: triggerName }))
  }
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: confirmName }))
}

function expectToast(element: HTMLElement) {
  expect(element.closest('[data-sonner-toast]')).toBeTruthy()
}

beforeEach(() => {
  window.localStorage.setItem('ama:e2e-access-token', 'e2e:app-test')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('shows the OIDC provider login action when the session is missing [spec: auth/login-page] [spec: auth/web-redirect]', async () => {
    window.history.pushState({}, '', '/sessions?status=idle')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ error: { message: 'Authentication required' } }, 401),
    )

    render(<App />)

    expect(await screen.findByText('Continue with OIDC provider')).toBeTruthy()
    expect(screen.getByText('Sign in through OIDC provider to open the control plane.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with OIDC provider' })).toBeTruthy()
  })

  it('drives the v1 console from resource creation through runtime events [spec: agents/console-list] [spec: web-console/shell] [spec: quickstart/first-run]', async () => {
    mockConsoleApi()
    const { sentCommands, socketUrls } = installMockRuntimeWebSocket()

    render(<App />)

    expect(await screen.findByText('First run workflow')).toBeTruthy()
    expect(screen.getByText('GET /api/v1/providers')).toBeTruthy()
    expect(screen.getByText('1. Provider')).toBeTruthy()
    expect(screen.getByText('2. Environment')).toBeTruthy()
    expect(screen.getByText('3. Agent')).toBeTruthy()
    expect(screen.getByText('4. Session')).toBeTruthy()
    expect(screen.getByText('5. Integration')).toBeTruthy()
    // With no resources yet the guided flow opens on the environment step.
    expect(screen.getByText('GET /api/v1/openapi.json')).toBeTruthy()
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Create environment' })).toBeTruthy()
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
    expect(primaryNav().getByRole('link', { name: 'Triggers' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Vaults' })).toBeTruthy()
    expect(primaryNav().queryByRole('link', { name: 'Providers' })).toBeNull()
    expect(primaryNav().queryByRole('link', { name: 'MCP' })).toBeNull()
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
    expectToast(await screen.findByText('Environment created'))
    expect(screen.queryByRole('heading', { name: 'Create Environment' })).toBeNull()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Agents' }))
    expect(window.location.pathname).toBe('/agents')
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByRole('heading', { name: 'Create Agent' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expectToast(await screen.findByText('Agent created'))
    expect(screen.getByText('Coding agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    expect(await screen.findByRole('heading', { name: 'Create Session' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create session' }))
    expectToast(await screen.findByText('Session created'))
    expect(window.location.pathname).toBe('/sessions/session_1')
    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(screen.getByText('No messages yet')).toBeTruthy()
    expect(sentCommands).toHaveLength(0)
    await waitFor(() => expect(socketUrls.length).toBeGreaterThan(0))

    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent'), {
      target: { value: 'Create ama-message.txt with exactly: AMA message completed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Received: Create ama-message/)).toBeTruthy()
    expect(await screen.findByText('write_file')).toBeTruthy()
    expect(sentCommands).toContainEqual(expect.objectContaining({ type: 'prompt' }))
  })

  it('renders routed resource and detail pages [spec: web-console/routed-pages]', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [session()],
      events: [
        event({ payload: { type: 'message_end', message: { role: 'assistant', content: 'hello' } } }),
        event({
          id: 'event_2',
          type: 'tool_execution_end',
          payload: { type: 'tool_execution_end', toolCall: { id: 'tool_1', name: 'read' } },
        }),
      ],
    })

    window.history.pushState({}, '', '/agents/agent_1')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Coding agent' })).toBeTruthy()
    expect(await screen.findByText('Agent model configuration')).toBeTruthy()
    expect(await screen.findByText('ama@coding-agent')).toBeTruthy()
    expect(screen.queryByText('Sandbox policy')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Sessions' }))
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(1)

    fireEvent.click(primaryNav().getByRole('link', { name: 'Vaults' }))
    expect(await screen.findByText('Provider credentials')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Provider credentials' }))
    expect(await screen.findByText('Credential metadata')).toBeTruthy()
    expect(screen.getByText('Raw secret values are not returned by the control plane.')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(window.location.pathname).toBe('/settings/providers')
    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }))
    expect(window.location.pathname).toBe('/settings/mcp')
    expect(await screen.findByText('MCP connectors')).toBeTruthy()
    expect(screen.getByText('source-control')).toBeTruthy()
    expect(screen.getByText('repo')).toBeTruthy()
    expect(screen.getByText(/Setup: credential/)).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Usage' }))
    expect(await screen.findByText('Usage summary')).toBeTruthy()
    expect(screen.getByText('Prompt tokens')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Audit' }))
    expect(await screen.findByText('agent.create')).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Providers' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'MCP' })).toBeTruthy()
  })

  it('boots directly into environment and session detail routes', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [session(), session({ id: 'session_stale', name: 'session_stale' })],
      detailSessions: [
        session({
          id: 'session_stale',
          name: 'session_stale',
        }),
        session({
          id: 'session_archived',
          name: 'session_archived',
          phase: 'stopped',
          archivedAt: now,
        }),
        session({
          id: 'session_self_hosted',
          name: 'session_self_hosted',
          phase: 'pending',
          reason: 'waiting-for-runner',
          environmentSnapshot: sessionEnvironmentSnapshot({ hostingMode: 'self_hosted' }),
          spec: { ...session().spec, runtime: 'ama' },
          status: {
            ...session().status,
            placement: { ...session().status.placement!, hostingMode: 'self_hosted' },
          },
        }),
      ],
      events: [
        event({ payload: { type: 'message_end', message: { role: 'assistant', content: 'hello' } } }),
        event({
          id: 'event_2',
          type: 'tool_execution_end',
          payload: { type: 'tool_execution_end', toolCall: { id: 'tool_1', name: 'read' } },
        }),
      ],
    })
    const { sentCommands, socketUrls } = installMockRuntimeWebSocket()

    window.history.pushState({}, '', '/environments/env_1')
    const { unmount } = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Node workspace' })).toBeTruthy()
    expect(await screen.findByText('Sessions using this environment')).toBeTruthy()

    unmount()
    window.history.pushState({}, '', '/sessions/session_1')
    const sessionRoute = render(<App />)

    expect(await screen.findByRole('heading', { name: 'Test session' })).toBeTruthy()
    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(document.querySelector('[data-console-content="full-bleed"]')).toBeTruthy()
    expect(document.querySelector('[data-console-surface="full-bleed"]')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Session message composer' }).getAttribute('data-density')).toBe('compact')
    expect(screen.getByText('All events')).toBeTruthy()
    expect(await screen.findByText(/hello/)).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Debug' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open agent details' })[0] as HTMLElement)
    expect(await screen.findByText('ama@coding-agent')).toBeTruthy()
    expect(screen.queryByText('Sandbox policy')).toBeNull()

    sessionRoute.unmount()
    window.history.pushState({}, '', '/sessions/session_stale')
    const staleRoute = render(<App />)

    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'session_stale' })).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent'), { target: { value: 'Resume stale' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await screen.findByText(/Received: Resume stale/)
    expect(sentCommands).toContainEqual(expect.objectContaining({ type: 'prompt', message: 'Resume stale' }))

    staleRoute.unmount()
    window.history.pushState({}, '', '/sessions/session_archived')
    const archivedRoute = render(<App />)

    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'session_archived' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)

    archivedRoute.unmount()
    const socketsBeforeSelfHosted = socketUrls.length
    window.history.pushState({}, '', '/sessions/session_self_hosted')
    const selfHostedRoute = render(<App />)

    expect(await screen.findByRole('heading', { name: 'session_self_hosted' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
    expect(socketUrls).toHaveLength(socketsBeforeSelfHosted)

    selfHostedRoute.unmount()
    window.history.pushState({}, '', '/sessions/missing')
    render(<App />)

    expect(await screen.findByText('Session not found')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Transcript' })).toBeNull()
  })

  it('reconnects the runtime socket so a session can receive multiple messages', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [session()],
      events: [],
    })
    const { sentCommands, socketUrls } = installMockRuntimeWebSocket({ closeAfterAgentEnd: true })

    window.history.pushState({}, '', '/sessions/session_1')
    render(<App />)

    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    expect(sentCommands).toHaveLength(0)
    await waitFor(() => expect(socketUrls.length).toBeGreaterThan(0))
    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent'), { target: { value: 'First turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Received: First turn/)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Send a message to the agent').hasAttribute('disabled')).toBe(false)
    })
    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent'), { target: { value: 'Second turn' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Received: Second turn/)).toBeTruthy()
    expect(sentCommands).toEqual([
      expect.objectContaining({ type: 'prompt', message: 'First turn' }),
      expect.objectContaining({ type: 'prompt', message: 'Second turn' }),
    ])
  })

  it('shows error, stopped, and archived session states [spec: web-console/destructive-ops]', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [
        session({ name: 'First run workflow', phase: 'error', reason: 'Runtime crashed' }),
        session({ id: 'session_stopped', name: 'Stopped workflow', phase: 'stopped', stoppedAt: now }),
        session({ id: 'session_archived', name: 'Archived workflow', phase: 'stopped', archivedAt: now }),
      ],
      events: [event({ type: 'runtime.error', payload: { message: 'Runtime crashed' } })],
    })

    render(<App />)

    await screen.findByText('First run workflow')
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(await screen.findByLabelText('error: Runtime crashed')).toBeTruthy()
    expect(screen.queryByText('Runtime crashed')).toBeNull()
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
    // Archived sessions render their persisted state but expose no Archive action,
    // unlike the active error/stopped rows which each keep one.
    expect(screen.getAllByRole('button', { name: 'Archive' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('link', { name: 'First run workflow' }))
    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    await confirmAction('Stop session')
    expectToast(await screen.findByText('Session stopped'))
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)

    await confirmAction('Archive session')
    expectToast(await screen.findByText('Session archived'))
  })

  it('surfaces load failures after the loading state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = normalizeMockUrl(input)
      if (url === '/api/v1/projects') {
        return jsonResponse({ error: { message: 'Control plane unavailable' } }, 503)
      }
      return jsonResponse({ error: { message: 'Control plane unavailable' } }, 503)
    })

    render(<App />)

    expect(screen.getByText('Loading console')).toBeTruthy()
    expect(await screen.findByText('Control plane unavailable')).toBeTruthy()
  })

  it('renders sessions, runtime events, and sends messages through the runtime endpoint', async () => {
    const { sentCommands, socketUrls } = installMockRuntimeWebSocket()
    const runtimeEvents: SessionEvent[] = [
      {
        id: 'event_1',
        projectId: 'project_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'turn_end',
        visibility: 'debug',
        role: null,
        parentEventId: null,
        correlationId: null,
        payload: { status: 'idle', reason: 'runtime_ready' },
        metadata: {},
        createdAt: '2026-05-23T00:00:00.000Z',
      },
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = normalizeMockUrl(input)
      const method = init?.method ?? 'GET'
      if (url === '/api/v1/runtime/sessions/session_1/rpc' && method === 'POST') {
        const command = JSON.parse(String(init?.body ?? '{}')) as { id?: string; type?: string; message?: string }
        sentCommands.push(command)
        runtimeEvents.push(
          event({
            id: `${command.id}_tool`,
            sequence: runtimeEvents.length + 1,
            type: 'tool_execution_end',
            payload: {
              type: 'tool_execution_end',
              toolCall: { id: `${command.id}_tool`, name: 'write_file', output: { ok: true }, durationMs: 4 },
            },
          }),
          event({
            id: `${command.id}_assistant`,
            sequence: runtimeEvents.length + 2,
            type: 'message_end',
            payload: {
              type: 'message_end',
              message: { role: 'assistant', content: `Received: ${command.message}` },
            },
          }),
          event({
            id: `${command.id}_agent_end`,
            sequence: runtimeEvents.length + 3,
            type: 'turn_end',
            payload: {
              type: 'turn_end',
              id: `${command.id}_agent_end`,
              stage: 'agent_completed',
              willRetry: false,
            },
          }),
        )
        return jsonResponse({ id: command.id, type: 'response', command: command.type, success: true })
      }
      if (url === '/api/v1/projects') {
        return jsonResponse({
          data: [
            {
              id: 'project_1',
              organizationId: 'org_1',
              name: 'Control Plane',
              createdAt: now,
              updatedAt: now,
            },
          ],
          pagination: { limit: 1, nextCursor: null, hasMore: false, firstId: 'project_1', lastId: 'project_1' },
        })
      }
      if (url === '/api/v1/agents') {
        return jsonResponse({ data: [agentFixture] })
      }
      if (url === '/api/v1/agents/agent_1') {
        return jsonResponse(agentFixture)
      }
      if (url === '/api/v1/environments') {
        return jsonResponse({ data: [environmentFixture] })
      }
      if (url === '/api/v1/environments/env_1') {
        return jsonResponse(environmentFixture)
      }
      if (url === '/api/v1/providers') {
        return jsonResponse({ data: [provider()] })
      }
      if (url === '/api/v1/providers/workers-ai') {
        return jsonResponse(provider())
      }
      if (url === '/api/v1/vaults') {
        return jsonResponse({ data: [] })
      }
      if (url === '/api/v1/connectors') {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/usage-summary')) {
        return jsonResponse(usageSummary())
      }
      if (url === '/api/v1/audit-records' || url.startsWith('/api/v1/audit-records?')) {
        return jsonResponse({ data: [] })
      }
      if (url.startsWith('/api/v1/sessions/session_1/connection')) {
        return jsonResponse({
          sessionId: 'session_1',
          transport: 'ama-runtime-rpc',
          path: '/api/v1/runtime/sessions/session_1/rpc',
          state: 'idle',
          stateReason: null,
        })
      }
      if (url.startsWith('/api/v1/sessions/session_1/events')) {
        return jsonResponse({ data: runtimeEvents })
      }
      if (url === '/api/v1/sessions/session_1') {
        return jsonResponse(sessionFixture)
      }
      if (url.startsWith('/api/v1/sessions')) {
        return jsonResponse({ data: [sessionFixture] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<App />)

    await waitFor(() => expect(screen.getAllByText('Control Plane').length).toBeGreaterThan(0))
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Transcript' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Test session' }))

    expect(await screen.findByRole('tab', { name: 'Transcript' })).toBeTruthy()
    await waitFor(() => expect(socketUrls.length).toBeGreaterThan(0))

    fireEvent.change(screen.getByPlaceholderText('Send a message to the agent'), {
      target: { value: 'Run live check' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(sentCommands).toContainEqual(expect.objectContaining({ type: 'prompt' })))
    expect(await screen.findByText(/Received: Run live check/)).toBeTruthy()
    expect(await screen.findByText('write_file')).toBeTruthy()
  })
})

const environmentFixture = {
  id: 'env_1',
  projectId: 'project_1',
  name: 'Node workspace',
  description: 'Runtime',
  packages: [{ name: 'tsx', version: 'latest' }],
  variables: { NODE_ENV: { description: 'mode', required: false } },
  hostingMode: 'cloud',
  networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
  mcpPolicy: {},
  packageManagerPolicy: {},
  resourceLimits: { memoryMb: 1024 },
  runtimeConfig: { image: 'node:24' },
  metadata: {},
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
  description: 'Runs work',
  instructions: 'Do the work',
  providerId: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  skills: ['ama@coding-agent'],
  subagents: [],
  role: null,
  capabilityTags: [],
  handoffPolicy: {},
  memoryPolicy: { enabled: false },
  tools: [
    { name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
    { name: 'write', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} },
  ],
  mcpConnectors: [],
  metadata: {},
  archivedAt: null,
  currentVersionId: 'agentver_1',
  version: 1,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

const sessionFixture = session({ id: 'session_1', environmentSnapshot: null })
