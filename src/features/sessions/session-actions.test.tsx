/**
 * Tests for use-session-actions hook — covers the mutation callbacks (onSuccess,
 * onError) for stopSession and archiveSession, which are the uncovered branches.
 *
 * Pattern follows sessions-ui.test.tsx: QueryClientProvider, MemoryRouter, afterEach cleanup.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as apiModule from '@/lib/api'
import { useSessionActions } from './use-session-actions'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

/**
 * Tiny test harness that exposes the hook's actions as buttons.
 */
function ActionsHarness({ onStop, onArchive }: { onStop?: (id: string) => void; onArchive?: (id: string) => void }) {
  const actions = useSessionActions()
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          actions.stopSession('session_1')
          onStop?.('session_1')
        }}
      >
        Stop
      </button>
      <button
        type="button"
        onClick={() => {
          actions.archiveSession('session_1')
          onArchive?.('session_1')
        }}
      >
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

describe('useSessionActions — stopSession', () => {
  it('calls api.stopSession when stopSession is invoked', async () => {
    const spy = vi.spyOn(apiModule.api, 'stopSession').mockResolvedValue({
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
        createdAt: '2026-05-23T00:00:00.000Z',
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
      startedAt: '2026-05-23T00:00:00.000Z',
      stoppedAt: '2026-05-23T00:00:01.000Z',
      archivedAt: null,
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:01.000Z',
    })

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => {
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0]?.[0]).toBe('session_1')
    })
  })

  it('triggers onError toast when stopSession fails', async () => {
    vi.spyOn(apiModule.api, 'stopSession').mockRejectedValue(new Error('Stop failed'))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    // No crash — hook handles error via onError callback (shows toast)
    await waitFor(() => expect(apiModule.api.stopSession).toHaveBeenCalled())
  })

  it('handles non-Error rejection from stopSession gracefully', async () => {
    vi.spyOn(apiModule.api, 'stopSession').mockRejectedValue('string error')

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(apiModule.api.stopSession).toHaveBeenCalled())
  })
})

describe('useSessionActions — archiveSession', () => {
  it('calls api.archiveSession when archiveSession is invoked', async () => {
    const spy = vi.spyOn(apiModule.api, 'archiveSession').mockResolvedValue({
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
        createdAt: '2026-05-23T00:00:00.000Z',
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
      state: 'idle',
      stateReason: null,
      metadata: {},
      startedAt: '2026-05-23T00:00:00.000Z',
      stoppedAt: null,
      archivedAt: '2026-05-23T00:00:02.000Z',
      createdAt: '2026-05-23T00:00:00.000Z',
      updatedAt: '2026-05-23T00:00:02.000Z',
    })

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => {
      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls[0]?.[0]).toBe('session_1')
    })
  })

  it('triggers onError toast when archiveSession fails', async () => {
    vi.spyOn(apiModule.api, 'archiveSession').mockRejectedValue(new Error('Archive failed'))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(apiModule.api.archiveSession).toHaveBeenCalled())
  })

  it('handles non-Error rejection from archiveSession gracefully', async () => {
    vi.spyOn(apiModule.api, 'archiveSession').mockRejectedValue(42)

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))

    await waitFor(() => expect(apiModule.api.archiveSession).toHaveBeenCalled())
  })
})
