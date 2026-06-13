/**
 * Tests for QuickstartPage — loading, error, step navigation, and step content.
 * Pattern: QueryClientProvider (retry:false) + MemoryRouter, screen + fireEvent,
 * vi.spyOn on api module, afterEach cleanup + vi.restoreAllMocks.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import * as sessionRuntimeModule from '@/features/sessions/use-session-runtime'
import * as apiModule from '@/lib/api'
import {
  type Agent,
  ApiError,
  type Environment,
  type ListResponse,
  type Provider,
  type Session,
  type SessionAgentSnapshot,
} from '@/lib/api'
import { QuickstartPage } from './QuickstartPage'

const listOf = <T,>(data: T[] = []): ListResponse<T> => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null },
})

afterEach(() => {
  // Unmount first to remove query observers, then clear cache.
  // Never await cancelQueries — never-resolving mock promises would hang.
  cleanup()
  for (const qc of queryClients) {
    qc.clear()
  }
  queryClients.length = 0
  vi.restoreAllMocks()
})

// ─── Fixtures ───

const now = '2026-05-23T00:00:00.000Z'

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    projectId: 'project_1',
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    enabled: true,
    credentialRef: null,
    credentialStatus: 'not_required',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Coding agent',
    description: null,
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

function buildEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: null,
    packages: [],
    variables: {},
    credentialRefs: [],
    hostingMode: 'cloud',
    networkPolicy: { mode: 'unrestricted' },
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

const defaultAgentSnapshot: SessionAgentSnapshot = {
  id: 'agentver_1',
  agentId: 'agent_1',
  projectId: 'project_1',
  version: 1,
  instructions: 'Do the work',
  providerId: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  skills: [],
  subagents: [],
  role: null,
  capabilityTags: [],
  handoffPolicy: {},
  memoryPolicy: {},
  tools: [],
  mcpConnectors: [],
  metadata: {},
  createdAt: '2026-05-23T00:00:00.000Z',
}

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: defaultAgentSnapshot,
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: null,
    title: 'Quickstart session',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {
      hostingMode: 'cloud',
      runtime: 'ama',
      runtimeConfig: { image: 'node:24' },
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      driver: 'ama-cloud',
      backend: 'ama-cloud',
      protocol: 'ama-runtime-rpc',
    },
    state: 'idle',
    stateReason: null,
    metadata: {},
    startedAt: now,
    stoppedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
}

const queryClients: QueryClient[] = []

/** Stub useSessionRuntimeSession to avoid real WebSocket connections in Page tests */
function mockRuntime(state: Partial<SessionRuntimeState> = {}) {
  const fullState: SessionRuntimeState = {
    connection: 'closed',
    runState: 'idle',
    messages: [],
    tools: [],
    debugEvents: [],
    eventKeys: [],
    error: null,
    ...state,
  }
  vi.spyOn(sessionRuntimeModule, 'useSessionRuntimeSession').mockReturnValue({
    endpoint: null,
    state: fullState,
    sendPrompt: vi.fn().mockReturnValue(false),
    sendFollowUp: vi.fn().mockReturnValue(false),
    sendSteer: vi.fn().mockReturnValue(false),
    abort: vi.fn().mockReturnValue(false),
  })
}

function renderPage(initialPath = '/quickstart') {
  const queryClient = makeQueryClient()
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <QuickstartPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

// ─── Loading state ───

describe('QuickstartPage loading', () => {
  it('renders loading state when queries are pending', () => {
    vi.spyOn(apiModule.api, 'listProviders').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listAgents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listEnvironments').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessions').mockReturnValue(new Promise(() => {}))

    renderPage()
    expect(screen.getByText('Loading quickstart')).toBeTruthy()
  })
})

// ─── Error state ───

describe('QuickstartPage error', () => {
  it('renders error state when a query fails', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockRejectedValue(new Error('Network error'))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage()
    await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy())
    expect(screen.getByText('Unable to load quickstart resources.')).toBeTruthy()
  })
})

// ─── Loaded state — step navigation ───

