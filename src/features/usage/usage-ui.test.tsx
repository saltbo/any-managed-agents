import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageSummary } from '@/lib/api'
import { UsageView } from './UsageView'

afterEach(() => {
  cleanup()
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
