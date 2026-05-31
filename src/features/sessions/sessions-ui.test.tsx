import { PI_EVENT_CATEGORIES, PI_EVENT_TYPES, piEventLabel } from '@shared/pi-events'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import type { Session, SessionEvent } from '@/lib/api'
import type { PiRuntimeState } from './pi-runtime'
import { eventFilter, SessionRuntimePanel } from './SessionRuntimePanel'
import { SessionsView } from './SessionsView'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function buildSession(overrides: Partial<Session> = {}): Session {
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
      instructions: 'Do the work',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      systemPrompt: 'Coding agent',
      skills: ['ama@coding-agent'],
      allowedTools: ['read', 'write'],
      mcpConnectors: [],
      metadata: {},
      createdAt: '2026-05-23T00:00:00.000Z',
    },
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: {
      id: 'envver_1',
      environmentId: 'env_1',
      projectId: 'project_1',
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: {},
      secretRefs: [],
      hostingMode: 'cloud',
      runtime: 'ama',
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      mcpPolicy: {},
      packageManagerPolicy: {},
      resourceLimits: { memoryMb: 1024 },
      runtimeConfig: { image: 'node:24' },
      metadata: {},
      version: 1,
      createdAt: '2026-05-23T00:00:00.000Z',
    },
    title: 'First run workflow',
    resourceRefs: [],
    vaultRefs: [],
    durableObjectName: 'session_1',
    sandboxId: 'sandbox_1',
    piRuntimeId: 'pi_1',
    piProcessId: 'process_1',
    runtimeEndpointPath: '/runtime/sessions/session_1/rpc',
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
    ...overrides,
  }
}

function buildPersistedEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'event_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    sessionId: 'session_1',
    sequence: 1,
    type: 'message_end',
    visibility: 'runtime',
    role: null,
    parentEventId: null,
    correlationId: null,
    payload: {
      type: 'message_end',
      message: { role: 'assistant', content: 'Runtime failed to start' },
    },
    metadata: {},
    createdAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildRuntimeState(overrides: Partial<PiRuntimeState> = {}): PiRuntimeState {
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
        type: 'error',
        payload: {
          type: 'error',
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

describe('sessions UI contracts', () => {
  it('keeps error status detail off the table row while preserving pagination and adaptive surface', () => {
    const sessions = Array.from({ length: 11 }, (_, index) =>
      buildSession({
        id: `session_${index + 1}`,
        title: `Session ${index + 1}`,
        status: index === 0 ? 'error' : 'idle',
        statusReason: index === 0 ? 'Runtime crashed' : null,
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
    const session = buildSession({ status: 'error', statusReason: 'Runtime crashed' })
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

  it('keeps Pi payload JSON in debug while transcript renders structured message, tool, lifecycle, usage, error, and bridge rows', async () => {
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
        ...PI_EVENT_TYPES.map((type, index) => ({
          id: `debug_${type}`,
          type,
          payload: { type, safe: true, marker: `payload_${type}` },
          createdAt: new Date((index + 1) * 1000).toISOString(),
        })),
        {
          id: 'debug_future_event',
          type: 'future_event',
          payload: { type: 'future_event', marker: 'payload_future_event' },
          createdAt: new Date(99_000).toISOString(),
        },
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
    expect(screen.queryByText(/payload_bridge_exit/)).toBeNull()

    const debugTab = screen.getByRole('tab', { name: 'Debug' })
    fireEvent.pointerDown(debugTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(debugTab)
    fireEvent.mouseUp(debugTab)
    fireEvent.click(debugTab)
    await waitFor(() => expect(debugTab.getAttribute('aria-selected')).toBe('true'))

    for (const type of PI_EVENT_TYPES) {
      expect(screen.getByText(piEventLabel(type))).toBeTruthy()
      expect(screen.getByText(`debug_${type}`)).toBeTruthy()
    }
    for (const category of PI_EVENT_CATEGORIES) {
      expect(screen.getAllByText(category).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('future_event')).toBeTruthy()
    expect(screen.getByText('unknown')).toBeTruthy()
    expect(screen.getByText(/payload_bridge_exit/)).toBeTruthy()
    expect(screen.getByText(/payload_future_event/)).toBeTruthy()
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
            {
              id: 'debug_future',
              type: 'future_event',
              payload: { type: 'future_event', marker: 'payload_future' },
              createdAt: '2026-05-23T00:00:01.000Z',
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

    expect(eventFilter('unknown')).toBe('unknown')
    expect(eventFilter('message')).toBe('message')
    expect(eventFilter('not-a-filter')).toBe('all')
  })

  it('filters preserved unknown debug events through the debug category menu', async () => {
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
              id: 'debug_future',
              type: 'future_event',
              payload: { type: 'future_event', marker: 'payload_future' },
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
    fireEvent.click(await screen.findByRole('option', { name: 'unknown' }))

    expect(screen.getByText('debug_future')).toBeTruthy()
    expect(screen.queryByText('debug_message')).toBeNull()
  })
})