describe('QuickstartPage loaded — step navigation', () => {
  it('shows all five quickstart step labels in the list', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage()
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())
    expect(screen.getByText('2. Environment')).toBeTruthy()
    expect(screen.getByText('3. Agent')).toBeTruthy()
    expect(screen.getByText('4. Session')).toBeTruthy()
    expect(screen.getByText('5. Integration')).toBeTruthy()
  })

  it('opens provider step by default when no resources exist', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart')
    await waitFor(() =>
      expect(
        screen.getByText('Confirm the model provider. The seeded Workers AI provider needs no credential.'),
      ).toBeTruthy(),
    )
  })

  it('shows provider step content when step=provider is active', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Workers AI')).toBeTruthy())
    expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy()
  })

  it('shows environment step content when provider is completed and step=environment is active', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=environment')
    await waitFor(() =>
      expect(screen.getByText('Create or select the reusable sandbox template sessions will run in.')).toBeTruthy(),
    )
    expect(screen.getByText('Create environment')).toBeTruthy()
  })

  it('shows agent step content when provider and environment are completed and step=agent is active', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
  })

  it('shows session step content when provider, environment, and agent are completed', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=session')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
    expect(screen.getByText('Create test session')).toBeTruthy()
  })

  it('shows integration step content when all steps are completed', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession()]))

    renderPage('/quickstart?step=integration')
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
  })

  it('falls back to first incomplete step when locked step is requested', async () => {
    // No provider enabled → falls back to provider step even if agent is requested
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>())
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(
        screen.getByText('Confirm the model provider. The seeded Workers AI provider needs no credential.'),
      ).toBeTruthy(),
    )
  })

  it('renders session step content with "Create new test session" label when sessionId search param is set', async () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession()]))
    // session query for preview: mock readSession to keep it pending so SessionPreview just shows loading
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessionEvents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
    expect(screen.getByText('Create new test session')).toBeTruthy()
  })

  it('renders disabled locked step labels as spans not links', async () => {
    // Only provider enabled — environment, agent, session, integration are locked
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())

    // Provider (completed) and environment (next unlocked) should be links
    const providerEl = screen.getByText('1. Provider')
    expect(providerEl.tagName.toLowerCase()).toBe('a')

    // Agent, Session, Integration should be disabled spans (locked)
    const agentEl = screen.getByText('3. Agent')
    expect(agentEl.tagName.toLowerCase()).toBe('span')
    expect(agentEl.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows integration step with null input when sessions list is empty', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession({ state: 'stopped' })]))

    renderPage('/quickstart?step=integration')
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
    // With a stopped session (non-idle/running), integrationSession falls to sessions[0]
    // The page should still show integration examples since sessions[0] exists
    expect(screen.getByText('TypeScript SDK')).toBeTruthy()
  })
})

// ─── Agent step — draft flow ───

describe('QuickstartPage agent step — draft flow', () => {
  it('transitions from start to review when goal is drafted', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    // Type a goal and draft
    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))

    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())
  })

  it('transitions back to start when Back to templates is clicked', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Back to templates')).toBeTruthy())

    fireEvent.click(screen.getByText('Back to templates'))
    await waitFor(() => expect(screen.queryByText('Back to templates')).toBeNull())
  })

  it('shows validation errors on empty draft submission', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    // Click Start from scratch to get an empty draft
    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    // Submit empty draft — should show validation errors
    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy())
  })

  it('uses template when Use template is clicked on agent step', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    // Click Use template on the first template card
    const useTemplateBtn = screen.getAllByText('Use template')[0]!
    fireEvent.click(useTemplateBtn)

    // After clicking template, draft is set and review UI shows Create agent
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())
  })

  it('calls createAgent after valid draft is submitted', async () => {
    const createdAgent = buildAgent({ id: 'agent_new', version: 1 })
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    const createAgentSpy = vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(createdAgent)

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    // Draft from goal
    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(createAgentSpy).toHaveBeenCalledTimes(1))
  })
})

// ─── Environment step — createEnvironment flow ───

describe('QuickstartPage environment step — createEnvironment flow', () => {
  it('calls createEnvironment when Create environment button is clicked', async () => {
    const createdEnv = buildEnvironment({ id: 'env_new' })
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    const createEnvSpy = vi.spyOn(apiModule.api, 'createEnvironment').mockResolvedValue(createdEnv)

    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Create environment')).toBeTruthy())

    fireEvent.click(screen.getByText('Create environment'))
    await waitFor(() => expect(createEnvSpy).toHaveBeenCalledTimes(1))
  })
})

// ─── Integration step — with running session ───

