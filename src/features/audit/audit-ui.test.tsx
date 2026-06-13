import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AuditRecord } from '@/lib/api'
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
})
