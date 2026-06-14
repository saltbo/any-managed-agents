import { expect, test } from './fixtures'

// [spec: usage/summary-api]
test('GET /api/v1/usage-summary returns 200 with named totals and a grouped breakdown [spec: usage/summary-api]', async ({
  api,
}) => {
  const res = await api.get('/api/v1/usage-summary?groupBy=provider')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as {
    groupBy: string
    totals: Record<string, unknown>
    groups: unknown[]
  }
  expect(body.groupBy).toBe('provider')
  expect(typeof body.totals.records).toBe('number')
  expect(typeof body.totals.promptTokens).toBe('number')
  expect(typeof body.totals.completionTokens).toBe('number')
  expect(typeof body.totals.totalTokens).toBe('number')
  expect(typeof body.totals.durationMs).toBe('number')
  expect(typeof body.totals.costMicros).toBe('number')
  expect(Array.isArray(body.groups)).toBe(true)
})

// [spec: usage/summary-api]
test('GET /api/v1/usage-summary defaults to provider grouping when groupBy is omitted [spec: usage/summary-api]', async ({
  api,
}) => {
  const res = await api.get('/api/v1/usage-summary')
  expect(res.status()).toBe(200)
  const body = (await res.json()) as { groupBy: string; totals: { records: number } }
  expect(body.groupBy).toBe('provider')
  expect(typeof body.totals.records).toBe('number')
})
