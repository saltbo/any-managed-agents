/**
 * Tests for QuickstartSessionStep and QuickstartSessionPreview.
 * Pattern: MSW + real api client, QueryClientProvider (retry:false) + MemoryRouter.
 * vi.spyOn is only used for useSessionRuntimeSession (a WebSocket hook, not @/lib/api).
 *
 * QuickstartSessionPreview is a private component rendered when sessionId is set;
 * tests drive it through the public prop interface.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import * as sessionRuntimeModule from '@/features/sessions/use-session-runtime'
import type { Agent, Environment, Session, SessionConnection, SessionEvent } from '@/lib/api'
import { HttpResponse, http, server } from '@/test/msw'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { QuickstartSessionStep } from './QuickstartSessionStep'

// ─── Fixtures ───

const now = '2026-05-23T00:00:00.000Z'

function listEnvelope<T>(data: T[]) {
  return { data, pagination: { limit: 50, hasMore: false, nextCursor: null as string | null } }
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
    skills: [],
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

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ agentSnapshot: defaultAgentSnapshot, name: 'Quickstart session', ...overrides })
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

// ─── Render helper ───

function renderStep(props: React.ComponentProps<typeof QuickstartSessionStep>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, refetchIntervalInBackground: false },
      mutations: { retry: false },
    },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <QuickstartSessionStep {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

// ─── Runtime mock helper ───

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

// ─── Session preview MSW helpers ───

function sessionPreviewHandlers({
  session = buildSession() as Session,
  events = [] as SessionEvent[],
  connection = null as SessionConnection | null,
}: {
  session?: Session
  events?: SessionEvent[]
  connection?: SessionConnection | null
} = {}) {
  return [
    http.get('*/api/v1/sessions/:sessionId', () => HttpResponse.json(session)),
    http.get('*/api/v1/sessions/:sessionId/events', () => HttpResponse.json(listEnvelope(events))),
    http.get('*/api/v1/sessions/:sessionId/connection', () =>
      connection ? HttpResponse.json(connection) : new HttpResponse(null, { status: 404 }),
    ),
  ]
}

// ─── No agent / no environment ───

describe('QuickstartSessionStep — no agent, no environment', () => {
  it('renders No active agent and No active environment placeholders', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
    renderStep({ agent: null, environment: null, sessionId: null, onSessionCreated: vi.fn(), onContinue: vi.fn() })
    expect(screen.getByText('No active agent yet')).toBeTruthy()
    expect(screen.getByText('No active environment yet')).toBeTruthy()
  })

  it('disables Create test session button when agent and environment are null', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
    renderStep({ agent: null, environment: null, sessionId: null, onSessionCreated: vi.fn(), onContinue: vi.fn() })
    const btn = screen.getByText('Create test session').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('disables sandbox button when agent is null', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
    renderStep({ agent: null, environment: null, sessionId: null, onSessionCreated: vi.fn(), onContinue: vi.fn() })
    const btn = screen.getByText('Add sandbox execution').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('disables Continue to integration button when sessionId is null', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
    renderStep({ agent: null, environment: null, sessionId: null, onSessionCreated: vi.fn(), onContinue: vi.fn() })
    const btn = screen.getByText('Continue to integration').closest('button')
    expect(btn?.disabled).toBe(true)
  })
})

// ─── Agent present without sandbox execution ───

describe('QuickstartSessionStep — agent without sandbox execution', () => {
  const agentNoSandbox = buildAgent({
    tools: [{ name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
  })

  it('shows Add sandbox execution button when agent lacks sandbox.exec', () => {
    server.use(
      http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })),
      http.patch('*/api/v1/agents/:agentId', () => new HttpResponse(null, { status: 404 })),
    )
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
    server.use(
      http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })),
      http.patch('*/api/v1/agents/:agentId', () => new HttpResponse(null, { status: 404 })),
    )
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
    const updatedAgent = buildAgent({
      tools: [{ name: 'sandbox.exec', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
    })
    let patchCalled = false
    server.use(
      http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })),
      http.patch('*/api/v1/agents/:agentId', () => {
        patchCalled = true
        return HttpResponse.json(updatedAgent)
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
    await waitFor(() => expect(patchCalled).toBe(true))
  })
})

// ─── Agent with sandbox execution already enabled ───

