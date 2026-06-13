/**
 * Tests for useSessionRuntimeSession hook.
 *
 * Uses MSW for the GET /api/v1/sessions/:id/connection endpoint, and a
 * MockWebSocket to exercise the live runtime socket path. No vi.spyOn/vi.mock
 * of @/lib/api.
 *
 * ROOT CAUSE OF OOM: The hook's two useEffects both depend on props that can
 * change reference on every re-render, causing infinite loops:
 *
 *   1. useEffect([endpoint, onEventsChanged, connectionAttempt])
 *      If onEventsChanged is a new function on each render (e.g. vi.fn() inline),
 *      the effect runs → dispatch → new state → re-render → new fn → repeat.
 *
 *   2. useEffect([events, session])
 *      If events is a new array on each render (e.g. `events={[]}` default),
 *      the effect runs → dispatch persisted_events → new state → re-render →
 *      new [] → repeat.
 *
 * FIXES:
 *   - Pass onEventsChanged as a stable ref via useCallback([stableRef])
 *   - Pass events as a module-level constant (never re-created)
 *
 * MockWebSocket.close() is silent so useEffect cleanup doesn't start reconnect.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session, SessionEvent } from '@/lib/api'
import * as oidcModule from '@/lib/oidc'
import { HttpResponse, http, server } from '@/test/msw'
import { useSessionRuntimeSession } from './use-session-runtime'

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

let lastSocket: MockWebSocket | null = null

class MockWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number
  readonly url: string
  readonly sent: string[] = []

  constructor(url: string) {
    super()
    this.url = url
    this.readyState = MockWebSocket.OPEN
    lastSocket = this
    // Defer 'open' so the hook's addEventListener is registered first.
    Promise.resolve().then(() => this.dispatchEvent(new Event('open')))
  }

  emit(payload: Record<string, unknown>) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) }))
  }

  emitRaw(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  triggerError() {
    this.dispatchEvent(new Event('error'))
  }

  /** Only use when you unmount immediately after to cancel the reconnect timer. */
  triggerClose() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  /** Called by useEffect cleanup — silent to prevent reconnect. */
  close() {
    this.readyState = MockWebSocket.CLOSED
  }

  send(data: string) {
    this.sent.push(data)
  }
}

// ---------------------------------------------------------------------------
// Fixtures — module-level constants so arrays are never recreated
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

const NO_EVENTS: SessionEvent[] = []

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
      instructions: 'Do work',
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
    environmentId: 'env_1',
    environmentVersionId: null,
    environmentSnapshot: null,
    title: 'Test session',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    runtimeMetadata: {
      hostingMode: 'cloud',
      runtime: 'ama',
      runtimeConfig: {},
      provider: 'workers-ai',
      model: '@cf/meta/llama',
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

function buildEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
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
    payload: { type: 'message_end', message: { role: 'assistant', content: 'Hello' } },
    metadata: {},
    createdAt: now,
    ...overrides,
  }
}

// MSW handler for connection endpoint
function connectionHandler(sessionId = 'session_1') {
  return http.get(`*/api/v1/sessions/${sessionId}/connection`, () =>
    HttpResponse.json({
      sessionId,
      transport: null,
      path: `/api/sessions/${sessionId}/runtime/rpc`,
      state: 'running',
      stateReason: null,
    }),
  )
}

// ---------------------------------------------------------------------------
// Test Harness
//
// CRITICAL: events must be a stable reference (hoisted constant, never inline []).
// CRITICAL: onEventsChanged must be stable via useCallback with a stable ref.
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function RuntimeHarness({
  session,
  events,
  onEventsChangedRef,
}: {
  session: Session | null
  events: SessionEvent[] // MUST be a stable reference — never inline []
  onEventsChangedRef: React.MutableRefObject<() => void>
}) {
  const onEventsChanged = useCallback(() => onEventsChangedRef.current(), [onEventsChangedRef])

  const { state, sendPrompt, sendFollowUp, sendSteer, abort } = useSessionRuntimeSession({
    session,
    events,
    onEventsChanged,
  })
  return (
    <div>
      <span data-testid="connection">{state.connection}</span>
      <span data-testid="runState">{state.runState}</span>
      <span data-testid="error">{state.error ?? 'none'}</span>
      <span data-testid="messageCount">{state.messages.length}</span>
      <button type="button" onClick={() => sendPrompt('Test prompt')}>
        Send Prompt
      </button>
      <button type="button" onClick={() => sendFollowUp('follow up')}>
        Send Follow Up
      </button>
      <button type="button" onClick={() => sendSteer('steer message')}>
        Steer
      </button>
      <button type="button" onClick={() => abort()}>
        Abort
      </button>
    </div>
  )
}

function makeCallbackRef(fn: () => void = () => {}): React.MutableRefObject<() => void> {
  return { current: fn }
}

async function renderLive(sessionState: Session['state'] = 'idle', cbRef = makeCallbackRef()) {
  server.use(connectionHandler())
  const queryClient = makeQueryClient()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RuntimeHarness session={buildSession({ state: sessionState })} events={NO_EVENTS} onEventsChangedRef={cbRef} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('open'), { timeout: 5000 })
  return result
}

// ---------------------------------------------------------------------------
// Global setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  lastSocket = null
  vi.spyOn(oidcModule, 'getStoredAccessToken').mockReturnValue(null)
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  lastSocket = null
})

// ---------------------------------------------------------------------------
// Tests — null / stopped session
// ---------------------------------------------------------------------------

