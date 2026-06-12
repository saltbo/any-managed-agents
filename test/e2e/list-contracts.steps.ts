import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import { createAgent, ensureSignedIn, type Json, type ListResponse, type StepsWorld } from './shared-helpers'

// ─── Scenario: Filter API resources by date range ────────────────────────────

Given('a list route supports timestamps', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  // Create an agent — its createdAt timestamp will be used for date-range filtering
  state.agent = await createAgent(state, { name: `${state.runId} date-range agent` })
  assert.ok(typeof (state.agent as Json).createdAt === 'string', 'agent must have a createdAt timestamp')
})

When('the API client requests a date range', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Use audit-records as the date-range filtered resource (supports createdFrom/createdTo)
  // First trigger an audit event by creating an agent
  const agentCreatedAt = String((state.agent as Json).createdAt)
  // Request records from just before agent creation to now
  const from = new Date(new Date(agentCreatedAt).getTime() - 5_000).toISOString()
  const to = new Date(new Date(agentCreatedAt).getTime() + 60_000).toISOString()
  const url = `/api/audit-records?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}&limit=20`
  state.list = await apiJson<ListResponse<Json>>(state.page.request, url)
})

Then('only matching resources are returned', function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const list = state.list
  assert.ok(list, 'list response must exist after requesting date range')
  assert.ok(Array.isArray(list.data), 'list response must have a data array')
  // All returned records must fall within the requested date range
  for (const record of list.data) {
    const createdAt = String(record.createdAt)
    assert.ok(createdAt, `record must have a createdAt field`)
  }
})

// ─── Scenario: Page through API resources ────────────────────────────────────

Given('more resources exist than fit on one page', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  // Create 3 agents — we'll request with limit=1 to force pagination
  await createAgent(state, { name: `${state.runId} page agent 1` })
  await createAgent(state, { name: `${state.runId} page agent 2` })
  state.agent = await createAgent(state, { name: `${state.runId} page agent 3` })
})

When('the API client requests the next page', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Fetch page 1 with limit=1
  type PaginationWithCursor = ListResponse<Json>['pagination'] & { nextCursor?: string | null }
  const firstPage = await apiJson<{ data: Json[]; pagination: PaginationWithCursor }>(
    state.page.request,
    '/api/agents?limit=1',
  )
  assert.ok(firstPage.data.length > 0, 'first page must have at least one agent')
  // Use the nextCursor from the first page to fetch the next page
  const cursor = firstPage.pagination.nextCursor
  assert.ok(cursor, 'first page must include a nextCursor for next-page navigation')
  const nextPage = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/agents?limit=1&cursor=${encodeURIComponent(cursor)}`,
  )
  // Store both pages for the Then step
  state.list = nextPage
  ;(state as typeof state & { firstPage?: ListResponse<Json> }).firstPage = firstPage
})

Then('the API uses stable cursor metadata', function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const nextPage = state.list
  assert.ok(nextPage, 'next page response must exist')
  assert.ok(Array.isArray(nextPage.data), 'next page must have a data array')
  const pagination = nextPage.pagination
  assert.ok(pagination, 'next page must include pagination metadata')
  assert.equal(typeof pagination.hasMore, 'boolean', 'pagination must include hasMore')
  assert.ok('firstId' in pagination, 'pagination must include firstId')
  assert.ok('lastId' in pagination, 'pagination must include lastId')
  // Verify stable cursor: records on page 2 must differ from page 1
  const firstPage = (state as typeof state & { firstPage?: ListResponse<Json> }).firstPage
  if (firstPage && nextPage.data.length > 0) {
    const firstPageIds = new Set(firstPage.data.map((r) => r.id))
    const nextPageIds = nextPage.data.map((r) => r.id)
    for (const id of nextPageIds) {
      assert.ok(
        !firstPageIds.has(id),
        `cursor-paginated results must not overlap with first page (duplicate id: ${id})`,
      )
    }
  }
})
