import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageSummary } from '@/lib/api'
import { UsagePage } from './UsagePage'
import { UsageView } from './UsageView'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function buildSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    groupBy: 'provider',
    totals: {
      records: 3,
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      durationMs: 160,
      costMicros: 25,
      currency: 'USD',
    },
    groups: [
      {
        key: { provider: 'workers-ai' },
        records: 2,
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
        durationMs: 150,
        costMicros: 25,
        currency: 'USD',
      },
      {
        key: { provider: 'sandbox' },
        records: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 10,
        costMicros: 0,
        currency: 'USD',
      },
    ],
    ...overrides,
  }
}

describe('[spec: usage/console-view] UsageView', () => {
  it('renders grand totals and a row per group', () => {
    render(<UsageView summary={buildSummary()} />)

    expect(screen.getByText('Usage summary')).toBeTruthy()
    const records = screen.getByText('Records').closest('div') as HTMLElement
    expect(within(records).getByText('3')).toBeTruthy()
    expect(screen.getByText(/"provider": "workers-ai"/)).toBeTruthy()
    expect(screen.getByText(/"provider": "sandbox"/)).toBeTruthy()
  })

  it('shows an empty state when there is no summary', () => {
    render(<UsageView summary={null} />)

    expect(screen.getByText('No usage summary')).toBeTruthy()
  })

  it('shows an empty grouped row when totals exist but no groups do', () => {
    render(<UsageView summary={buildSummary({ groups: [] })} />)

    expect(screen.getByText('Usage summary')).toBeTruthy()
    expect(screen.getByText('Grouped usage appears after sessions record provider events.')).toBeTruthy()
  })
})

describe('[spec: usage/console-page] UsagePage', () => {
  function renderUsagePage(initialSearch = '') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return {
      client,
      ...render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/usage${initialSearch}`]}>
            <Routes>
              <Route path="/usage" element={<UsagePage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    }
  }

  it('renders page header and group-by and date filter controls', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage()

    expect(screen.getByText('Usage')).toBeTruthy()
    expect(screen.getByLabelText('Group usage by')).toBeTruthy()
    expect(screen.getByLabelText('Usage from')).toBeTruthy()
    expect(screen.getByLabelText('Usage to')).toBeTruthy()
  })

  it('shows no usage summary when api returns null', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage()

    expect(await screen.findByText('No usage summary')).toBeTruthy()
  })

  it('renders summary data returned by the api', async () => {
    const summary: UsageSummary = buildSummary()
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(summary),
    } as never)

    renderUsagePage()

    expect(await screen.findByText('Usage summary')).toBeTruthy()
    expect(screen.getByText(/"provider": "workers-ai"/)).toBeTruthy()
  })

  it('updates date from filter when user changes the input', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage()

    const fromInput = screen.getByLabelText('Usage from')
    fireEvent.change(fromInput, { target: { value: '2026-01-01T00:00' } })
    expect((fromInput as HTMLInputElement).value).toBe('2026-01-01T00:00')
  })

  it('updates date to filter when user changes the input', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage()

    const toInput = screen.getByLabelText('Usage to')
    fireEvent.change(toInput, { target: { value: '2026-06-01T00:00' } })
    expect((toInput as HTMLInputElement).value).toBe('2026-06-01T00:00')
  })

  it('pre-populates groupBy from URL search param', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage('?groupBy=model')

    // The select trigger displays the current group-by label
    await waitFor(() => {
      const trigger = screen.getByLabelText('Group usage by')
      expect(trigger.textContent).toContain('Model')
    })
  })

  it('pre-populates date filters from URL search params', async () => {
    vi.spyOn(await import('@/lib/api'), 'api', 'get').mockReturnValue({
      readUsageSummary: vi.fn().mockResolvedValue(null),
    } as never)

    renderUsagePage('?createdFrom=2026-01-01T00%3A00&createdTo=2026-06-01T00%3A00')

    const fromInput = screen.getByLabelText('Usage from')
    const toInput = screen.getByLabelText('Usage to')
    expect((fromInput as HTMLInputElement).value).toBe('2026-01-01T00:00')
    expect((toInput as HTMLInputElement).value).toBe('2026-06-01T00:00')
  })
})
