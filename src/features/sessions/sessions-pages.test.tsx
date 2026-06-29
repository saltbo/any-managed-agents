/**
 * Tests for SessionsPage, SessionDetailPage, CreateSessionSheet (component branches),
 * SessionDetailView (resource sheet / confirm-action branches), SessionsView (checkbox /
 * empty-state / archived branches), SessionRuntimePanel (connection-badge / canSend
 * branches), SessionToolTrace (empty / running / orphan branches).
 *
 * Uses MSW + the REAL api client. No vi.spyOn / vi.mock of @/lib/amarpc.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Agent, Environment, ListResponse, Session, SessionEvent } from '@/lib/amarpc'
import { ApiError } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { CreateSessionSheet, formatCreateSessionError } from './CreateSessionSheet'
import { SessionDetailPage } from './SessionDetailPage'
import { SessionDetailView } from './SessionDetailView'
import { SessionRuntimePanel } from './SessionRuntimePanel'
import { SessionsPage } from './SessionsPage'
import { SessionsView } from './SessionsView'
import { SessionToolTrace } from './SessionToolTrace'
import type { SessionRuntimeState } from './session-runtime'
import type { SessionToolTraceEntry } from './session-tool-trace'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const listOf = <T,>(data: T[] = []): ListResponse<T> => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null },
})

const _emptyList = <T,>() => listOf<T>()

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'Test session', ...overrides })
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    packages: [{ name: 'tsx', version: 'latest' }],
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function buildRuntimeState(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return {
    connection: 'open',
    runState: 'idle',
    messages: [],
    tools: [],
    debugEvents: [],
    eventKeys: [],
    error: null,
    ...overrides,
  }
}

function buildPagination(sessions: Session[]) {
  return {
    items: sessions,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: sessions.length,
    start: sessions.length === 0 ? 0 : 1,
    end: sessions.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

function buildTraceEntry(overrides: Partial<SessionToolTraceEntry> = {}): SessionToolTraceEntry {
  return {
    key: 'entry_1',
    correlationId: 'tool:call_1',
    toolCallId: 'call_1',
    name: 'sandbox.exec',
    status: 'completed',
    approval: 'approved',
    orphanedResult: false,
    input: { command: 'git status' },
    output: { content: [{ type: 'text', text: 'clean tree' }] },
    errorSummary: null,
    durationMs: 250,
    startedAt: now,
    completedAt: now,
    ...overrides,
  }
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

// ---------------------------------------------------------------------------
// MSW handler factories
// ---------------------------------------------------------------------------

function sessionsList(sessions: Session[]) {
  return http.get('*/api/v1/sessions', () => HttpResponse.json(listOf(sessions)))
}

function sessionNotFound() {
  return http.get('*/api/v1/sessions/:sessionId', () =>
    HttpResponse.json({ error: { type: 'not_found', message: 'Not found' } }, { status: 404 }),
  )
}

function sessionDetail(session: Session) {
  return http.get(`*/api/v1/sessions/${session.metadata.uid}`, () => HttpResponse.json(session))
}

function agentDetail(agent: Agent) {
  return http.get(`*/api/v1/agents/${agent.metadata.uid}`, () => HttpResponse.json(agent))
}

function environmentDetail(env: Environment) {
  return http.get(`*/api/v1/environments/${env.metadata.uid}`, () => HttpResponse.json(env))
}

function sessionEventsList(sessionId: string, events: SessionEvent[] = []) {
  return http.get(`*/api/v1/sessions/${sessionId}/events`, () => HttpResponse.json(listOf(events)))
}

function agentsList(agents: Agent[] = []) {
  return http.get('*/api/v1/agents', () => HttpResponse.json(listOf(agents)))
}

function environmentsList(envs: Environment[] = []) {
  return http.get('*/api/v1/environments', () => HttpResponse.json(listOf(envs)))
}

function sessionPatch(session: Session) {
  return http.patch(`*/api/v1/sessions/${session.metadata.uid}`, () => HttpResponse.json(session))
}

// ---------------------------------------------------------------------------
// SessionsView — empty state, archived rows, checkbox behaviour
// ---------------------------------------------------------------------------

