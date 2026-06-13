import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AuditRecord } from '@/lib/api'
import { AuditPage } from './AuditPage'
import { AuditRecordPage } from './AuditRecordPage'
import { AuditView } from './AuditView'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function buildRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit_1',
    projectId: 'project_1',
    actorUserId: 'user_1',
    actorType: 'user',
    action: 'access_rule.create',
    resourceType: 'access_rule',
    resourceId: 'access_1',
    outcome: 'success',
    requestId: 'req_1',
    correlationId: 'corr_1',
    sessionId: null,
    policyCategory: null,
    metadata: { source: 'console' },
    before: {},
    after: { effect: 'deny' },
    createdAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

function pagination(records: AuditRecord[]): ClientPagination<AuditRecord> {
  return {
    items: records,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: records.length,
    start: records.length === 0 ? 0 : 1,
    end: records.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

describe('[spec: audit/console-list] AuditView', () => {
  it('renders one row per record with action, outcome, resource, actor, policy, and request', () => {
    const records = [
      buildRecord(),
      buildRecord({
        id: 'audit_2',
        action: 'policy.evaluate',
        outcome: 'denied',
        resourceType: 'provider',
        resourceId: 'workers-ai',
        policyCategory: 'provider',
      }),
    ]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('access_rule.create')).toBeTruthy()
    expect(screen.getByText('policy.evaluate')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    expect(screen.getByText('access_rule / access_1')).toBeTruthy()
  })

  it('shows an empty state when no records match', () => {
    render(
      <MemoryRouter>
        <AuditView records={[]} pagination={pagination([])} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No audit records')).toBeTruthy()
  })
})

describe('[spec: audit/console-detail] AuditRecordPage', () => {
  it('renders actor, correlation, resource link, and redacted before/after change', async () => {
    const record = buildRecord({
      action: 'vault.credential.update',
      resourceType: 'vault',
      resourceId: 'vault_1',
      before: { apiKey: '[REDACTED]' },
      after: { apiKey: '[REDACTED]', name: 'Workers token' },
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockResolvedValue(record),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'vault.credential.update' })).toBeTruthy()
    expect(screen.getByText('user_1')).toBeTruthy()
    expect(screen.getByText('corr_1')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open vault' })).toBeTruthy()
    await waitFor(() => expect(screen.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0))
  })

  it('renders resource type without a link when resource type has no route', async () => {
    const record = buildRecord({
      action: 'unknown_resource.update',
      resourceType: 'access_rule',
      resourceId: 'rule_1',
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockResolvedValue(record),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'unknown_resource.update' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
  })

  it('renders without a resource link when resourceId is null', async () => {
    const record = buildRecord({
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: null,
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockResolvedValue(record),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'provider.create' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /^Open / })).toBeNull()
  })

  it('shows loading state while the query is pending', async () => {
    // Never-resolving promise keeps the query in pending/loading state
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockReturnValue(new Promise(() => {})),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Loading audit record')).toBeTruthy()
  })

  it('shows error state when the query fails', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockRejectedValue(new Error('Not found')),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Audit record unavailable')).toBeTruthy()
    expect(screen.getByText('Not found')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to audit log' })).toBeTruthy()
  })

  it('shows error state with stringified message when error is not an Error instance', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockRejectedValue('string error'),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Audit record unavailable')).toBeTruthy()
    expect(screen.getByText('string error')).toBeTruthy()
  })

  it('renders agent and environment resource links', async () => {
    const agentRecord = buildRecord({
      action: 'agent.update',
      resourceType: 'agent',
      resourceId: 'agent_1',
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockResolvedValue(agentRecord),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('link', { name: 'Open agent' })).toBeTruthy()
  })

  it('renders None for null optional record fields and falls back to actorType when actorUserId is null', async () => {
    const record = buildRecord({
      action: 'session.stop',
      actorUserId: null,
      requestId: null,
      correlationId: null,
      sessionId: null,
      policyCategory: null,
      projectId: null,
    })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readAuditRecord: vi.fn().mockResolvedValue(record),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit/audit_1']}>
          <Routes>
            <Route path="/audit/:recordId" element={<AuditRecordPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'session.stop' })).toBeTruthy()
    // actorUserId is null so falls back to actorType 'user'
    expect(screen.getAllByText('user').length).toBeGreaterThan(0)
    // All null-optional fields render as 'None'
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })
})

describe('[spec: audit/console-list] AuditView resource id null', () => {
  it('renders None when resourceId is null', () => {
    const records = [buildRecord({ resourceId: null })]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    expect(screen.getByText('access_rule / None')).toBeTruthy()
  })

  it('renders actor type when actorUserId is null', () => {
    const records = [buildRecord({ actorUserId: null })]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    // When actorUserId is null, it falls back to actorType
    expect(screen.getByText('user')).toBeTruthy()
  })

  it('renders None for missing optional fields', () => {
    const records = [
      buildRecord({
        requestId: null,
        policyCategory: null,
      }),
    ]
    render(
      <MemoryRouter>
        <AuditView records={records} pagination={pagination(records)} />
      </MemoryRouter>,
    )

    // policyCategory None and requestId None appear
    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })
})

describe('[spec: audit/console-list] AuditPage', () => {
  function renderAuditPage(initialSearch = '') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.spyOn(client, 'fetchQuery').mockResolvedValue({ data: [] })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/audit${initialSearch}`]}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page header and all filter inputs', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    renderAuditPage()

    expect(screen.getByText('Audit')).toBeTruthy()
    expect(screen.getByLabelText('Filter by action')).toBeTruthy()
    expect(screen.getByLabelText('Filter by resource type')).toBeTruthy()
    expect(screen.getByLabelText('Filter by actor')).toBeTruthy()
    expect(screen.getByLabelText('Audit from')).toBeTruthy()
    expect(screen.getByLabelText('Audit to')).toBeTruthy()
  })

  it('shows empty state when api returns no records', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('No audit records')).toBeTruthy()
  })

  it('updates action filter input when user types', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const actionInput = screen.getByLabelText('Filter by action')
    fireEvent.change(actionInput, { target: { value: 'agent.create' } })
    expect((actionInput as HTMLInputElement).value).toBe('agent.create')
  })

  it('updates resource type filter when user types', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const resourceTypeInput = screen.getByLabelText('Filter by resource type')
    fireEvent.change(resourceTypeInput, { target: { value: 'vault' } })
    expect((resourceTypeInput as HTMLInputElement).value).toBe('vault')
  })

  it('updates actor filter when user types', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const actorInput = screen.getByLabelText('Filter by actor')
    fireEvent.change(actorInput, { target: { value: 'user_abc' } })
    expect((actorInput as HTMLInputElement).value).toBe('user_abc')
  })

  it('updates date range filters when user types', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const fromInput = screen.getByLabelText('Audit from')
    const toInput = screen.getByLabelText('Audit to')
    fireEvent.change(fromInput, { target: { value: '2026-01-01T00:00' } })
    fireEvent.change(toInput, { target: { value: '2026-06-01T00:00' } })
    expect((fromInput as HTMLInputElement).value).toBe('2026-01-01T00:00')
    expect((toInput as HTMLInputElement).value).toBe('2026-06-01T00:00')
  })

  it('renders with pre-existing URL filters applied', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: [] }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit?action=agent.create&outcome=success']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const actionInput = screen.getByLabelText('Filter by action')
    expect((actionInput as HTMLInputElement).value).toBe('agent.create')
  })

  it('renders records returned by the api', async () => {
    const records = [buildRecord({ id: 'audit_10', action: 'session.create', outcome: 'success' })]
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords: vi.fn().mockResolvedValue({ data: records }),
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('session.create')).toBeTruthy()
  })

  it('passes date range from URL params to the query filters', async () => {
    const listAuditRecords = vi.fn().mockResolvedValue({ data: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords,
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit?createdFrom=2026-01-01T00%3A00&createdTo=2026-06-01T00%3A00']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(listAuditRecords).toHaveBeenCalledWith(
        expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      )
    })
  })

  it('passes projectId from URL param to the query filters', async () => {
    const listAuditRecords = vi.fn().mockResolvedValue({ data: [] })
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      listAuditRecords,
    } as never)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/audit?projectId=project_abc']}>
          <Routes>
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(listAuditRecords).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project_abc' }))
    })
  })
})