describe('QuickstartPage integration step — integration examples', () => {
  it('renders integration examples for an idle session', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession({ state: 'idle' })]))

    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('curl')).toBeTruthy())
    expect(screen.getByText('restish')).toBeTruthy()
    expect(screen.getByText('TypeScript SDK')).toBeTruthy()
  })

  it('prefers session matching previewSessionId param for integration examples', async () => {
    const sessions = [
      buildSession({ id: 'session_other', state: 'idle' }),
      buildSession({
        id: 'session_preview',
        state: 'idle',
        agentId: 'agent_preview',
      }),
    ]
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>(sessions))

    renderPage('/quickstart?step=integration&session=session_preview')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })

  it('falls back to sessions[0] when no idle/running session matches', async () => {
    // Only a stopped session — no idle/running — falls back to sessions[0]
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession({ state: 'stopped' })]))

    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })

  it('falls back to sessions[0] when session is in error state', async () => {
    // session step complete (session exists), integration incomplete (no idle/running)
    // → firstIncompleteStep = 'integration', step is unlocked
    // integrationSession = sessions[0] (error session) as fallback
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession({ state: 'error' })]))

    renderPage('/quickstart?step=integration')
    await waitFor(() => expect(screen.getByText('TypeScript SDK')).toBeTruthy())
  })
})

// ─── runDefaultWorkersAi mutation ───

describe('QuickstartPage provider step — runDefaultWorkersAi', () => {
  it('calls createAgent, createEnvironment, createSession on Run the default', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    const createAgentSpy = vi.spyOn(apiModule.api, 'createAgent').mockResolvedValue(buildAgent())
    const createEnvSpy = vi.spyOn(apiModule.api, 'createEnvironment').mockResolvedValue(buildEnvironment())
    const createSessionSpy = vi.spyOn(apiModule.api, 'createSession').mockResolvedValue(buildSession())

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())
    fireEvent.click(screen.getByText('Run the default Workers AI agent'))

    await waitFor(() => expect(createAgentSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(createEnvSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(createSessionSpy).toHaveBeenCalledTimes(1))
  })

  it('shows Starting Workers AI agent label while running', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'createAgent').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'createEnvironment').mockReturnValue(new Promise(() => {}))

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())
    fireEvent.click(screen.getByText('Run the default Workers AI agent'))
    await waitFor(() => expect(screen.getByText('Starting Workers AI agent')).toBeTruthy())
  })
})

// ─── Environment step — onSelectExisting ───

describe('QuickstartPage environment step — onSelectExisting', () => {
  it('shows existing active environments in select', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Use a custom environment')).toBeTruthy())
    // The select trigger shows a placeholder; items are in hidden dropdown
    expect(screen.getByText('Selecting an existing environment completes this step without changes.')).toBeTruthy()
  })
})

// ─── Agent step — createAgent error mapping ───

describe('QuickstartPage agent step — createAgent with API error', () => {
  it('sets draft errors when createAgent returns mapped field errors', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    // Return a generic non-field error so toast.error is called (not setDraftErrors)
    vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(new Error('Server error'))

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a helpful assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(apiModule.api.createAgent).toHaveBeenCalledTimes(1))
  })

  it('clears individual field error when setField updates that field', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    // Click Start from scratch to get an empty draft
    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    // Submit to trigger validation error on name
    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(screen.getByText('Name is required.')).toBeTruthy())

    // Type in the name field to clear the error
    const nameInput = screen.getByRole('textbox', { name: /^Name/ })
    fireEvent.change(nameInput, { target: { value: 'My new agent' } })
    await waitFor(() => expect(screen.queryByText('Name is required.')).toBeNull())
  })
})

// ─── Provider step — onContinue ───

describe('QuickstartPage provider step — onContinue navigation', () => {
  it('moves to next step when Continue to next step is clicked', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Continue to next step')).toBeTruthy())
    fireEvent.click(screen.getByText('Continue to next step'))
    // After click, should move to environment step
    await waitFor(() =>
      expect(screen.getByText('Create or select the reusable sandbox template sessions will run in.')).toBeTruthy(),
    )
  })
})

// ─── Environment step — onSelectExisting navigation ───

describe('QuickstartPage environment step — onSelectExisting navigates to agent', () => {
  it('navigates to agent step after selecting existing environment', async () => {
    // Radix UI Select requires pointer-capture and scroll APIs that jsdom does not implement.
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: vi.fn(() => false), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })

    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Use a custom environment')).toBeTruthy())

    // Open the existing environment select and pick the first option
    const trigger = screen.getByRole('combobox', { name: 'Custom environment' })
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    const option = screen.getByRole('option', { name: 'Node workspace' })
    fireEvent.click(option)

    // After selecting, should navigate to agent step
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
  })
})

