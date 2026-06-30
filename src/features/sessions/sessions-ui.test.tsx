import { AMA_SESSION_EVENT_CATEGORIES, AMA_SESSION_EVENT_TYPES, amaSessionEventLabel } from '@shared/session-events'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '@/console/format'
import { SessionForm } from '@/console/forms'
import { useClientPagination } from '@/console/use-client-pagination'
import { type Agent, ApiError, type Environment, type Session, type EventRecord } from '@/lib/amarpc'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { formatCreateSessionError } from './CreateSessionSheet'
import { SessionDetailView } from './SessionDetailView'
import { eventFilter, SessionRuntimePanel } from './SessionRuntimePanel'
import { SessionsView } from './SessionsView'
import type { SessionRuntimeState } from './session-runtime'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ name: 'First run workflow', ...overrides })
}

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['tsx@latest'], pip: [] },
    networking: {
      type: 'limited',
      allowMcpServers: false,
      allowPackageManagers: true,
      allowedHosts: ['registry.npmjs.org'],
    },
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

type EventRecordOverrides = Partial<Omit<EventRecord, 'event'>> & {
  type?: EventRecord['event']['type']
  payload?: Record<string, unknown>
  metadata?: Record<string, unknown>
  event?: EventRecord['event']
}

function buildPersistedEvent(overrides: EventRecordOverrides = {}): EventRecord {
  const {
    type = overrides.event?.type ?? 'message_end',
    payload = overrides.event?.payload ?? {
      message: { role: 'assistant', content: 'Runtime failed to start' },
    },
    metadata = overrides.event?.metadata ?? {},
    event: eventOverride,
    ...recordOverrides
  } = overrides
  return {
    id: 'event_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence: 1,
    visibility: 'runtime',
    role: null,
    parentEventId: null,
    correlationId: null,
    event: eventOverride ?? ({ type, payload, metadata } as EventRecord['event']),
    createdAt: '2026-05-23T00:00:00.000Z',
    ...recordOverrides,
  }
}

function buildRuntimeState(overrides: Partial<SessionRuntimeState> = {}): SessionRuntimeState {
  return {
    connection: 'open',
    runState: 'idle',
    messages: [
      {
        id: 'message_1',
        role: 'assistant',
        content: 'Runtime failed to start',
        status: 'error',
        createdAt: '2026-05-23T00:00:00.000Z',
      },
    ],
    tools: [],
    debugEvents: [
      {
        id: 'debug_1',
        type: 'runtime.error',
        payload: {
          message: 'Runtime failed to start',
        },
        createdAt: '2026-05-23T00:00:00.000Z',
      },
    ],
    eventKeys: [],
    error: 'Runtime failed to start',
    ...overrides,
  }
}

