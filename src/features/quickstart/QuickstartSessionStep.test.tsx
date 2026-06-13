/**
 * Tests for QuickstartSessionStep and QuickstartSessionPreview.
 * Pattern: QueryClientProvider (retry:false) + MemoryRouter, screen + fireEvent,
 * vi.spyOn on api module, afterEach cleanup + vi.restoreAllMocks.
 *
 * QuickstartSessionPreview is a private component rendered when sessionId is set;
 * tests drive it through the public prop interface.
 *
 * useSessionRuntimeSession is mocked to control runtime.state in tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import * as sessionRuntimeModule from '@/features/sessions/use-session-runtime'
import type { Agent, Environment, ListResponse, Session, SessionConnection, SessionEvent } from '@/lib/api'
import * as apiModule from '@/lib/api'
import { QuickstartSessionStep } from './QuickstartSessionStep'

const listOf = <T,>(data: T[] = []): ListResponse<T> => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null },
})

afterEach(() => {
  // Unmount first to remove query observers, THEN clear cache to release memory.
  // Do NOT call cancelQueries — never-resolving mock promises would cause it to hang.
  cleanup()
  for (const qc of queryClients) {
    qc.clear()
  }
  queryClients.length = 0
  vi.restoreAllMocks()
})

// ─── Fixtures ───

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent_1',
    projectId: 'project_1',
    name: 'Coding agent',
    description: null,
    instructions: 'Do the work',
    providerId: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: [],
    subagents: [],
    role: null,
    capabilityTags: [],
    handoffPolicy: {},
    memoryPolicy: { enabled: false },
    tools: [
      {
        name: 'read',
        description: null,
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
      {
        name: 'write',
        description: null,
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
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

const defaultAgentSnapshot: import('@/lib/api').SessionAgentSnapshot = {
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

function buildSessionEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'event_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence: 1,
    type: 'message_end',
    visibility: 'runtime',
    role: 'assistant',
    parentEventId: null,
    correlationId: null,
    payload: {
      message: { role: 'assistant', content: 'Hello from the agent' },
    },
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchIntervalInBackground: false,
      },
      mutations: { retry: false },
    },
  })
}

const queryClients: QueryClient[] = []

function renderStep(props: React.ComponentProps<typeof QuickstartSessionStep>) {
  const queryClient = makeQueryClient()
  queryClients.push(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuickstartSessionStep {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

/** Stub useSessionRuntimeSession to return a controlled state */
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
  const sendPromptFn = vi.fn().mockReturnValue(false)
  vi.spyOn(sessionRuntimeModule, 'useSessionRuntimeSession').mockReturnValue({
    endpoint: null,
    state: fullState,
    sendPrompt: sendPromptFn,
    sendFollowUp: vi.fn().mockReturnValue(false),
    sendSteer: vi.fn().mockReturnValue(false),
    abort: vi.fn().mockReturnValue(false),
  })
  return { sendPromptFn }
}

// ─── No agent / no environment ───

