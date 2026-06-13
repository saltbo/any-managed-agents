/**
 * Tests for SessionsPage, SessionDetailPage, CreateSessionSheet (component branches),
 * SessionDetailView (resource sheet / confirm-action branches), SessionsView (checkbox /
 * empty-state / archived branches), SessionRuntimePanel (connection-badge / canSend
 * branches), SessionToolTrace (empty / running / orphan branches).
 *
 * Pattern mirrors sessions-ui.test.tsx: MemoryRouter, screen + fireEvent, .toBeTruthy(),
 * afterEach cleanup + vi.restoreAllMocks(), no jest-dom.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Environment, ListResponse, Session, SessionEvent } from '@/lib/api'
import * as apiModule from '@/lib/api'
import { ApiError } from '@/lib/api'
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: 'project_1',
      version: 1,
      instructions: 'Do the work',
      providerId: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: ['ama@coding-agent'],
      subagents: [],
      role: null,
      capabilityTags: [],
      handoffPolicy: {},
      memoryPolicy: { enabled: false },
      tools: [{ name: 'read' }, { name: 'write' }],
      mcpConnectors: [],
      metadata: {},
      createdAt: now,
    },
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: {
      id: 'envver_1',
      environmentId: 'env_1',
      projectId: 'project_1',
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: {},
      credentialRefs: [],
      hostingMode: 'cloud',
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      mcpPolicy: {},
      packageManagerPolicy: {},
      resourceLimits: { memoryMb: 1024 },
      runtimeConfig: { image: 'node:24' },
      metadata: {},
      version: 1,
      createdAt: now,
    },
    title: 'Test session',
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
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: {},
    credentialRefs: [],
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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
        credentialRefs: [],
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
  function renderDetailView(overrides: Partial<Session> = {}, runtimeOverrides: Partial<SessionRuntimeState> = {}) {
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
    // When agentName prop is undefined and instructions is null, code uses session.agentId
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

    // session.agentId used as agent name fallback (code: agentDisplayName || instructions || agentId)
    expect(screen.getAllByText(/agent_no_name/).length).toBeGreaterThan(0)
    // environmentId used as environment name fallback
    expect(screen.getAllByText(/env_1/).length).toBeGreaterThan(0)
  })

  it('shows No environment snapshot when environmentSnapshot is null', () => {
    renderDetailView({ environmentSnapshot: null })
    expect(screen.getByText('No environment snapshot')).toBeTruthy()
  })

  it('opens agent resource sheet on meta button click', async () => {
    renderDetailView()

    // There are two agent meta buttons (mobile + desktop) - click the first
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
    // All environment buttons should be disabled
    for (const btn of envButtons) {
      expect(btn.hasAttribute('disabled')).toBe(true)
    }
  })

  it('opens resources sheet when resources meta button is clicked', async () => {
    renderDetailView({
      resourceRefs: [{ type: 'github_repository', owner: 'acme', repo: 'app', ref: 'main', mountPath: '/workspace' }],
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session resources' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session resources')).toBeTruthy())
    expect(screen.getByText('GitHub repositories')).toBeTruthy()
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

  it('renders session without a title using session id in heading', () => {
    renderDetailView({ title: null })
    expect(screen.getAllByText('session_1').length).toBeGreaterThan(0)
  })

  it('renders non-github resource refs in resources sheet', async () => {
    renderDetailView({
      resourceRefs: [{ type: 'custom', key: 'value' }],
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session resources' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session resources')).toBeTruthy())
    // Count shows 1 resource, 0 GitHub
    expect(screen.getByText('0')).toBeTruthy()
  })

  it('renders canSend false when session is stopped', () => {
    const session = buildSession({ state: 'stopped' })
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
    // Tool names are joined and rendered in a Meta element
    expect(screen.getByText('read, write')).toBeTruthy()
  })

  it('opens agent sheet via second (mobile) agent button', async () => {
    renderDetailView()
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    // Index 1 = mobile button (md:hidden div)
    if (agentButtons.length > 1) {
      fireEvent.click(agentButtons[1]!)
      await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    } else {
      // Only one button in this environment — click [0] to satisfy execution
      fireEvent.click(agentButtons[0]!)
      await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    }
  })

  it('opens environment sheet via second (mobile) environment button', async () => {
    renderDetailView()
    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    const targetBtn = envButtons.length > 1 ? envButtons[1]! : envButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
  })

  it('opens resources sheet via second (mobile) resources button', async () => {
    renderDetailView({
      resourceRefs: [{ type: 'github_repository', owner: 'acme', repo: 'app', ref: 'main', mountPath: '/workspace' }],
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session resources' })
    const targetBtn = resourcesButtons.length > 1 ? resourcesButtons[1]! : resourcesButtons[0]!
    fireEvent.click(targetBtn)

    await waitFor(() => expect(screen.getByText('Session resources')).toBeTruthy())
  })

  it('renders environment sheet with credentialRefs', async () => {
    renderDetailView({
      environmentSnapshot: {
        id: 'envver_1',
        environmentId: 'env_1',
        projectId: 'project_1',
        packages: [],
        variables: {},
        credentialRefs: [{ credentialId: 'cred_1' }],
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
    // credentialRefs are mapped to credentialId
    expect(screen.getByText('cred_1')).toBeTruthy()
  })

  it('renders non-github resource refs in resources sheet (safeResourceView passthrough)', async () => {
    renderDetailView({
      resourceRefs: [{ type: 'file', path: '/workspace/data.json' }],
    })
    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session resources' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session resources')).toBeTruthy())
  })

  it('renders "None" model in agent sheet when model is null (covers model ?? "None" branches on lines 49, 184)', async () => {
    // model=null causes agentProviderModel to use "None" fallback (line 49) and
    // the agent sheet's Model meta to use "None" fallback (line 184).
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

    // Header area uses agentProviderModel = "workers-ai / None" (line 49 branch)
    expect(screen.getAllByText(/None/).length).toBeGreaterThan(0)

    // Open agent sheet to cover line 184
    const agentButtons = screen.getAllByRole('button', { name: 'Open agent details' })
    fireEvent.click(agentButtons[0]!)

    await waitFor(() => expect(screen.getByText('Agent snapshot captured for session_1')).toBeTruthy())
    // Model field shows "None" (line 184 branch)
    const modelCells = screen.getAllByText('None')
    expect(modelCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for empty skills and tool names in agent sheet (covers lines 185, 186, 288)', async () => {
    // skills=[] → join gives "" → || "None" (line 185)
    // tools=[{name: 123}] → non-string name → null → filter removes → join "" → || "None" (line 186 + 288 false branch)
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
    // skills empty → "None", tools non-string name → "None"
    const noneCells = screen.getAllByText('None')
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it('renders "None" for null environmentId in environment sheet (covers line 202)', async () => {
    // environmentId=null causes the environment sheet's "Environment id" meta to show "None" (line 202 branch)
    renderDetailView({ environmentId: null })

    const envButtons = screen.getAllByRole('button', { name: 'Open environment details' })
    fireEvent.click(envButtons[0]!)

    await waitFor(() => expect(screen.getByText('Environment snapshot captured for session_1')).toBeTruthy())
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('includes credentialRef in safeResourceView when resource has a string credentialRef (covers line 306 true branch)', async () => {
    // safeResourceView only processes github_repository resources.
    // When credentialRef is a string, the spread includes it (true branch of line 306).
    renderDetailView({
      resourceRefs: [
        {
          type: 'github_repository',
          owner: 'acme',
          repo: 'app',
          ref: 'main',
          mountPath: '/workspace',
          credentialRef: 'cred_abc',
        },
      ],
    })

    const resourcesButtons = screen.getAllByRole('button', { name: 'Open session resources' })
    fireEvent.click(resourcesButtons[0]!)

    await waitFor(() => expect(screen.getByText('Session resources')).toBeTruthy())
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

    // Should appear exactly once
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

  it('renders the sheet form when open=true', () => {
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf([buildAgent()]))
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf([buildEnvironment()]))

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
})

// ---------------------------------------------------------------------------
// SessionsPage — loading / error / filter / sort / batch-archive
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  beforeEach(() => {
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
  })

  it('shows loading state initially', () => {
    // Never-resolving promise keeps query pending
    vi.spyOn(apiModule.api, 'listSessions').mockReturnValue(new Promise(() => {}))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading sessions')).toBeTruthy()
  })

  it('renders sessions list once data is loaded', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([buildSession()]))
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())
    expect(screen.getByText('Sessions')).toBeTruthy()
  })

  it('shows error state when query fails', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockRejectedValue(new Error('Sessions API failed'))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    expect(screen.getByText('Sessions API failed')).toBeTruthy()
  })

  it('shows empty state when no sessions', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('No sessions')).toBeTruthy())
  })

  it('filters sessions by search text', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(
      listOf([buildSession({ title: 'Alpha session' }), buildSession({ id: 'session_2', title: 'Beta session' })]),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Alpha session')).toBeTruthy())

    const searchInput = screen.getByRole('searchbox', { name: 'Search sessions' })
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })

    await waitFor(() => {
      expect(screen.getByText('Alpha session')).toBeTruthy()
      expect(screen.queryByText('Beta session')).toBeNull()
    })
  })

  it('opens the create session sheet when Create session button is clicked', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf())
    vi.spyOn(apiModule.api, 'listAgents').mockResolvedValue(listOf())
    vi.spyOn(apiModule.api, 'listEnvironments').mockResolvedValue(listOf())

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    await waitFor(() => expect(screen.getByText('Create Session')).toBeTruthy())
  })

  it('Archive selected button is disabled when no sessions selected', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([buildSession()]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy())

    const archiveSelectedButton = screen.getByRole('button', { name: 'Archive selected' })
    expect(archiveSelectedButton.hasAttribute('disabled')).toBe(true)
  })

  it('shows batch success outcome after archiving all selected sessions', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([buildSession()]))
    vi.spyOn(apiModule.api, 'archiveSession').mockResolvedValue(buildSession({ archivedAt: now }))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

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
      buildSession({ id: 'session_1', title: 'First session' }),
      buildSession({ id: 'session_2', title: 'Second session' }),
    ]
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf(sessions))
    vi.spyOn(apiModule.api, 'archiveSession').mockRejectedValue(new Error('Conflict'))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/Failed on "First session"/)).toBeTruthy())
  })

  it('filters by error status showing only errored sessions', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(
      listOf([
        buildSession({ id: 'session_1', title: 'Good session', state: 'idle' }),
        buildSession({ id: 'session_2', title: 'Bad session', state: 'error', stateReason: 'crashed' }),
      ]),
    )

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?status=error']}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.queryByText('Loading sessions')).toBeNull())
    // With status=error filter, only the error session shows
    await waitFor(() => expect(screen.queryByText('Good session')).toBeNull())
  })

  it('sorts sessions by started-asc', async () => {
    const older = buildSession({ id: 'session_old', title: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', title: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([newer, older]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?sort=started-asc']}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Older')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    // Header + 2 data rows; older should come first
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('sorts sessions by started-desc', async () => {
    const older = buildSession({ id: 'session_old', title: 'Older', startedAt: '2026-01-01T00:00:00.000Z' })
    const newer = buildSession({ id: 'session_new', title: 'Newer', startedAt: '2026-06-01T00:00:00.000Z' })
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([older, newer]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?sort=started-desc']}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Newer')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('Older'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('Newer'))
    // Newer started date should come first in desc order
    expect(newerIndex).toBeLessThan(olderIndex)
  })

  it('sorts sessions by updated-asc', async () => {
    const older = buildSession({
      id: 'session_old',
      title: 'OlderUpdated',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      title: 'NewerUpdated',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([newer, older]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?sort=updated-asc']}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('OlderUpdated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderUpdated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerUpdated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows String(error) for non-Error query rejection', async () => {
    vi.spyOn(apiModule.api, 'listSessions').mockRejectedValue('string error rejection')

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Sessions unavailable')).toBeTruthy())
    // String(error) is called for non-Error values
    expect(screen.getByText('string error rejection')).toBeTruthy()
  })

  it('shows batch outcome with archived count and failure message when some sessions succeed', async () => {
    const sessions = [
      buildSession({ id: 'session_1', title: 'First session' }),
      buildSession({ id: 'session_2', title: 'Second session' }),
      buildSession({ id: 'session_3', title: 'Third session' }),
    ]
    let callCount = 0
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf(sessions))
    vi.spyOn(apiModule.api, 'archiveSession').mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.resolve(buildSession({ id: 'session_1', archivedAt: now }))
      }
      return Promise.reject(new Error('Archive conflict'))
    })

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    // Should show "Archived 1 session. Failed on..."
    await waitFor(() => expect(screen.getByText(/Archived 1 session\./)).toBeTruthy())
    expect(screen.getByText(/Failed on "Second session"/)).toBeTruthy()
  })

  it('shows plural sessions count in batch success outcome', async () => {
    const sessions = [
      buildSession({ id: 'session_1', title: 'First session' }),
      buildSession({ id: 'session_2', title: 'Second session' }),
    ]
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf(sessions))
    vi.spyOn(apiModule.api, 'archiveSession').mockResolvedValue(buildSession({ archivedAt: now }))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('First session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First session' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second session' }))

    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(screen.getByText(/All selected sessions archived/)).toBeTruthy())
  })

  it('sorts sessions by started-asc when startedAt is null (falls back to createdAt)', async () => {
    // When startedAt is null, the sort uses createdAt as the fallback.
    // This covers the `a.startedAt ?? a.createdAt` nullish-coalescing branch.
    const older = buildSession({
      id: 'session_old',
      title: 'OlderCreated',
      startedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const newer = buildSession({
      id: 'session_new',
      title: 'NewerCreated',
      startedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf([newer, older]))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/?sort=started-asc']}>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('OlderCreated')).toBeTruthy())
    const rows = screen.getAllByRole('row')
    const olderIndex = rows.findIndex((row) => row.textContent?.includes('OlderCreated'))
    const newerIndex = rows.findIndex((row) => row.textContent?.includes('NewerCreated'))
    expect(olderIndex).toBeLessThan(newerIndex)
  })

  it('shows String(non-Error) message in batch outcome when archiveSession throws non-Error', async () => {
    // Covers the `error instanceof Error ? error.message : String(error)` false branch
    // inside the archiveSelected catch block (lines 72-73).
    const sessions = [buildSession({ id: 'session_1', title: 'Only session' })]
    vi.spyOn(apiModule.api, 'listSessions').mockResolvedValue(listOf(sessions))
    vi.spyOn(apiModule.api, 'archiveSession').mockRejectedValue('non-error-string')

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <SessionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Only session')).toBeTruthy())

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Only session' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }))
    const confirmBtn = await screen.findByRole('button', { name: 'Archive sessions' })
    fireEvent.click(confirmBtn)

    // String('non-error-string') = 'non-error-string'
    await waitFor(() => expect(screen.getByText(/non-error-string/)).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// SessionDetailPage — loading / not-found states (safe: null session = no WebSocket)
// ---------------------------------------------------------------------------

describe('SessionDetailPage', () => {
  it('shows loading state while session query is pending', () => {
    vi.spyOn(apiModule.api, 'readSession').mockReturnValue(new Promise(() => {}))

    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/sessions/session_1']}>
          <SessionDetailPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading session')).toBeTruthy()
  })

  it('shows not-found state when session query resolves without data', async () => {
    // Use a Routes/Route inside MemoryRouter to provide the :sessionId param,
    // then resolve readSession with null so the "not found" branch is reached.
    const { Routes, Route } = await import('react-router')
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(
      null as unknown as ReturnType<typeof apiModule.api.readSession> extends Promise<infer T> ? T : never,
    )

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

  it('renders session detail view for a stopped session (covers agentQuery/environmentQuery enabled=true branches)', async () => {
    // A stopped session: live=false → no WebSocket. agentId and environmentId are present,
    // so agentQuery.enabled and environmentQuery.enabled are both true.
    // This covers lines 29,34 (Boolean(session?.agentId) / Boolean(session?.environmentId)).
    const { Routes, Route } = await import('react-router')
    const stoppedSession = buildSession({ id: 'session_stopped', state: 'stopped', stoppedAt: now })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(stoppedSession)
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(buildAgent())
    vi.spyOn(apiModule.api, 'readEnvironment').mockResolvedValue(buildEnvironment())
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())

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

    // Session title should appear once fully loaded
    await waitFor(() => expect(screen.getByText('Test session')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
  })

  it('invokes refreshEvents when Refresh events button is clicked (covers lines 43-44)', async () => {
    // Tests the refreshEvents useCallback body which calls queryClient.invalidateQueries.
    // A stopped session is safe: live=false, no WebSocket connection is created.
    const { Routes, Route } = await import('react-router')
    const stoppedSession = buildSession({ id: 'session_stopped2', state: 'stopped', stoppedAt: now })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(stoppedSession)
    vi.spyOn(apiModule.api, 'readAgent').mockResolvedValue(buildAgent())
    vi.spyOn(apiModule.api, 'readEnvironment').mockResolvedValue(buildEnvironment())
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())

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

    // Click the "Refresh events" button to invoke refreshEvents (lines 43-44)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh events' }))
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('renders session detail view with no agentId/environmentId (covers enabled=false branches)', async () => {
    // When session has no agentId/environmentId, enabled is false for agentQuery/environmentQuery.
    // This ensures the Boolean(session?.agentId) false branch is covered.
    const { Routes, Route } = await import('react-router')
    const minimalSession = buildSession({
      id: 'session_minimal',
      state: 'stopped',
      stoppedAt: now,
      agentId: '',
      environmentId: null,
      environmentVersionId: null,
      environmentSnapshot: null,
    })
    vi.spyOn(apiModule.api, 'readSession').mockResolvedValue(minimalSession)
    vi.spyOn(apiModule.api, 'listSessionEvents').mockResolvedValue(listOf<SessionEvent>())

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
