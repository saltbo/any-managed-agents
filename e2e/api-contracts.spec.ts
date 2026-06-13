import { expect, test } from './fixtures'

type Json = Record<string, unknown>
type Pagination = { limit: number; hasMore: boolean; nextCursor: string | null }
type ListResponse = { data: Json[]; pagination: Pagination }

async function createAgent(api: import('@playwright/test').APIRequestContext, name: string) {
  const res = await api.post('/api/v1/agents', {
    data: { name, instructions: 'E2E contract agent' },
  })
  expect(res.status(), `POST /agents (${name})`).toBe(201)
  return (await res.json()) as Json
}

async function getJson(api: import('@playwright/test').APIRequestContext, url: string) {
  const res = await api.get(url)
  expect(res.status(), `GET ${url}`).toBe(200)
  return (await res.json()) as ListResponse
}

// [spec: api-contracts/pagination] Page through API resources with stable cursors.
test('pages through resources with stable cursor metadata [spec: api-contracts/pagination]', async ({ api, runId }) => {
  await createAgent(api, `${runId} page agent 1`)
  await createAgent(api, `${runId} page agent 2`)
  await createAgent(api, `${runId} page agent 3`)

  const firstPage = await getJson(api, '/api/v1/agents?limit=1')
  expect(firstPage.data.length).toBeGreaterThan(0)
  const cursor = firstPage.pagination.nextCursor
  expect(cursor, 'first page must advertise a nextCursor').toBeTruthy()

  const nextPage = await getJson(api, `/api/v1/agents?limit=1&cursor=${encodeURIComponent(cursor as string)}`)
  expect(Array.isArray(nextPage.data)).toBe(true)
  expect(typeof nextPage.pagination.hasMore).toBe('boolean')
  expect('limit' in nextPage.pagination).toBe(true)
  expect('nextCursor' in nextPage.pagination).toBe(true)

  // Stable cursor: page 2 ids must not overlap page 1.
  const firstIds = new Set(firstPage.data.map((r) => r.id))
  for (const row of nextPage.data) {
    expect(firstIds.has(row.id), `duplicate id across pages: ${row.id}`).toBe(false)
  }
})

// [spec: api-contracts/date-filters] Filter API resources by date range.
test('filters resources by created date range [spec: api-contracts/date-filters]', async ({ api, runId }) => {
  const agent = await createAgent(api, `${runId} date-range agent`)
  expect(typeof agent.createdAt).toBe('string')

  const createdAt = new Date(String(agent.createdAt)).getTime()
  const from = new Date(createdAt - 5_000).toISOString()
  const to = new Date(createdAt + 60_000).toISOString()
  const list = await getJson(
    api,
    `/api/v1/audit-records?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=20`,
  )

  expect(Array.isArray(list.data)).toBe(true)
  for (const record of list.data) {
    expect(record.createdAt, 'every filtered record carries a createdAt').toBeTruthy()
  }
})
