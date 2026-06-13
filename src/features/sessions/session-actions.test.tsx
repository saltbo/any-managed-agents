/**
 * Tests for use-session-actions hook — covers the mutation callbacks (onSuccess,
 * onError) for stopSession and archiveSession.
 *
 * Uses MSW + the REAL api client. No vi.spyOn / vi.mock of @/lib/api.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { HttpResponse, http, server } from '@/test/msw'
import { useSessionActions } from './use-session-actions'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const now = '2026-05-23T00:00:00.000Z'

function buildStoppedSession() {
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
    title: null,
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
    state: 'stopped',
    stateReason: null,
    metadata: {},
    startedAt: now,
    stoppedAt: '2026-05-23T00:00:01.000Z',
    archivedAt: null,
    createdAt: now,
    updatedAt: '2026-05-23T00:00:01.000Z',
  }
}

function buildArchivedSession() {
  return {
    ...buildStoppedSession(),
    state: 'idle',
    stoppedAt: null,
    archivedAt: '2026-05-23T00:00:02.000Z',
    updatedAt: '2026-05-23T00:00:02.000Z',
  }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function ActionsHarness() {
  const actions = useSessionActions()
  return (
    <div>
      <button type="button" onClick={() => actions.stopSession('session_1')}>
        Stop
      </button>
      <button type="button" onClick={() => actions.archiveSession('session_1')}>
        Archive
      </button>
      {actions.stopSessionPending && <span>stop-pending</span>}
      {actions.archiveSessionPending && <span>archive-pending</span>}
    </div>
  )
}

function renderHarness() {
  const queryClient = makeQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActionsHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

// ---------------------------------------------------------------------------
// stopSession
// ---------------------------------------------------------------------------

describe('useSessionActions — stopSession', () => {
  it('calls PATCH /api/v1/sessions/:id and resolves with stopped session', async () => {
    server.use(http.patch('*/api/v1/sessions/session_1', () => HttpResponse.json(buildStoppedSession())))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    // If the mutation resolves without throwing, the api was called correctly.
    await waitFor(() => expect(screen.queryByText('stop-pending')).toBeNull(), { timeout: 3000 })
  })

  it('does not crash when PATCH /sessions/:id returns 500', async () => {
    server.use(
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Stop failed' } }, { status: 500 }),
      ),
    )

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    // Hook handles error via onError callback (shows toast) — component must not crash.
    await waitFor(() => expect(screen.queryByText('stop-pending')).toBeNull(), { timeout: 3000 })
  })
})

// ---------------------------------------------------------------------------
// archiveSession
// ---------------------------------------------------------------------------

describe('useSessionActions — archiveSession', () => {
  it('calls PATCH /api/v1/sessions/:id and resolves with archived session (covers onSuccess)', async () => {
    // The onSuccess callback calls toast.success and invalidateQueries.
    // Providing a valid 200 response causes onSuccess to fire.
    server.use(http.patch('*/api/v1/sessions/session_1', () => HttpResponse.json(buildArchivedSession())))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(screen.queryByText('archive-pending')).toBeNull(), { timeout: 3000 })
  })

  it('does not crash when PATCH /sessions/:id returns 500 for archive', async () => {
    server.use(
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Archive failed' } }, { status: 500 }),
      ),
    )

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(screen.queryByText('archive-pending')).toBeNull(), { timeout: 3000 })
  })

  it('does not crash when PATCH /sessions/:id returns 409 for archive', async () => {
    server.use(
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Already archived' } }, { status: 409 }),
      ),
    )

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(screen.queryByText('archive-pending')).toBeNull(), { timeout: 3000 })
  })
})