describe('useSessionRuntimeSession — null/stopped session', () => {
  it('reports closed when session is null', async () => {
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={null} events={NO_EVENTS} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('closed'), { timeout: 5000 })
  })

  it('dispatches persisted message_end events for a stopped session', async () => {
    // Define events OUTSIDE render — stable reference
    const events: SessionEvent[] = [
      buildEvent(),
      buildEvent({ id: 'event_2', sequence: 2, type: 'turn_end', payload: { type: 'turn_end' } }),
    ]
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={buildSession({ state: 'stopped' })} events={events} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('messageCount').textContent).toBe('1'), { timeout: 5000 })
    expect(screen.getByTestId('runState').textContent).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// Tests — live session
// ---------------------------------------------------------------------------

describe('useSessionRuntimeSession — live session open', () => {
  it('connects WebSocket for idle session and reports open', async () => {
    await renderLive('idle')
    expect(screen.getByTestId('connection').textContent).toBe('open')
  })

  it('connects WebSocket for running session', async () => {
    server.use(connectionHandler())
    await renderLive('running')
    expect(screen.getByTestId('connection').textContent).toBe('open')
  })

  it('dispatches message_end event into messages state', async () => {
    await renderLive()

    lastSocket!.emit({ type: 'message_end', id: 'msg1', message: { role: 'assistant', content: 'Hi', id: 'msg1' } })

    await waitFor(() => expect(screen.getByTestId('messageCount').textContent).toBe('1'), { timeout: 5000 })
  })

  it('sets error state on WebSocket error event', async () => {
    await renderLive()

    lastSocket!.triggerError()

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
    expect(screen.getByTestId('error').textContent).toBe('Runtime WebSocket failed')
  })

  it('sets error state for invalid JSON message', async () => {
    await renderLive()

    lastSocket!.emitRaw('{ bad json }')

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
  })

  it('sets error state for non-object JSON (plain string)', async () => {
    await renderLive()

    lastSocket!.emitRaw('"just a string"')

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
  })

  it('does not set error for non-string data (treated as synthetic message)', async () => {
    await renderLive()

    lastSocket!.emitRaw(42)

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(screen.getByTestId('connection').textContent).toBe('open')
  })
})

describe('useSessionRuntimeSession — close event', () => {
  it('reports closed on server-initiated close; unmount cancels reconnect timer', async () => {
    const { unmount } = await renderLive()

    lastSocket!.triggerClose()
    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('closed'), { timeout: 5000 })

    // Unmount so clearTimeout in useEffect cleanup cancels the 750ms reconnect.
    unmount()
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
})

describe('useSessionRuntimeSession — send commands', () => {
  it('sends prompt command', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('prompt')
    expect(cmd.message).toBe('Test prompt')
  })

  it('sends follow_up command', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Send Follow Up' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('follow_up')
  })

  it('sends steer command', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Steer' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('steer')
  })

  it('sends abort command without message body', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Abort' }))

    await waitFor(() => expect(lastSocket!.sent).toHaveLength(1), { timeout: 5000 })
    const cmd = JSON.parse(lastSocket!.sent[0] ?? '{}') as Record<string, unknown>
    expect(cmd.type).toBe('abort')
    expect(cmd.message).toBeUndefined()
  })

  it('sets error when sendPrompt is called while socket is CONNECTING', async () => {
    vi.stubGlobal(
      'WebSocket',
      class extends MockWebSocket {
        constructor(url: string) {
          super(url)
          this.readyState = MockWebSocket.CONNECTING
          lastSocket = this
        }
      },
    )

    server.use(connectionHandler())
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={buildSession({ state: 'idle' })} events={NO_EVENTS} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(lastSocket).not.toBeNull(), { timeout: 5000 })
    await new Promise((resolve) => setTimeout(resolve, 50))

    fireEvent.click(screen.getByRole('button', { name: 'Send Prompt' }))

    await waitFor(() => expect(screen.getByTestId('connection').textContent).toBe('error'), { timeout: 5000 })
    expect(screen.getByTestId('error').textContent).toBe('Runtime WebSocket is not open')
  })
})

describe('useSessionRuntimeSession — onEventsChanged callbacks', () => {
  it('calls onEventsChanged after turn_end (150ms debounce)', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({ type: 'turn_end' })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after runtime.error', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({ type: 'runtime.error', message: 'crashed' })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after tool_execution_end', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({ type: 'tool_execution_end', toolCallId: 'tc_1', toolName: 'exec', result: {}, isError: false })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('calls onEventsChanged after agent_end', async () => {
    const cb = vi.fn()
    await renderLive('idle', makeCallbackRef(cb))

    lastSocket!.emit({ type: 'agent_end', messages: [] })

    await waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 })
  })
})

describe('useSessionRuntimeSession — session change (reset)', () => {
  it('resets state when session id changes (line 42 — sessionIdRef update)', async () => {
    server.use(connectionHandler('session_1'))
    const cbRef = makeCallbackRef()
    const queryClient = makeQueryClient()

    // Render with session_1
    const session1 = buildSession({ id: 'session_1' })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={session1} events={NO_EVENTS} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Wait for stable state
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Re-render with session_2 — this triggers the sessionIdRef !== check
    const session2 = buildSession({ id: 'session_2', state: 'stopped' })
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RuntimeHarness session={session2} events={NO_EVENTS} onEventsChangedRef={cbRef} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 100))
    // After session change, state should be reset (runState back to 'idle', messages empty)
    expect(screen.getByTestId('messageCount').textContent).toBe('0')
  })
})
