import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatTime } from '@/console/format'
import type { Session, SessionEvent } from '@/lib/api'
import type { PiRuntimeState } from './pi-runtime'
import { SessionRuntimePanel } from './SessionRuntimePanel'
import { SessionsView } from './SessionsView'

afterEach(() => {
  cleanup()
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
      allowedTools: ['read', 'write'],
      mcpConnectors: [],
      sandboxPolicy: { network: 'enabled' },
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
      networkPolicy: { mode: 'restricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      resourceLimits: { memoryMb: 1024 },
      runtimeImage: { image: 'node:24' },
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
    agentUrl: '/runtime/sessions/session_1/rpc',
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
  it('keeps error status detail off the table row while preserving the badge detail and adaptive surface', () => {
    render(
      <MemoryRouter>
        <SessionsView
          sessions={[buildSession({ status: 'error', statusReason: 'Runtime crashed' })]}
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
    expect(
      within(article as HTMLElement)
        .getByText('Error')
        .getAttribute('title'),
    ).toBe('Runtime failed to start')
    expect(screen.queryByText(/"message":/)).toBeNull()
  })
})