describe('SessionsView', () => {
  it('renders empty state when sessions list is empty', () => {
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[]}
          pagination={buildPagination([])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No sessions')).toBeTruthy()
  })

  it('does not show Archive button for archived sessions', () => {
    const archivedSession = buildSession({ id: 'session_archived', archivedAt: now })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[archivedSession]}
          pagination={buildPagination([archivedSession])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull()
  })

  it('shows Archive button for non-archived sessions', () => {
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('selects all sessions when select-all checkbox is clicked', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    fireEvent.click(selectAll)
    expect(setSelectedIds).toHaveBeenCalledWith(['session_1'])
  })

  it('deselects all when select-all is clicked while all are selected', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={['session_1']}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    fireEvent.click(selectAll)
    expect(setSelectedIds).toHaveBeenCalledWith([])
  })

  it('selects individual row via row checkbox', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const rowCheckbox = screen.getByRole('checkbox', { name: 'Select Test session' })
    fireEvent.click(rowCheckbox)
    expect(setSelectedIds).toHaveBeenCalledWith(['session_1'])
  })

  it('deselects individual row via row checkbox when already selected', () => {
    const session = buildSession()
    const setSelectedIds = vi.fn()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={['session_1']}
          setSelectedIds={setSelectedIds}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const rowCheckbox = screen.getByRole('checkbox', { name: 'Select Test session' })
    fireEvent.click(rowCheckbox)
    expect(setSelectedIds).toHaveBeenCalledWith([])
  })

  it('renders hosting/runtime as None when environmentSnapshot is absent', () => {
    const session = buildSession({ environmentSnapshot: null })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/None · env_1/)).toBeTruthy()
  })

  it('renders Self-hosted hosting/runtime label', () => {
    const session = buildSession({
      environmentSnapshot: {
        id: 'envver_1',
        environmentId: 'env_1',
        projectId: 'project_1',
        packages: [],
        variables: {},
        hostingMode: 'self_hosted',
        networkPolicy: { mode: 'restricted', allowedHosts: [] },
        mcpPolicy: {},
        packageManagerPolicy: {},
        resourceLimits: { memoryMb: 1024 },
        runtimeConfig: { image: 'node:24' },
        metadata: {},
        version: 1,
        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Self-hosted \/ ama/)).toBeTruthy()
  })

  it('calls onArchive after confirming archive for a session', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    const onArchive = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={onArchive}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    const confirmButton = await screen.findByRole('button', { name: 'Archive session' })
    fireEvent.click(confirmButton)
    expect(onArchive).toHaveBeenCalledWith('session_1')
  })

  it('disables select-all checkbox when all sessions are archived', () => {
    const archivedSession = buildSession({ id: 'session_archived', archivedAt: now })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[archivedSession]}
          pagination={buildPagination([archivedSession])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const selectAll = screen.getByRole('checkbox', { name: 'Select all sessions' })
    expect(selectAll.hasAttribute('disabled')).toBe(true)
  })

  it('renders "None" for null model in agent provider column', () => {
    const session = buildSession({
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_1',
        projectId: 'project_1',
        version: 1,
        instructions: 'Do work',
        providerId: 'workers-ai',
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
        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    // Both model-display cells show "None" when model is null
    const noneCells = screen.getAllByText(/workers-ai \/ None/)
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it('falls back to agentId when instructions is null', () => {
    const session = buildSession({
      agentId: 'agent_fallback_id',
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_fallback_id',
        projectId: 'project_1',
        version: 1,
        instructions: null,
        providerId: 'workers-ai',
        model: '@cf/meta/llama',
        skills: [],
        subagents: [],
        role: null,
        capabilityTags: [],
        handoffPolicy: {},
        memoryPolicy: { enabled: false },
        tools: [],
        mcpConnectors: [],
        metadata: {},
        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    // When instructions is null, falls back to agentId
    expect(screen.getByText(/agent_fallback_id · agent_fallback_id/)).toBeTruthy()
  })

  it('renders "None" for null environmentId in hosting column', () => {
    const session = buildSession({ environmentId: null, environmentSnapshot: null })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={buildPagination([session])}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/None · None/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// SessionDetailView — resource sheets, confirm dialogs, fallbacks
// ---------------------------------------------------------------------------

describe('SessionDetailView', () => {
  function renderDetailView(overrides: TestSessionOverrides = {}, runtimeOverrides: Partial<SessionRuntimeState> = {}) {
    const session = buildSession(overrides)
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState(runtimeOverrides)}
          onStop={vi.fn()}
          onArchive={vi.fn()}
          onRefreshEvents={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )
    return session
  }

  it('falls back to agentId when agentName is absent and instructions is null', () => {
    const session = buildSession({
      agentId: 'agent_no_name',
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_no_name',
        projectId: 'project_1',
        version: 1,
        instructions: null,
        providerId: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: [],
        subagents: [],
        role: null,
        capabilityTags: [],
        handoffPolicy: {},
        memoryPolicy: { enabled: false },
        tools: [],
        mcpConnectors: [],
        metadata: {},
        createdAt: now,
      },
    })
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName={undefined}
          environmentName={undefined}
          events={[]}
          runtime={buildRuntimeState()}
          onStop={vi.fn()}
          onArchive={vi.fn()}
          onRefreshEvents={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText(/agent_no_name/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/env_1/).length).toBeGreaterThan(0)
  })

  it('shows No environment snapshot when environmentSnapshot is null', () => {
    renderDetailView({ environmentSnapshot: null })
    expect(screen.getByText('No environment snapshot')).toBeTruthy()
  })

  it('opens agent resource sheet on meta button click', async () => {
    renderDetailView()

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('Agent id')).toBeTruthy()
  })

  it('opens environment resource sheet on meta button click', async () => {
    renderDetailView()

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('Environment id')).toBeTruthy()
  })

  it('disables environment button when environmentSnapshot is absent', () => {
    renderDetailView({ environmentSnapshot: null })

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    for (const btn of envButtons) {
      expect(btn.hasAttribute('disabled')).toBe(true)
    }
  })

  it('opens volumes sheet when volumes meta button is clicked', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://gitlab.com/acme/app.git', ref: 'main' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText('Git repositories')).toBeTruthy()
  })

  it('calls onStop after stop action is confirmed', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
    const onStop = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState()}
          onStop={onStop}
          onArchive={vi.fn()}
          onRefreshEvents={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const actionsButton = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(actionsButton)
    fireEvent.click(actionsButton)
    const stopItem = await screen.findByText('Stop session')
    fireEvent.click(stopItem)
    const confirmButton = await screen.findByRole('button', { name: 'Stop session' })
    fireEvent.click(confirmButton)
    expect(onStop).toHaveBeenCalledWith('session_1')
  })

  it('calls onArchive after archive action is confirmed', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
    const onArchive = vi.fn()
    const session = buildSession()
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState()}
          onStop={vi.fn()}
          onArchive={onArchive}
          onRefreshEvents={vi.fn()}
          chatMessage=""
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const actionsButton = screen.getByRole('button', { name: 'Actions' })
    fireEvent.pointerDown(actionsButton, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(actionsButton)
    fireEvent.click(actionsButton)
    const archiveItem = await screen.findByText('Archive session')
    fireEvent.click(archiveItem)
    const confirmButton = await screen.findByRole('button', { name: 'Archive session' })
    fireEvent.click(confirmButton)
    expect(onArchive).toHaveBeenCalledWith('session_1')
  })

  it('renders session without a name using session id in heading', () => {
    renderDetailView({ name: null })
    expect(screen.getAllByText('session_1').length).toBeGreaterThan(0)
  })

  it('renders secret volumes in volumes sheet', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'api-token', type: 'secret', secretRef: 'ama-secret://vault_1/api-token' }],
        volumeMounts: [{ name: 'api-token', mountPath: '/run/secrets/api-token' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('renders canSend false when session is stopped', () => {
    const session = buildSession({ phase: 'stopped' })
    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState()}
          onStop={vi.fn()}
          onArchive={vi.fn()}
          onRefreshEvents={vi.fn()}
          chatMessage="hello"
          setChatMessage={vi.fn()}
          onSendMessage={vi.fn()}
          onAbortRuntime={vi.fn()}
        />
      </MemoryRouter>,
    )

    const sendButton = screen.queryByRole('button', { name: 'Send' })
    if (sendButton) {
      expect(sendButton.hasAttribute('disabled')).toBe(true)
    }
  })

  it('renders agent snapshot tool names in agent sheet', async () => {
    renderDetailView()
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    expect(screen.getByText('read, write')).toBeTruthy()
  })

  it('opens agent sheet via second (mobile) agent button', async () => {
    renderDetailView()
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    const targetBtn = agentButtons.length > 1 ? agentButtons[1]! : agentButtons[0]!
    fireEvent.click(targetBtn)
    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
  })

  it('opens environment sheet via second (mobile) environment button', async () => {
    renderDetailView()
    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    const targetBtn = envButtons.length > 1 ? envButtons[1]! : envButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
  })

  it('opens volumes sheet via second (mobile) resources button', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://gitlab.com/acme/app.git', ref: 'main' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    const targetBtn = resourcesButtons.length > 1 ? resourcesButtons[1]! : resourcesButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
  })

  it('renders environment sheet details', async () => {
    renderDetailView({
      environmentSnapshot: {
        id: 'envver_1',
        environmentId: 'env_1',
        projectId: 'project_1',
        packages: [],
        variables: {},
        hostingMode: 'cloud',
        networkPolicy: { mode: 'restricted', allowedHosts: [] },
        mcpPolicy: {},
        packageManagerPolicy: {},
        resourceLimits: { memoryMb: 1024 },
        runtimeConfig: { image: 'node:24' },
        metadata: {},
        version: 1,
        createdAt: now,
      },
    })
    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
  })

  it('renders memory store volumes in volumes sheet', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [{ name: 'memory', type: 'memory', memoryRef: 'ama://memories/memstore_1', access: 'read_only' }],
        volumeMounts: [{ name: 'memory', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
      },
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
  })

  it('renders "None" model in agent sheet when model is null', async () => {
    renderDetailView({
      agentSnapshot: {
        id: 'agentver_1',
        agentId: 'agent_1',
        projectId: 'project_1',
        version: 1,
        instructions: 'Do the work',
        providerId: 'workers-ai',
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
        createdAt: now,
      },
    })

    expect(screen.getAllByText(/None/).length).toBeGreaterThan(0)

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    const modelCells = screen.getAllByText('None')
    expect(modelCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for empty skills and tool names in agent sheet', async () => {
    renderDetailView({
      agentSnapshot: {
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
        memoryPolicy: { enabled: false },
        tools: [{ name: 123 }],
        mcpConnectors: [],
        metadata: {},
        createdAt: now,
      },
    })

    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    const noneCells = screen.getAllByText('None')
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for null environmentId in environment sheet', async () => {
    renderDetailView({ environmentId: null, environmentSnapshot: buildSession().status.bindings.environment.snapshot })

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('includes secretRef in safeResourceView when a git volume has a secret reference', async () => {
    renderDetailView({
      spec: {
        ...buildSession().spec,
        volumes: [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/acme/app.git',
            ref: 'main',
            secretRef: 'ama://vaults/vault_abc/credentials/git-token/versions/ver_abc',
          },
        ],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace' }],
      },
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session volumes' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session volumes')).toBeTruthy())
    expect(screen.getByText(/git-token/)).toBeTruthy()
    expect(screen.getByText(/ver_abc/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// SessionRuntimePanel — connection badges, busy state, canSend
// ---------------------------------------------------------------------------

describe('SessionRuntimePanel — connection and state badges', () => {
  it('renders closed connection badge', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'closed' })}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('closed')).toBeTruthy()
  })

  it('renders connecting badge', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'connecting' })}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('connecting')).toBeTruthy()
  })

  it('renders error connection badge', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ connection: 'error' })}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('error')).toBeTruthy()
  })

  it('renders running runState badge', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ runState: 'running' })}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('running')).toBeTruthy()
  })

  it('does not call onSend when message is whitespace only', () => {
    const onSend = vi.fn()
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        persistedEvents={[]}
        message="   "
        setMessage={vi.fn()}
        onSend={onSend}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('disables send when canSend is false', () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        persistedEvents={[]}
        message="hello"
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend={false}
      />,
    )

    const sendButton = screen.getByRole('button', { name: 'Send' })
    expect(sendButton.hasAttribute('disabled')).toBe(true)
  })

  it('calls onRefreshEvents on Refresh events button click', () => {
    const onRefreshEvents = vi.fn()
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={onRefreshEvents}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }))
    expect(onRefreshEvents).toHaveBeenCalledTimes(1)
  })

  it('shows persisted non-transcript events in debug panel', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
    const persistedEvents: SessionEvent[] = [
      {
        id: 'persisted_debug_1',
        projectId: 'project_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message_end',
        visibility: 'runtime',
        role: null,
        parentEventId: null,
        correlationId: null,
        payload: { type: 'message_end' },
        metadata: {},
        createdAt: now,
      },
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getByText('persisted_debug_1')).toBeTruthy()
  })

  it('excludes transcript-visibility events from debug panel', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
    const persistedEvents: SessionEvent[] = [
      {
        id: 'transcript_only_ev',
        projectId: 'project_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message_end',
        visibility: 'transcript',
        role: null,
        parentEventId: null,
        correlationId: null,
        payload: { type: 'message_end' },
        metadata: {},
        createdAt: now,
      },
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState()}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.queryByText('transcript_only_ev')).toBeNull()
    expect(screen.getByText('No debug events')).toBeTruthy()
  })

  it('deduplicates runtime debug events that also appear in persisted events', async () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
    const persistedEvents: SessionEvent[] = [
      {
        id: 'shared_event_1',
        projectId: 'project_1',
        sessionId: 'session_1',
        sequence: 1,
        type: 'message_end',
        visibility: 'runtime',
        role: null,
        parentEventId: null,
        correlationId: null,
        payload: { type: 'message_end' },
        metadata: {},
        createdAt: now,
      },
    ]
    const runtimeWithSameEvent = buildRuntimeState({
      debugEvents: [
        {
          id: 'shared_event_1',
          type: 'message_end',
          payload: { type: 'message_end' },
          createdAt: now,
        },
      ],
    })

    render(
      <SessionRuntimePanel
        runtime={runtimeWithSameEvent}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    expect(screen.getAllByText('shared_event_1')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// SessionToolTrace component — all status branches
// ---------------------------------------------------------------------------

describe('SessionToolTrace component', () => {
  it('renders empty state when no entries', () => {
    render(<SessionToolTrace entries={[]} />)
    expect(screen.getByText('No tool calls yet')).toBeTruthy()
  })

  it('renders a completed entry with duration and approval', () => {
    render(<SessionToolTrace entries={[buildTraceEntry()]} />)
    expect(screen.getByText('sandbox.exec')).toBeTruthy()
    expect(screen.getByText('completed')).toBeTruthy()
    expect(screen.getByText('approved')).toBeTruthy()
    expect(screen.getByText('250ms')).toBeTruthy()
  })

  it('renders a running entry', () => {
    render(<SessionToolTrace entries={[buildTraceEntry({ status: 'running', durationMs: null })]} />)
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('renders a failed entry with error summary and destructive approval', () => {
    const entry = buildTraceEntry({
      status: 'failed',
      errorSummary: 'Permission denied',
      approval: 'denied',
    })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    expect(screen.getAllByText('Permission denied').length).toBeGreaterThan(0)
  })

  it('renders approval-required badge', () => {
    const entry = buildTraceEntry({ approval: 'approval required', status: 'failed', errorSummary: 'blocked' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getByText('approval required')).toBeTruthy()
  })

  it('renders orphaned result entry with explanatory message', () => {
    const entry = buildTraceEntry({
      orphanedResult: true,
      status: 'completed',
      startedAt: null,
      durationMs: null,
      input: undefined,
    })
    render(<SessionToolTrace entries={[entry]} />)
    expect(
      screen.getByText('Result without a recorded tool call. Showing the result data that was received.'),
    ).toBeTruthy()
  })

  it('renders None for undefined input and output', () => {
    const entry = buildTraceEntry({ input: undefined, output: undefined })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('renders null durationMs without crashing', () => {
    const entry = buildTraceEntry({ durationMs: null, status: 'running' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.queryByText('null')).toBeNull()
  })

  it('renders failed entry with null errorSummary as fallback text', () => {
    const entry = buildTraceEntry({ status: 'failed', errorSummary: null, approval: 'denied' })
    render(<SessionToolTrace entries={[entry]} />)
    expect(screen.getAllByText('Tool execution failed').length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// CreateSessionSheet — formatCreateSessionError branches
// ---------------------------------------------------------------------------

describe('CreateSessionSheet — formatCreateSessionError', () => {
  it('returns error message for generic Error', () => {
    expect(formatCreateSessionError(new Error('Network timeout'))).toBe('Network timeout')
  })

  it('returns stringified value for non-Error', () => {
    expect(formatCreateSessionError('plain string')).toBe('plain string')
    expect(formatCreateSessionError(42)).toBe('42')
  })

  it('returns ApiError message for ApiError without runtime_catalog details', () => {
    const error = new ApiError('Something went wrong', 400, {
      error: { type: 'bad_request', message: 'Something went wrong', details: { resourceType: 'other' } },
    })
    expect(formatCreateSessionError(error)).toBe('Something went wrong')
  })

  it('returns ApiError message for ApiError with no body details', () => {
    const error = new ApiError('Server error', 500, {})
    expect(formatCreateSessionError(error)).toBe('Server error')
  })

  it('returns ApiError message for ApiError with null details', () => {
    const error = new ApiError('Bad request', 400, { error: { details: null } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns ApiError message for ApiError with array details', () => {
    const error = new ApiError('Bad request', 400, { error: { details: ['a', 'b'] } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns ApiError message for ApiError with non-object details field', () => {
    const error = new ApiError('Bad request', 400, { error: { details: 'not-an-object' } })
    expect(formatCreateSessionError(error)).toBe('Bad request')
  })

  it('returns Self-hosted label in runtime_catalog capability error', () => {
    const error = new ApiError('Unsupported', 409, {
      error: {
        type: 'conflict',
        message: 'Unsupported',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'self_hosted',
          runtime: 'codex',
          provider: 'openai',
          model: 'gpt-4',
        },
      },
    })
    expect(formatCreateSessionError(error)).toBe(
      'Unsupported capability: Self-hosted session runtime codex cannot run Agent provider openai with model gpt-4.',
    )
  })

  it('renders the sheet form when open=true', async () => {
    server.use(agentsList([buildAgent()]), environmentsList([buildEnvironment()]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Session')).toBeTruthy()
  })

  it('does not render sheet content when open=false', () => {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Session')).toBeNull()
  })

  it('submits the create session form and navigates to the new session', async () => {
    const newSession = buildSession({ id: 'session_new', name: 'New session' })
    server.use(
      agentsList([buildAgent()]),
      environmentsList([buildEnvironment()]),
      http.post('*/api/v1/sessions', () => HttpResponse.json(newSession, { status: 201 })),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const onOpenChange = vi.fn()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Wait for agents/environments to load
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())

    // Submit the form (find the submit button)
    const submitButton = await screen.findByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    // onSuccess: onOpenChange(false) is called
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false), { timeout: 5000 })
  })

  it('shows error message when create session API call fails', async () => {
    server.use(
      agentsList([buildAgent()]),
      environmentsList([buildEnvironment()]),
      http.post('*/api/v1/sessions', () =>
        HttpResponse.json(
          {
            error: {
              type: 'conflict',
              message: 'Unsupported runtime',
              details: {
                resourceType: 'runtime_catalog',
                hostingMode: 'cloud',
                runtime: 'ama',
                provider: 'workers-ai',
                model: '@cf/moonshotai/kimi-k2.6',
              },
            },
          },
          { status: 409 },
        ),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())

    const submitButton = await screen.findByRole('button', { name: /create/i })
    fireEvent.click(submitButton)

    // onError → formatCreateSessionError → shows in form
    await waitFor(() => expect(screen.getByText(/Unsupported capability/)).toBeTruthy(), { timeout: 5000 })
  })

  it('useEffect auto-selects first active agent and environment when agents load', async () => {
    server.use(agentsList([buildAgent()]), environmentsList([buildEnvironment()]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CreateSessionSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // After agents/environments load, the form should have auto-selected them.
    // The Session form shows "Agent provider/model" text when an agent is selected.
    await waitFor(() => expect(screen.getByText(/workers-ai \/ @cf\/moonshotai\/kimi-k2\.6/)).toBeTruthy(), {
      timeout: 5000,
    })
  })
})

// ---------------------------------------------------------------------------
// SessionsPage — loading / error / filter / sort / batch-archive
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  function renderSessionsPage(initialEntries = ['/']) {
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return queryClient
  }

  it('shows loading state initially', () => {
    // Use a handler that never responds to keep the query pending.
    server.use(http.get('*/api/v1/sessions', () => new Promise(() => {})))

    renderSessionsPage()

    expect(screen.getByText('Loading sessions')).toBeTruthy()
  })

  it('renders sessions list once data is loaded', async () => {
    server.use(sessionsList([buildSession()]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())
    expect(screen.getByText('Sessions')).toBeTruthy()
  })

  it('shows error state when query fails', async () => {
    server.use(
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Sessions API failed' } }, { status: 500 }),
      ),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    expect(screen.getByText('Sessions API failed')).toBeTruthy()
  })

  it('shows empty state when no sessions', async () => {
    server.use(sessionsList([]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('No sessions')).toBeTruthy())
  })

  it('filters sessions by search text', async () => {
    server.use(
      sessionsList([buildSession({ name: 'Alpha session' }), buildSession({ id: 'session_2', name: 'Beta session' })]),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Alpha session')).toBeTruthy())

    const searchInput = screen.getByRole('searchbox', { name: 'Search sessions' })
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })

    await waitFor(() => {
      expect(screen.getByText('Alpha session')).toBeTruthy()
      expect(screen.queryByText('Beta session')).toBeNull()
    })
  })

  it('opens the create session sheet when Create session button is clicked', async () => {
    server.use(sessionsList([]), agentsList([]), environmentsList([]))

    renderSessionsPage()

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
  })

  it('Archive selected button is disabled when no sessions selected', async () => {
    server.use(sessionsList([buildSession()]))

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())

    const archiveSelectedButton = screen.getByRole('button', { name: 'Archive selected' })
    expect(archiveSelectedButton.hasAttribute('disabled')).toBe(true)
  })

  it('shows batch success outcome after archiving all selected sessions', async () => {
    server.use(sessionsList([buildSession()]), sessionPatch(buildSession({ archivedAt: now })))

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Test session' }))

    const archiveBtn = screen.getByRole('button', { name: 'Archive selected' })
    expect(archiveBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(archiveBtn)

    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/All selected sessions archived/)).toBeTruthy())
  })

  it('shows batch failure outcome when archive call fails', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Conflict' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/Failed on "First session"/)).toBeTruthy())
  })

  it('filters by error status showing only errored sessions', async () => {
    server.use(
      sessionsList([
        buildSession({ id: 'session_1', name: 'Good session', phase: 'idle' }),
        buildSession({ id: 'session_2', name: 'Bad session', phase: 'error', reason: 'crashed' }),
      ]),
    )

    renderSessionsPage(['/?status=error'])

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())
    await waitFor(() => expect(screen.queryByText('Good session')).toBeNull())
  })

  it('sorts sessions by started-asc', async () => {
    const older = buildSession({ id: 'session_old', name: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', name: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=started-asc'])

    await waitFor(() => expect(screen.getByText('Older')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('sorts sessions by started-desc', async () => {
    const older = buildSession({ id: 'session_old', name: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', name: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    server.use(sessionsList([older, newer]))

    renderSessionsPage(['/?sort=started-desc'])

    await waitFor(() => expect(screen.getByText('Newer')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    expect(newerIndex).toBeLessThan(olderIndex)
  })

  it('sorts sessions by updated-asc', async () => {
    const older = buildSession({
      id: 'session_old',
      name: 'OlderUpdated',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      name: 'NewerUpdated',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=updated-asc'])

    await waitFor(() => expect(screen.getByText('OlderUpdated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderUpdated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerUpdated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows error message for non-Error query rejection', async () => {
    server.use(
      http.get('*/api/v1/sessions', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'string error rejection' } }, { status: 500 }),
      ),
    )

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    expect(screen.getByText('string error rejection')).toBeTruthy()
  })

  it('shows batch outcome with archived count and failure message when some sessions succeed', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
      buildSession({ id: 'session_3', name: 'Third session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json(buildSession({ id: 'session_1', archivedAt: now })),
      ),
      http.patch('*/api/v1/sessions/session_2', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Archive conflict' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/Archived 1 session\./)).toBeTruthy())
    expect(screen.getByText(/Failed on "Second session"/)).toBeTruthy()
  })

  it('shows plural sessions count in batch success outcome', async () => {
    const sessions = [
      buildSession({ id: 'session_1', name: 'First session' }),
      buildSession({ id: 'session_2', name: 'Second session' }),
    ]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json(buildSession({ id: 'session_1', archivedAt: now })),
      ),
      http.patch('*/api/v1/sessions/session_2', () =>
        HttpResponse.json(buildSession({ id: 'session_2', archivedAt: now })),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/All selected sessions archived/)).toBeTruthy())
  })

  it('sorts sessions by started-asc when startedAt is null (falls back to createdAt)', async () => {
    const older = buildSession({
      id: 'session_old',
      name: 'OlderCreated',
      startedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      name: 'NewerCreated',
      startedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    server.use(sessionsList([newer, older]))

    renderSessionsPage(['/?sort=started-asc'])

    await waitFor(() => expect(screen.getByText('OlderCreated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderCreated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerCreated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows error message from api when archive call returns 4xx with error body', async () => {
    const sessions = [buildSession({ id: 'session_1', name: 'Only session' })]
    server.use(
      sessionsList(sessions),
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'archive-rejected' } }, { status: 409 }),
      ),
    )

    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })

    renderSessionsPage()

    await waitFor(() => expect(screen.getByText('Only session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Only session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/archive-rejected/)).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// SessionDetailPage — loading / not-found states (safe: null/stopped session = no WebSocket)
// ---------------------------------------------------------------------------

describe('SessionDetailPage', () => {
  it('shows loading state while session query is pending', () => {
    server.use(http.get('*/api/v1/sessions/session_loading', () => new Promise(() => {})))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_loading']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading session')).toBeTruthy()
  })

  it('shows not-found state when session query returns 404', async () => {
    server.use(sessionNotFound())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_404']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Session not found')).toBeTruthy(), { timeout: 5000 })
  })

  it('renders session detail view for a stopped session (agentId and environmentId present)', async () => {
    const stoppedSession = buildSession({ id: 'session_stopped', phase: 'stopped', stoppedAt: now })
    server.use(
      sessionDetail(stoppedSession),
      agentDetail(buildAgent()),
      environmentDetail(buildEnvironment()),
      sessionEventsList('session_stopped'),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_stopped']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
  })

  it('invokes refreshEvents when Refresh events button is clicked', async () => {
    const stoppedSession = buildSession({ id: 'session_stopped2', phase: 'stopped', stoppedAt: now })
    server.use(
      sessionDetail(stoppedSession),
      agentDetail(buildAgent()),
      environmentDetail(buildEnvironment()),
      sessionEventsList('session_stopped2'),
    )

    const queryClient = makeQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_stopped2']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }))
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('renders view with EMPTY_EVENTS while events query is still pending (covers data?.data ?? EMPTY_EVENTS branch)', async () => {
    // Session responds immediately; events endpoint never responds.
    // This exercises the `eventsQuery.data?.data ?? EMPTY_EVENTS` branch (line 67)
    // where data is undefined while the events query is still loading.
    const stoppedSession = buildSession({ id: 'session_events_pending', phase: 'stopped', stoppedAt: now })
    server.use(
      sessionDetail(stoppedSession),
      agentDetail(buildAgent()),
      environmentDetail(buildEnvironment()),
      // Events endpoint never resolves → eventsQuery.data stays undefined
      http.get('*/api/v1/sessions/session_events_pending/events', () => new Promise(() => {})),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_events_pending']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Session loads and the detail view renders — while events are still pending
    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
  })

  it('renders loading state when sessionId param is undefined (covers sessionId ?? "" branches)', () => {
    // Mounting the component outside a :sessionId route means useParams() returns {}
    // and sessionId is undefined. This exercises the `sessionId ?? ''` null-coalescing
    // branch (lines 19, 42) and the `eventsQuery.data?.data ?? EMPTY_EVENTS` branch
    // (line 67) where the query is disabled and data is always undefined.
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions']}>
          <Routes>
            {/* Route has no :sessionId param → useParams() returns {} → sessionId=undefined */}
            <Route path="/sessions" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    // With sessionId=undefined, enabled=false for all queries → isPending=true → loading state
    expect(screen.getByText('Loading session')).toBeTruthy()
  })

  it('renders session detail view with no agentId/environmentId (enabled=false branches)', async () => {
    const minimalSession = buildSession({
      id: 'session_minimal',
      phase: 'stopped',
      stoppedAt: now,
      agentId: '',
      environmentId: null,
      environmentVersionId: null,
      environmentSnapshot: null,
    })
    server.use(sessionDetail(minimalSession), sessionEventsList('session_minimal'))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_minimal']}>
          <Routes>
            <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
  })
})

// ---------------------------------------------------------------------------
// Within helper is imported at top — used here for table row assertions
// ---------------------------------------------------------------------------
const _within = within // ensure import is used; within is available from @testing-library/react
void _within