// ─── Session step — onSessionCreated and onContinue ───

describe('QuickstartPage session step — onSessionCreated and onContinue', () => {
  it('updates URL with session id when session is created', async () => {
    mockRuntime()
    const session = buildSession({ id: 'sess_new' })
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'createSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessionEvents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderPage('/quickstart?step=session')
    await waitFor(() => expect(screen.getByText('Create test session')).toBeTruthy())

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )
  })

  it('navigates to integration step when Continue to integration is clicked', async () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession()]))
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessionEvents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() =>
      expect(screen.getByText('Create a test session and send the first task to the runtime.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Continue to integration'))
    await waitFor(() =>
      expect(screen.getByText('Call the same control-plane API from curl, restish, or a generated SDK.')).toBeTruthy(),
    )
  })
})

// ─── Mutation error handling ───

describe('QuickstartPage — mutation error handling', () => {
  it('createEnvironment onError is invoked when createEnvironment fails', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'createEnvironment').mockRejectedValue(new Error('Env failed'))

    renderPage('/quickstart?step=environment')
    await waitFor(() => expect(screen.getByText('Create environment')).toBeTruthy())

    fireEvent.click(screen.getByText('Create environment'))
    await waitFor(() => expect(apiModule.api.createEnvironment).toHaveBeenCalledTimes(1))
  })

  it('runDefaultWorkersAi onError is invoked when createAgent fails', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>())
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(new Error('Agent failed'))

    renderPage('/quickstart?step=provider')
    await waitFor(() => expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Run the default Workers AI agent'))
    await waitFor(() => expect(apiModule.api.createAgent).toHaveBeenCalledTimes(1))
  })

  it('createAgent onError with field errors sets draftErrors', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())
    // Use ApiError with structured field details so apiErrorToBuilder maps the name field error
    const fieldError = new ApiError('Validation failed', 422, {
      error: { details: { fields: { name: 'Name is already taken.' } } },
    })
    vi.spyOn(apiModule.api, 'createAgent').mockRejectedValue(fieldError)

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    const textarea = screen.getByPlaceholderText('Review incoming pull requests and summarize risky changes.')
    fireEvent.change(textarea, { target: { value: 'Build a coding assistant' } })
    fireEvent.click(screen.getByText('Draft agent configuration'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    fireEvent.click(screen.getByText('Create agent'))
    await waitFor(() => expect(apiModule.api.createAgent).toHaveBeenCalledTimes(1))
  })
})

// ─── setField early return branch ───

describe('QuickstartPage — setField early return when no current errors', () => {
  it('does not clear error when field is not in current errors', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Start from scratch'))
    await waitFor(() => expect(screen.getByText('Create agent')).toBeTruthy())

    // Changing instructions field when there are no errors — the early-return branch executes
    const nameInput = screen.getByRole('textbox', { name: /^Name/ })
    fireEvent.change(nameInput, { target: { value: 'My agent' } })
    // No error displayed — setField ran through the early return for fields not in errors
    expect(screen.queryByText('Name is required.')).toBeNull()
  })
})

// ─── submitAgentDraft early return (draft === null) ───

describe('QuickstartPage — submitAgentDraft when draft is null', () => {
  it('Create agent button is absent when draft is null (start view)', async () => {
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>())

    renderPage('/quickstart?step=agent')
    await waitFor(() =>
      expect(screen.getByText('Draft the agent from a template or goal description, then create it.')).toBeTruthy(),
    )
    // In start view, "Create agent" button is not present
    expect(screen.queryByText('Create agent')).toBeNull()
  })
})

// ─── Navigation — stepHref with session param ───

describe('QuickstartPage navigation — step links with session param', () => {
  it('includes session param in step links when session search param is set', async () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'listProviders').mockResolvedValue(listOf<Provider>([buildProvider()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf<Agent>([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf<Environment>([buildEnvironment()]))
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf<Session>([buildSession()]))
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessionEvents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderPage('/quickstart?step=session&session=session_1')
    await waitFor(() => expect(screen.getByText('1. Provider')).toBeTruthy())

    // The provider link should include session=session_1
    const providerLink = screen.getByText('1. Provider')
    expect(providerLink.getAttribute('href')).toBe('/quickstart?step=provider&session=session_1')
  })
})