describe('[spec: sessions/console-detail] [spec: sessions/console-transcript] sessions UI contracts', () => {
  it('shows Agent-owned provider/model, Environment-owned hosting, and Session-owned runtime in session creation', () => {
    render(
      <SessionForm
        value={{
          agentId: 'agent_1',
          environmentId: 'env_1',
          runtime: 'ama',
          prompt: 'Run session',
          credentialVaultIds: [],
          resources: [],
        }}
        setValue={vi.fn()}
        agents={[buildAgent()]}
        environments={[buildEnvironment({ type: 'self_hosted' })]}
        onSubmit={vi.fn()}
      />,
    )

    expect(screen.getByText('Agent provider/model: workers-ai / @cf/moonshotai/kimi-k2.6')).toBeTruthy()
    expect(screen.getByText('Environment type: Self-hosted')).toBeTruthy()
    expect(screen.getByText('Runtime is selected per session.')).toBeTruthy()
    expect(screen.getAllByText('AMA').length).toBeGreaterThan(0)
  })

  it('formats structured runtime capability failures with exact runtime provider and model', () => {
    const error = new ApiError('Unsupported runtime provider/model combination', 409, {
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'ama',
          provider: 'workers-ai',
          model: '@cf/moonshotai/kimi-k2.6',
        },
      },
    })

    expect(formatCreateSessionError(error)).toBe(
      'Unsupported capability: Cloud session runtime ama cannot run Agent provider workers-ai with model @cf/moonshotai/kimi-k2.6.',
    )
  })

  it('keeps error status detail off the table row while preserving pagination and adaptive surface', () => {
    const sessions = Array.from({ length: 11 }, (_, index) =>
      buildSession({
        id: `session_${index + 1}`,
        name: `Session ${index + 1}`,
        phase: index === 0 ? 'error' : 'idle',
        reason: index === 0 ? 'Runtime crashed' : null,
      }),
    )
    function Harness() {
      const pagination = useClientPagination(sessions)
      return (
        <MemoryRouter>
          <SessionsView
            sessions={pagination.items}
            pagination={pagination}
            selectedIds={[]}
            setSelectedIds={vi.fn()}
            onArchive={vi.fn()}
          />
        </MemoryRouter>
      )
    }

    render(<Harness />)

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    const badgeTrigger = screen.getByLabelText('error: Runtime crashed')
    expect(screen.queryByText('Runtime crashed')).toBeNull()
    expect(badgeTrigger.getAttribute('aria-label')).toBe('error: Runtime crashed')
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-auto')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.parentElement?.className).toContain(
      'overflow-hidden',
    )

    const viewport = table.closest('[data-slot="table-container"]')?.parentElement as HTMLDivElement
    viewport.scrollTop = 72
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
    expect(screen.getByText('Session 11')).toBeTruthy()
    expect(viewport.scrollTop).toBe(0)
  })

  it('renders one table row for one error session', () => {
    const session = buildSession({ phase: 'error', reason: 'Runtime crashed' })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={{
            items: [session],
            page: 1,
            pageCount: 1,
            pageSize: 10,
            total: 1,
            start: 1,
            end: 1,
            canPrevious: false,
            canNext: false,
            viewportRef: { current: null },
            previous: vi.fn(),
            next: vi.fn(),
          }}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    const badgeTrigger = screen.getByLabelText('error: Runtime crashed')
    expect(screen.queryByText('Runtime crashed')).toBeNull()
    expect(badgeTrigger.getAttribute('aria-label')).toBe('error: Runtime crashed')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.className).toContain('overflow-auto')
    expect(table.closest('[data-slot="table-container"]')?.parentElement?.parentElement?.className).toContain(
      'overflow-hidden',
    )
  })

  it('renders session rows from Agent provider/model, hosting snapshots, and session runtime', () => {
    const session = buildSession({
      environmentSnapshot: {
        ...buildSession().status.bindings.environment.snapshot!,
        type: 'self_hosted',
      },
      spec: { ...buildSession().spec, runtime: 'codex' },
      status: {
        placement: { ...buildSession().status.placement!, hostingMode: 'self_hosted' },
      },
    })
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[session]}
          pagination={{
            items: [session],
            page: 1,
            pageCount: 1,
            pageSize: 10,
            total: 1,
            start: 1,
            end: 1,
            canPrevious: false,
            canNext: false,
            viewportRef: { current: null },
            previous: vi.fn(),
            next: vi.fn(),
          }}
          selectedIds={[]}
          setSelectedIds={vi.fn()}
          onArchive={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Agent provider/model')).toBeTruthy()
    expect(screen.getByText('Hosting / runtime')).toBeTruthy()
    expect(screen.getAllByText('workers-ai / @cf/moonshotai/kimi-k2.6').length).toBeGreaterThan(0)
    expect(screen.getByText('Self-hosted / codex · env_1')).toBeTruthy()
    expect(screen.queryByText(/legacy-provider|legacy-model/)).toBeNull()
  })

  it('renders session detail facts from agent and environment snapshots instead of legacy model fields', () => {
    const session = buildSession({
      phase: 'pending',
      reason: 'waiting-for-runner',
      environmentSnapshot: {
        ...buildSession().status.bindings.environment.snapshot!,
        type: 'self_hosted',
      },
      spec: { ...buildSession().spec, runtime: 'codex' },
      status: {
        placement: { ...buildSession().status.placement!, hostingMode: 'self_hosted' },
      },
    })

    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState({ messages: [], tools: [], debugEvents: [], error: null })}
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

    expect(screen.getByText('Agent provider/model')).toBeTruthy()
    expect(screen.getByText('workers-ai / @cf/moonshotai/kimi-k2.6')).toBeTruthy()
    expect(screen.getByText('Hosting / runtime')).toBeTruthy()
    expect(screen.getByText('Self-hosted / codex')).toBeTruthy()
    expect(screen.getByText('Environment type')).toBeTruthy()
    expect(screen.getByText('self_hosted')).toBeTruthy()
    expect(screen.getByText('Runtime status')).toBeTruthy()
    expect(screen.getByText('waiting-for-runner')).toBeTruthy()
    expect(screen.queryByText(/legacy-provider|legacy-model/)).toBeNull()
  })

  it('renders memory store resources without exposing memory contents', () => {
    const session = buildSession({
      spec: {
        ...buildSession().spec,
        volumes: [
          {
            type: 'memory',
            name: 'Team memory',
            memoryRef: 'ama://memories/memstore_1',
            description: 'Shared runbook',
            access: 'read_write',
          },
        ],
        volumeMounts: [{ name: 'Team memory', mountPath: '/workspace/.ama/memory-stores/memstore_1' }],
      },
    })

    render(
      <MemoryRouter>
        <SessionDetailView
          session={session}
          agentName="Coding agent"
          environmentName="Node workspace"
          events={[]}
          runtime={buildRuntimeState({ messages: [], tools: [], debugEvents: [], error: null })}
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

    fireEvent.click(screen.getAllByLabelText('Open session volumes')[0]!)
    expect(screen.getByText('Session volumes')).toBeTruthy()
    expect(screen.getByText(/memstore_1/)).toBeTruthy()
    expect(screen.queryByText(/secret content/)).toBeNull()
  })

  it('renders transcript timestamps in message metadata without exposing raw payloads in transcript mode', () => {
    const runtime = buildRuntimeState()
    const persistedEvents = [buildPersistedEvent()]

    render(
      <SessionRuntimePanel
        runtime={runtime}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    const article = screen.getByText('Runtime failed to start').closest('article')
    expect(article).toBeTruthy()
    expect(within(article as HTMLElement).getByText(formatTime(runtime.messages[0]?.createdAt ?? null))).toBeTruthy()
    expect(within(article as HTMLElement).getByLabelText('Error: Runtime failed to start')).toBeTruthy()
    expect(screen.queryByText(/"message":/)).toBeNull()
  })

  it('keeps canonical payload JSON in debug while transcript renders structured message, tool, lifecycle, usage, error, and metadata rows', async () => {
    const runtime = buildRuntimeState({
      messages: [
        {
          id: 'message_1',
          role: 'assistant',
          content: 'Structured answer',
          status: 'complete',
          createdAt: '2026-05-23T00:00:00.000Z',
        },
      ],
      tools: [
        {
          id: 'tool_1:2026-05-23T00:00:01.000Z',
          callId: 'tool_1',
          name: 'read_file',
          status: 'success',
          input: { path: 'README.md' },
          output: 'ok',
          error: null,
          durationMs: 12,
          createdAt: '2026-05-23T00:00:01.000Z',
          updatedAt: '2026-05-23T00:00:01.000Z',
          eventType: 'tool_execution_end',
        },
      ],
      debugEvents: [
        ...AMA_SESSION_EVENT_TYPES.map((type, index) => ({
          id: `debug_${type}`,
          type,
          payload: { type, safe: true, marker: `payload_${type}` },
          createdAt: new Date((index + 1) * 1000).toISOString(),
        })),
      ],
    })

    render(
      <SessionRuntimePanel
        runtime={runtime}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('Structured answer')).toBeTruthy()
    expect(screen.getByText('read_file')).toBeTruthy()
    expect(screen.queryByText(/payload_runtime.error/)).toBeNull()

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    for (const type of AMA_SESSION_EVENT_TYPES) {
      expect(screen.getByText(amaSessionEventLabel(type))).toBeTruthy()
      expect(screen.getByText(`debug_${type}`)).toBeTruthy()
    }
    for (const category of AMA_SESSION_EVENT_CATEGORIES) {
      expect(screen.getAllByText(category).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(/payload_runtime.error/)).toBeTruthy()
  })

  it('renders the tool trace tab with paired, failed, and orphaned executions from persisted events', async () => {
    const persistedEvents = [
      buildPersistedEvent({
        id: 'event_tool_start',
        sequence: 2,
        type: 'tool_execution_start',
        parentEventId: 'event_turn',
        correlationId: 'tool:call_ok',
        payload: { toolCallId: 'call_ok', toolName: 'bash', args: { command: 'git status' } },
        createdAt: '2026-05-23T00:00:00.000Z',
      }),
      buildPersistedEvent({
        id: 'event_tool_end',
        sequence: 3,
        type: 'tool_execution_end',
        parentEventId: 'event_turn',
        correlationId: 'tool:call_ok',
        payload: {
          toolCallId: 'call_ok',
          toolName: 'bash',
          result: { content: [{ type: 'text', text: 'clean tree' }] },
          isError: false,
        },
        createdAt: '2026-05-23T00:00:01.250Z',
      }),
      buildPersistedEvent({
        id: 'event_tool_fail_start',
        sequence: 4,
        type: 'tool_execution_start',
        parentEventId: 'event_turn',
        correlationId: 'tool:call_fail',
        payload: { toolCallId: 'call_fail', toolName: 'write', args: { path: 'x', apiKey: '[REDACTED]' } },
        createdAt: '2026-05-23T00:00:02.000Z',
      }),
      buildPersistedEvent({
        id: 'event_tool_fail_end',
        sequence: 5,
        type: 'tool_execution_end',
        parentEventId: 'event_turn',
        correlationId: 'tool:call_fail',
        payload: {
          toolCallId: 'call_fail',
          toolName: 'write',
          result: { content: [{ type: 'text', text: 'write denied' }] },
          isError: true,
        },
        createdAt: '2026-05-23T00:00:02.040Z',
      }),
      buildPersistedEvent({
        id: 'event_tool_orphan',
        sequence: 6,
        type: 'tool_execution_end',
        parentEventId: 'event_turn',
        correlationId: 'tool:call_orphan',
        payload: {
          toolCallId: 'call_orphan',
          toolName: 'read',
          result: { content: [{ type: 'text', text: 'orphan output' }] },
          isError: false,
        },
        createdAt: '2026-05-23T00:00:03.000Z',
      }),
    ]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ messages: [], tools: [], debugEvents: [], error: null })}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    const toolsTab = screen.getByRole('tab', { name: 'Tools' })
    fireEvent.pointerDown(toolsTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(toolsTab)
    fireEvent.mouseUp(toolsTab)
    fireEvent.click(toolsTab)
    await waitFor(() => expect(toolsTab.getAttribute('aria-selected')).toBe('true'))

    const completedEntry = screen.getByText('bash').closest('details') as HTMLDetailsElement
    expect(completedEntry.getAttribute('data-status')).toBe('completed')
    expect(within(completedEntry).getByText('approved')).toBeTruthy()
    expect(within(completedEntry).getByText('1.3s')).toBeTruthy()
    expect(within(completedEntry).getByText('clean tree')).toBeTruthy()

    const failedEntry = screen.getByText('write').closest('details') as HTMLDetailsElement
    expect(failedEntry.getAttribute('data-status')).toBe('failed')
    expect(failedEntry.className).toContain('destructive')
    expect(completedEntry.className).not.toContain('destructive')
    expect(within(failedEntry).getByText('failed')).toBeTruthy()
    expect(within(failedEntry).getAllByText('write denied').length).toBeGreaterThan(0)
    expect(within(failedEntry).getByText(/"apiKey": "\[REDACTED\]"/)).toBeTruthy()

    const orphanEntry = screen.getByText('read').closest('details') as HTMLDetailsElement
    expect(
      within(orphanEntry).getByText('Result without a recorded tool call. Showing the result data that was received.'),
    ).toBeTruthy()
  })

  it('renders transcript and debug empty states', async () => {
    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ messages: [], tools: [], debugEvents: [], error: null })}
        persistedEvents={[]}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    expect(screen.getByText('No messages yet')).toBeTruthy()
    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByText('No debug events')).toBeTruthy()
  })

  it('copies and downloads debug event exports without adding payload JSON to transcript', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const createObjectURL = vi.fn(() => 'blob:session-events')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = createElement(tagName, options)
      if (tagName === 'a') {
        element.click = vi.fn()
      }
      return element
    })
    const persistedEvents = [buildPersistedEvent()]

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({ debugEvents: [] })}
        persistedEvents={persistedEvents}
        message=""
        setMessage={vi.fn()}
        onSend={vi.fn()}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy events' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"message_end"')))

    fireEvent.click(screen.getByRole('button', { name: 'Download events' }))
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:session-events')
    expect(screen.queryByText(/"payload":/)).toBeNull()
  })

  it('submits trimmed runtime messages and parses debug event filters', () => {
    const onSend = vi.fn()
    const setMessage = vi.fn()

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          messages: [],
          tools: [],
          debugEvents: [
            {
              id: 'debug_message',
              type: 'message_end',
              payload: { type: 'message_end', marker: 'payload_message' },
              createdAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        })}
        persistedEvents={[]}
        message="  Ship it  "
        setMessage={setMessage}
        onSend={onSend}
        onAbort={vi.fn()}
        onRefreshEvents={vi.fn()}
        canSend
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('Ship it')
    expect(setMessage).toHaveBeenCalledWith('')

    expect(eventFilter('unknown')).toBe('all')
    expect(eventFilter('transcript')).toBe('transcript')
    expect(eventFilter('not-a-filter')).toBe('all')
  })

  it('filters canonical debug events through the debug category menu', async () => {
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

    render(
      <SessionRuntimePanel
        runtime={buildRuntimeState({
          messages: [],
          tools: [],
          debugEvents: [
            {
              id: 'debug_message',
              type: 'message_end',
              payload: { type: 'message_end', marker: 'payload_message' },
              createdAt: '2026-05-23T00:00:00.000Z',
            },
            {
              id: 'debug_error',
              type: 'runtime.error',
              payload: { type: 'runtime.error', marker: 'payload_error' },
              createdAt: '2026-05-23T00:00:01.000Z',
            },
          ],
        })}
        persistedEvents={[]}
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

    const filter = screen.getByRole('combobox')
    filter.focus()
    fireEvent.pointerDown(filter, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(filter)
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'error' }))

    expect(screen.getByText('debug_error')).toBeTruthy()
    expect(screen.queryByText('debug_message')).toBeNull()
  })
})