describe('QuickstartSessionStep — no agent, no environment', () => {
  it('renders No active agent and No active environment placeholders', () => {
    renderStep({
      agent: null,
      environment: null,
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    expect(screen.getByText('No active agent yet')).toBeTruthy()
    expect(screen.getByText('No active environment yet')).toBeTruthy()
  })

  it('disables Create test session button when agent and environment are null', () => {
    renderStep({
      agent: null,
      environment: null,
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Create test session').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('disables sandbox button when agent is null', () => {
    renderStep({
      agent: null,
      environment: null,
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Add sandbox execution').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('disables Continue to integration button when sessionId is null', () => {
    renderStep({
      agent: null,
      environment: null,
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Continue to integration').closest('button')
    expect(btn?.disabled).toBe(true)
  })
})

// ─── Agent present without sandbox execution ───

describe('QuickstartSessionStep — agent without sandbox execution', () => {
  const agentNoSandbox = buildAgent({
    tools: [
      {
        name: 'read',
        description: null,
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
  })

  it('shows Add sandbox execution button when agent lacks sandbox.exec', () => {
    renderStep({
      agent: agentNoSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Add sandbox execution').closest('button')
    expect(btn?.disabled).toBe(false)
  })

  it('shows agent name and environment name in meta', () => {
    renderStep({
      agent: agentNoSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    expect(screen.getByText('Coding agent · agent_1 · v1')).toBeTruthy()
    expect(screen.getByText('Node workspace · env_1')).toBeTruthy()
  })

  it('calls updateAgent when Add sandbox execution is clicked', async () => {
    const updateAgentSpy = vi.spyOn(apiModule.api, 'updateAgent').mockResolvedValue(
      buildAgent({
        tools: [
          {
            name: 'sandbox.exec',
            description: null,
            inputSchema: {},
            approvalMode: 'none',
            policyMetadata: {},
          },
        ],
      }),
    )
    renderStep({
      agent: agentNoSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    fireEvent.click(screen.getByText('Add sandbox execution'))
    await waitFor(() => expect(updateAgentSpy).toHaveBeenCalledTimes(1))
  })
})

// ─── Agent with sandbox execution already enabled ───

describe('QuickstartSessionStep — agent with sandbox execution enabled', () => {
  const agentWithSandbox = buildAgent({
    tools: [
      {
        name: 'sandbox.exec',
        description: null,
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
  })

  it('shows Sandbox execution enabled and disables the button', () => {
    renderStep({
      agent: agentWithSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Sandbox execution enabled').closest('button')
    expect(btn?.disabled).toBe(true)
  })
})

// ─── Agent with wildcard tools (*) — sandbox enabled via wildcard ───

describe('QuickstartSessionStep — agent with wildcard tools (*)', () => {
  const agentWildcard = buildAgent({
    tools: [
      {
        name: '*',
        description: null,
        inputSchema: {},
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
  })

  it('shows Sandbox execution enabled via wildcard', () => {
    renderStep({
      agent: agentWildcard,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    expect(screen.getByText('Sandbox execution enabled')).toBeTruthy()
  })
})

// ─── Agent with no tools — sandbox enabled when tools is empty ───

describe('QuickstartSessionStep — agent with empty tools list', () => {
  const agentNoTools = buildAgent({ tools: [] })

  it('shows Sandbox execution enabled when tools list is empty', () => {
    renderStep({
      agent: agentNoTools,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    expect(screen.getByText('Sandbox execution enabled')).toBeTruthy()
  })
})

// ─── Create session ───

describe('QuickstartSessionStep — create session flow', () => {
  it('shows Creating test session label when createSession is pending', async () => {
    vi.spyOn(apiModule.api, 'createSession').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() => expect(screen.getByText('Creating test session')).toBeTruthy())
  })

  it('calls createSession when Create test session is clicked', async () => {
    const session = buildSession()
    const createSessionSpy = vi.spyOn(apiModule.api, 'createSession').mockResolvedValue(session)
    const onSessionCreated = vi.fn()

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated,
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() => expect(createSessionSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith('session_1'))
  })

  it('shows Create new test session label when sessionId is already set', () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(buildSession())
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    expect(screen.getByText('Create new test session')).toBeTruthy()
  })

  it('enables Continue to integration button when sessionId is set', () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(buildSession())
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })
    const btn = screen.getByText('Continue to integration').closest('button')
    expect(btn?.disabled).toBe(false)
  })

  it('calls onContinue when Continue to integration is clicked', () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(buildSession())
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    const onContinue = vi.fn()
    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue,
    })
    fireEvent.click(screen.getByText('Continue to integration'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})

// ─── Session preview (sessionId is set) — loading state ───

describe('QuickstartSessionStep — session preview loading', () => {
  it('renders loading placeholder when session is loading', () => {
    mockRuntime()
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listSessionEvents').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    expect(screen.getByText('Loading the quickstart session preview.')).toBeTruthy()
  })
})

// ─── Session preview loaded — empty transcript ───

describe('QuickstartSessionStep — session preview empty transcript', () => {
  it('renders session preview after session loads', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByText('session_1')).toBeTruthy()
  })

  it('shows empty transcript message when no events yet', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('No messages yet. Send the first task below.')).toBeTruthy())
  })

  it('renders session id in meta', async () => {
    mockRuntime()
    const session = buildSession({ id: 'sess_xyz', state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'sess_xyz',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('sess_xyz')).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Transcript' })).toBeTruthy()
  })

  it('renders runtime connection status label', async () => {
    mockRuntime({ connection: 'connecting' })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByText(/runtime connection:/i)).toBeTruthy()
  })

  it('renders pending runtime endpoint when connection data is not loaded', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Pending runtime endpoint')).toBeTruthy())
  })

  it('renders Transcript tab as default', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const transcriptTab = screen.getByRole('tab', { name: 'Transcript' })
    expect(transcriptTab.getAttribute('aria-selected')).toBe('true')
  })

  it('renders textarea with safe example prompt prefilled', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const textarea = screen.getByLabelText('First task')
    expect((textarea as HTMLTextAreaElement).value.length).toBeGreaterThan(0)
  })

  it('updates textarea value when user types', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const textarea = screen.getByLabelText('First task')
    fireEvent.change(textarea, { target: { value: 'Run the tests please' } })
    expect((textarea as HTMLTextAreaElement).value).toBe('Run the tests please')
  })

  it('Send first task button is disabled when runtime is not open', async () => {
    mockRuntime({ connection: 'closed' })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const btn = screen.getByText('Send first task').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('Send first task button is disabled when prompt is empty', async () => {
    mockRuntime({ connection: 'open' })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockResolvedValue({
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    } satisfies SessionConnection)

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    // Clear the pre-filled prompt to get an empty value
    const textarea = screen.getByLabelText('First task')
    fireEvent.change(textarea, { target: { value: '' } })
    const btn = screen.getByText('Send first task').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('calls sendPrompt and clears textarea when Send first task is clicked', async () => {
    const { sendPromptFn } = mockRuntime({ connection: 'open' })
    sendPromptFn.mockReturnValue(true)
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockResolvedValue({
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    } satisfies SessionConnection)

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    fireEvent.click(screen.getByText('Send first task'))
    expect(sendPromptFn).toHaveBeenCalledTimes(1)
    // After successful send (returns true), textarea is cleared
    const textarea = screen.getByLabelText('First task')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('does not clear textarea when sendPrompt returns false', async () => {
    const { sendPromptFn } = mockRuntime({ connection: 'open' })
    // sendPromptFn returns false by default — the prompt should not be cleared
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockResolvedValue({
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    } satisfies SessionConnection)

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const textarea = screen.getByLabelText('First task')
    const originalValue = (textarea as HTMLTextAreaElement).value
    fireEvent.click(screen.getByText('Send first task'))
    expect(sendPromptFn).toHaveBeenCalledTimes(1)
    // Prompt NOT cleared since sendPrompt returned false
    expect((textarea as HTMLTextAreaElement).value).toBe(originalValue)
  })

  it('shows Agent is running label when runtime is in running state', async () => {
    mockRuntime({ connection: 'open', runState: 'running' })
    const session = buildSession({ state: 'running' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockResolvedValue({
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    } satisfies SessionConnection)

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByText('Agent is running')).toBeTruthy()
    const btn = screen.getByText('Agent is running').closest('button')
    expect(btn?.disabled).toBe(true)
  })
})

// ─── Session preview with transcript messages ───

describe('QuickstartSessionStep — session preview with messages', () => {
  it('renders transcript messages list when runtime has messages', async () => {
    mockRuntime({
      connection: 'closed',
      messages: [
        {
          id: 'msg_1',
          role: 'assistant',
          content: 'Hello from the agent',
          status: 'complete' as const,
          createdAt: now,
        },
      ],
    })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>([buildSessionEvent()]))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Quickstart session transcript' })).toBeTruthy()
    expect(screen.getByText('Hello from the agent')).toBeTruthy()
    expect(screen.getByText('assistant')).toBeTruthy()
  })

  it('renders transcript tool traces when runtime has tools', async () => {
    mockRuntime({
      connection: 'closed',
      tools: [
        {
          id: 'tool_1',
          callId: 'call_1',
          name: 'read_file',
          status: 'success' as const,
          input: {},
          output: null,
          error: null,
          durationMs: null,
          createdAt: now,
          updatedAt: now,
          eventType: 'tool_execution_end',
        },
      ],
    })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Quickstart session transcript' })).toBeTruthy()
    expect(screen.getByText(/Tool read_file/)).toBeTruthy()
  })
})

// ─── Debug tab ───

describe('QuickstartSessionStep — debug tab', () => {
  it('renders debug tab and shows empty debug state', async () => {
    mockRuntime()
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getByText('Runtime diagnostics appear here as the agent runs.')).toBeTruthy()
  })

  it('renders debug events list when runtime has debug events', async () => {
    mockRuntime({
      debugEvents: [
        {
          id: 'dbg_1',
          type: 'agent_start',
          payload: { test: true },
          createdAt: now,
        },
      ],
    })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getByRole('list', { name: 'Quickstart session debug events' })).toBeTruthy()
    expect(screen.getByText('dbg_1')).toBeTruthy()
  })
})

// ─── createSession error handling ───

describe('QuickstartSessionStep — createSession error handling', () => {
  it('API is called even when createSession rejects', async () => {
    vi.spyOn(apiModule.api, 'createSession').mockRejectedValue(new Error('Session creation failed'))
    const onSessionCreated = vi.fn()

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated,
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() =>
      expect(apiModule.api.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent_1', environmentId: 'env_1' }),
      ),
    )
    // onSessionCreated should NOT be called when session creation fails
    expect(onSessionCreated).not.toHaveBeenCalled()
  })
})

// ─── Session preview with mixed transcript items (messages + tools, sort coverage) ───

describe('QuickstartSessionStep — session preview with mixed transcript', () => {
  it('sorts mixed messages and tools by createdAt', async () => {
    mockRuntime({
      connection: 'closed',
      messages: [
        {
          id: 'msg_1',
          role: 'user',
          content: 'Hello',
          status: 'complete' as const,
          createdAt: '2026-05-23T00:00:02.000Z',
        },
      ],
      tools: [
        {
          id: 'tool_1',
          callId: 'call_1',
          name: 'read_file',
          status: 'success' as const,
          input: {},
          output: null,
          error: null,
          durationMs: null,
          createdAt: '2026-05-23T00:00:01.000Z',
          updatedAt: '2026-05-23T00:00:01.000Z',
          eventType: 'tool_execution_end',
        },
      ],
    })
    const session = buildSession({ state: 'idle' })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(session)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>([buildSessionEvent()]))
    vi.spyOn(apiModule.api, 'readSessionConnection').mockReturnValue(new Promise(() => {}))

    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    // Both items are rendered — the sort comparator executed
    expect(screen.getByRole('list', { name: 'Quickstart session transcript' })).toBeTruthy()
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText(/Tool read_file/)).toBeTruthy()
  })
})

// ─── enableSandbox error handling ───

describe('QuickstartSessionStep — enableSandbox error handling', () => {
  it('API is called even when updateAgent rejects', async () => {
    const agentNoSandbox = buildAgent({
      tools: [
        {
          name: 'read',
          description: null,
          inputSchema: {},
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    vi.spyOn(apiModule.api, 'updateAgent').mockRejectedValue(new Error('Update failed'))

    renderStep({
      agent: agentNoSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Add sandbox execution'))
    await waitFor(() =>
      expect(apiModule.api.updateAgent).toHaveBeenCalledWith(
        'agent_1',
        expect.objectContaining({ tools: expect.any(Array) }),
      ),
    )
  })
})