describe('QuickstartSessionStep — agent with sandbox execution enabled', () => {
  const agentWithSandbox = buildAgent({
    tools: [{ name: 'sandbox.exec', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
  })

  it('shows Sandbox execution enabled and disables the button', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
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
    tools: [{ name: '*', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
  })

  it('shows Sandbox execution enabled via wildcard', () => {
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
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
    server.use(http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })))
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
    server.use(http.post('*/api/v1/sessions', () => new Promise(() => {})))
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

  it('calls createSession and invokes onSessionCreated with session id', async () => {
    const session = buildSession()
    server.use(
      http.post('*/api/v1/sessions', () => HttpResponse.json(session, { status: 201 })),
      // After invalidation, the sessions list is refetched — serve an empty list as peripheral response
      http.get('*/api/v1/sessions', () => HttpResponse.json(listEnvelope([session]))),
    )
    const onSessionCreated = vi.fn()
    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated,
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Create test session'))
    await waitFor(() => expect(onSessionCreated).toHaveBeenCalledWith('session_1'))
  })

  it('shows Create new test session label when sessionId is already set', () => {
    mockRuntime()
    server.use(...sessionPreviewHandlers())
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
    server.use(...sessionPreviewHandlers())
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
    server.use(...sessionPreviewHandlers())
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
    server.use(
      http.get('*/api/v1/sessions/:sessionId', () => new Promise(() => {})),
      http.get('*/api/v1/sessions/:sessionId/events', () => new Promise(() => {})),
      http.get('*/api/v1/sessions/:sessionId/connection', () => new Promise(() => {})),
    )
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ id: 'sess_xyz', phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), connection: null }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    const connection: SessionConnection = {
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    }
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), connection }))
    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    const textarea = screen.getByLabelText('First task')
    fireEvent.change(textarea, { target: { value: '' } })
    const btn = screen.getByText('Send first task').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('calls sendPrompt and clears textarea when Send first task is clicked', async () => {
    const { sendPromptFn } = mockRuntime({ connection: 'open' })
    sendPromptFn.mockReturnValue(true)
    const connection: SessionConnection = {
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    }
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), connection }))
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
    const textarea = screen.getByLabelText('First task')
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('does not clear textarea when sendPrompt returns false', async () => {
    const { sendPromptFn } = mockRuntime({ connection: 'open' })
    const connection: SessionConnection = {
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    }
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), connection }))
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
    expect((textarea as HTMLTextAreaElement).value).toBe(originalValue)
  })

  it('shows Agent is running label when runtime is in running state', async () => {
    mockRuntime({ connection: 'open', runState: 'running' })
    const connection: SessionConnection = {
      sessionId: 'session_1',
      transport: 'websocket',
      path: '/runtime/session_1',
      state: 'idle',
      stateReason: null,
    }
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'running' }), connection }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), events: [buildSessionEvent()] }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
      debugEvents: [{ id: 'dbg_1', type: 'agent_start', payload: { test: true }, createdAt: now }],
    })
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }) }))
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
  it('does not call onSessionCreated when createSession rejects', async () => {
    server.use(
      http.post('*/api/v1/sessions', () =>
        HttpResponse.json({ error: { message: 'Session creation failed' } }, { status: 500 }),
      ),
    )
    const onSessionCreated = vi.fn()
    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated,
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Create test session'))
    // Button re-enables after failure — proves we processed the error
    await waitFor(() => {
      const btn = screen.getByText('Create test session').closest('button')
      expect(btn?.disabled).toBe(false)
    })
    expect(onSessionCreated).not.toHaveBeenCalled()
  })
})

// ─── Session preview with mixed transcript items (sort coverage) ───

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
    server.use(...sessionPreviewHandlers({ session: buildSession({ phase: 'idle' }), events: [buildSessionEvent()] }))
    renderStep({
      agent: buildAgent(),
      environment: buildEnvironment(),
      sessionId: 'session_1',
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    await waitFor(() => expect(screen.getByText('Session preview')).toBeTruthy())
    expect(screen.getByRole('list', { name: 'Quickstart session transcript' })).toBeTruthy()
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(screen.getByText(/Tool read_file/)).toBeTruthy()
  })
})

// ─── enableSandbox error handling ───

describe('QuickstartSessionStep — enableSandbox error handling', () => {
  it('button re-enables when updateAgent rejects', async () => {
    const agentNoSandbox = buildAgent({
      tools: [{ name: 'read', description: null, inputSchema: {}, approvalMode: 'none', policyMetadata: {} }],
    })
    server.use(
      http.post('*/api/v1/sessions', () => new HttpResponse(null, { status: 404 })),
      http.patch('*/api/v1/agents/:agentId', () =>
        HttpResponse.json({ error: { message: 'Update failed' } }, { status: 500 }),
      ),
    )
    renderStep({
      agent: agentNoSandbox,
      environment: buildEnvironment(),
      sessionId: null,
      onSessionCreated: vi.fn(),
      onContinue: vi.fn(),
    })

    fireEvent.click(screen.getByText('Add sandbox execution'))
    // Button should re-enable after failure
    await waitFor(() => {
      const btn = screen.getByText('Add sandbox execution').closest('button')
      expect(btn?.disabled).toBe(false)
    })
  })
})
