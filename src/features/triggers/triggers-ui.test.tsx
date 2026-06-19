import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { useClientPagination } from '@/console/use-client-pagination'
import type { Trigger } from '@/lib/api'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import { TriggersPage } from './TriggersPage'
import { formatInterval, TriggersView } from './TriggersView'
import { useTriggerActions } from './use-trigger-actions'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'trigger_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    environmentId: 'env_1',
    runtime: 'codex',
    name: 'Daily research heartbeat',
    promptTemplate: 'Research current offers.',
    resourceRefs: [],
    env: {},
    secretEnv: [],
    schedule: { type: 'interval', intervalSeconds: 86400, windowSeconds: 0 },
    enabled: true,
    nextDueAt: '2026-06-19T12:00:00.000Z',
    lastDispatchedAt: '2026-06-18T12:00:00.000Z',
    lastRunId: 'trigrun_1',
    metadata: {},
    createdByUserId: 'user_1',
    archivedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-18T12:00:00.000Z',
    ...overrides,
  }
}

function pagination<T>(items: T[]): ClientPagination<T> {
  return {
    items,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: items.length,
    start: items.length === 0 ? 0 : 1,
    end: items.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function setupTriggerHandlers(triggers: Trigger[] = []) {
  const collection = createCollection<Trigger>(triggers)
  server.use(
    ...resourceHandlers('triggers', collection, (body, idx) =>
      trigger({ id: `trigger_new_${idx}`, name: String(body.name ?? 'New'), ...body }),
    ),
  )
  return { collection }
}

// ─── formatInterval ──────────────────────────────────────────────────────────

describe('[spec: triggers/console-list] formatInterval', () => {
  it('formats day, hour, minute, and second intervals', () => {
    expect(formatInterval(86400)).toBe('every 1d')
    expect(formatInterval(7200)).toBe('every 2h')
    expect(formatInterval(300)).toBe('every 5m')
    expect(formatInterval(45)).toBe('every 45s')
  })
})

// ─── TriggersView ────────────────────────────────────────────────────────────

describe('[spec: triggers/console-list] TriggersView', () => {
  it('explains the empty state when no triggers exist', () => {
    render(
      <MemoryRouter>
        <TriggersView triggers={[]} pagination={pagination<Trigger>([])} onPause={vi.fn()} onResume={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No triggers')).toBeTruthy()
    expect(screen.getByText(/Schedule a trigger to dispatch an agent/)).toBeTruthy()
  })

  it('renders rows with name, agent, schedule, status, and a pause action when enabled', () => {
    const triggers = [trigger()]
    render(
      <MemoryRouter>
        <TriggersView triggers={triggers} pagination={pagination(triggers)} onPause={vi.fn()} onResume={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Daily research heartbeat' }).getAttribute('href')).toBe(
      '/triggers/trigger_1',
    )
    expect(screen.getByText('agent_1')).toBeTruthy()
    expect(screen.getByText('every 1d')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pause trigger' })).toBeTruthy()
  })

  it('renders a resume action and paused status when disabled', () => {
    const triggers = [trigger({ enabled: false })]
    render(
      <MemoryRouter>
        <TriggersView triggers={triggers} pagination={pagination(triggers)} onPause={vi.fn()} onResume={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('paused')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume trigger' })).toBeTruthy()
  })

  it('shows an em dash when the trigger has never dispatched', () => {
    const triggers = [trigger({ lastDispatchedAt: null })]
    render(
      <MemoryRouter>
        <TriggersView triggers={triggers} pagination={pagination(triggers)} onPause={vi.fn()} onResume={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('—')).toBeTruthy()
  })

  it('calls onPause when the pause button is clicked', () => {
    const onPause = vi.fn()
    const triggers = [trigger()]
    render(
      <MemoryRouter>
        <TriggersView triggers={triggers} pagination={pagination(triggers)} onPause={onPause} onResume={vi.fn()} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pause trigger' }))
    expect(onPause).toHaveBeenCalledWith('trigger_1')
  })

  it('calls onResume when the resume button is clicked', () => {
    const onResume = vi.fn()
    const triggers = [trigger({ enabled: false })]
    render(
      <MemoryRouter>
        <TriggersView triggers={triggers} pagination={pagination(triggers)} onPause={vi.fn()} onResume={onResume} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume trigger' }))
    expect(onResume).toHaveBeenCalledWith('trigger_1')
  })

  it('paginates correctly with multiple triggers', () => {
    const triggers = Array.from({ length: 11 }, (_, i) => trigger({ id: `trigger_${i + 1}`, name: `Trigger ${i + 1}` }))

    function Harness() {
      const pag = useClientPagination(triggers)
      return (
        <MemoryRouter>
          <TriggersView triggers={pag.items} pagination={pag} onPause={vi.fn()} onResume={vi.fn()} />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
  })
})

// ─── TriggersPage ────────────────────────────────────────────────────────────

describe('[spec: triggers/console-page] TriggersPage', () => {
  function renderPage(triggers: Trigger[] = [], initialPath = '/') {
    setupTriggerHandlers(triggers)
    const client = makeQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page header and filter controls', () => {
    renderPage()
    expect(screen.getByText('Triggers')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search triggers' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy()
  })

  it('renders trigger rows after data loads', async () => {
    renderPage([trigger()])
    expect(await screen.findByText('Daily research heartbeat')).toBeTruthy()
  })

  it('shows the empty state when no triggers are returned', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('No triggers')).toBeTruthy())
  })

  it('filters triggers by search text matching name', async () => {
    renderPage([
      trigger({ id: 'trigger_1', name: 'Alpha trigger', agentId: 'agent_a' }),
      trigger({ id: 'trigger_2', name: 'Beta trigger', agentId: 'agent_b' }),
    ])
    await screen.findByText('Alpha trigger')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search triggers' }), { target: { value: 'Alpha' } })

    expect(screen.getByText('Alpha trigger')).toBeTruthy()
    expect(screen.queryByText('Beta trigger')).toBeNull()
  })

  it('filters triggers to paused when status=paused is set', async () => {
    renderPage(
      [
        trigger({ id: 'trigger_on', name: 'Active trigger', enabled: true }),
        trigger({ id: 'trigger_off', name: 'Paused trigger', enabled: false }),
      ],
      '/?status=paused',
    )

    expect(await screen.findByText('Paused trigger')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Active trigger')).toBeNull())
  })

  it('pauses a trigger via PATCH enabled:false when the pause action is clicked', async () => {
    let patchedBody: Record<string, unknown> | null = null
    const collection = createCollection<Trigger>([trigger()])
    server.use(
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: collection.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ enabled: false }))
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Pause trigger' }))
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(patchedBody!.enabled).toBe(false)
  })
})

// ─── useTriggerActions ───────────────────────────────────────────────────────

describe('[spec: triggers/actions] useTriggerActions', () => {
  function ActionHarness({ onReady }: { onReady: (actions: ReturnType<typeof useTriggerActions>) => void }) {
    const actions = useTriggerActions()
    onReady(actions)
    return null
  }

  it('calls PATCH /triggers/:id with enabled:false when pauseTrigger is invoked', async () => {
    let patchedUrl = ''
    let patchedBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedUrl = request.url
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ enabled: false }))
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.pauseTrigger('trigger_1')
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(patchedBody!.enabled).toBe(false)
    expect(patchedUrl).toContain('trigger_1')
  })

  it('calls PATCH /triggers/:id with enabled:true when resumeTrigger is invoked', async () => {
    let patchedBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ enabled: true }))
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.resumeTrigger('trigger_1')
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect(patchedBody!.enabled).toBe(true)
  })
})
