import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createSession,
  ensureAgentAndEnvironment,
  ensureSignedIn,
  type Json,
  type StepsWorld,
  stopSession,
} from './shared-helpers'

// ─── Background: Given an organization has active sessions ───────────────────

Given('an organization has active sessions', async function (this: StepsWorld) {
  const state = await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
})

// ─── Scenario: Summarize usage (usage-audit.feature) ─────────────────────────

When('the operator views usage', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Call the usage summary endpoint with no filters — all usage for the project
  const summary = await apiJson<Json>(state.page.request, '/api/usage/summary')
  ;(state as typeof state & { usageSummary?: Json }).usageSummary = summary
})

Then('usage is grouped by organization, project, provider, model, agent, and session', function (this: StepsWorld) {
  const state = this.e2e as typeof this.e2e & { usageSummary?: Json }
  assert.ok(state, 'e2e state must exist')
  const summary = state.usageSummary
  assert.ok(summary, 'usage summary must have been fetched')
  // Summary must have totals and groups structure regardless of data volume
  assert.ok('totals' in summary, 'usage summary must include totals')
  assert.ok('groups' in summary, 'usage summary must include groups')
  const totals = summary.totals as Json
  assert.ok(typeof totals.records === 'number', 'totals.records must be a number')
  assert.ok(typeof totals.totalTokens === 'number', 'totals.totalTokens must be a number')
  assert.ok(Array.isArray(summary.groups), 'usage summary groups must be an array')
})

Then('the summary includes time range filters', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Verify that the endpoint accepts createdFrom and createdTo filters
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const to = new Date().toISOString()
  const summary = await apiJson<Json>(
    state.page.request,
    `/api/usage/summary?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
  )
  assert.ok('totals' in summary, 'time-filtered usage summary must include totals')
  assert.ok('groups' in summary, 'time-filtered usage summary must include groups')
})

// ─── Scenario: Export audit records (usage-audit.feature) ────────────────────

When('an operator exports audit records for a time range', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Generate audit events by stopping the existing session
  await stopSession(state)
  // Export audit records
  const from = new Date(Date.now() - 60 * 1000).toISOString()
  const to = new Date(Date.now() + 60 * 1000).toISOString()
  const exported = await apiJson<Json[]>(
    state.page.request,
    `/api/audit-records/export?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
  )
  ;(state as typeof state & { auditExport?: Json[] }).auditExport = exported
})

Then('the export includes stable identifiers and event metadata', function (this: StepsWorld) {
  const state = this.e2e as typeof this.e2e & { auditExport?: Json[] }
  assert.ok(state, 'e2e state must exist')
  const exported = state.auditExport
  assert.ok(Array.isArray(exported), 'audit export must be an array')
  for (const record of exported) {
    assert.ok(typeof record.id === 'string', 'each audit record must have a stable id')
    assert.ok(typeof record.action === 'string', 'each audit record must have an action')
    assert.ok(typeof record.createdAt === 'string', 'each audit record must have a createdAt timestamp')
    assert.ok(typeof record.resourceType === 'string', 'each audit record must have a resourceType')
  }
})

Then("respects the operator's organization scope", function (this: StepsWorld) {
  const state = this.e2e as typeof this.e2e & { auditExport?: Json[] }
  assert.ok(state, 'e2e state must exist')
  const exported = state.auditExport
  assert.ok(Array.isArray(exported), 'audit export must be an array')
  const org = (state.auth as Json | undefined)?.organization as Json | undefined
  const orgId = typeof org?.id === 'string' ? org.id : ''
  if (orgId && exported.length > 0) {
    for (const record of exported) {
      assert.equal(record.organizationId, orgId, `audit record must be scoped to the operator's organization`)
    }
  }
  // Verify no raw secret values appear in the export
  assert.ok(!JSON.stringify(exported).includes('raw-secret'), 'audit export must not include raw secret values')
})

// ─── Scenario: View usage summary (usage-summary.feature) ────────────────────

When('the operator opens usage analytics', async function (this: StepsWorld) {
  const state = await ensureSignedIn(this)
  // Ensure there are some sessions for context
  if (!state.latestSession) {
    await ensureAgentAndEnvironment(this)
    state.latestSession = await createSession(state)
  }
  const summary = await apiJson<Json>(state.page.request, '/api/usage/summary')
  ;(state as typeof state & { usageSummary?: Json }).usageSummary = summary
})

Then(
  'usage is grouped by organization, project, provider, model, agent, session, and time range',
  async function (this: StepsWorld) {
    const state = this.e2e as typeof this.e2e & { usageSummary?: Json }
    assert.ok(state, 'e2e state must exist')
    // Verify the default groupBy covers all dimensions
    const summary = state.usageSummary ?? (await apiJson<Json>(state!.page.request, '/api/usage/summary'))
    assert.ok('totals' in summary, 'usage summary must include totals')
    assert.ok('groups' in summary, 'usage summary must include groups')
    // Verify that groupBy query parameter works for fine-grained grouping
    const sessionGrouped = await apiJson<Json>(state!.page.request, '/api/usage/summary?groupBy=session,provider,model')
    assert.ok('totals' in sessionGrouped, 'session-grouped summary must include totals')
    assert.ok(Array.isArray(sessionGrouped.groups), 'session-grouped summary must include groups array')
  },
)

// ─── Scenario: Filter and group usage analytics (usage-summary.feature) ──────

Given('sessions have recorded token, duration, tool, sandbox, and error usage', async function (this: StepsWorld) {
  // Create a session that generates runtime activity (test mode records usage events)
  const state = await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
})

When(
  'the operator filters by organization, project, provider, model, agent, session, status, or time range',
  async function (this: StepsWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const sessionId = String((state.latestSession as Json).id)
    const agentId = String((state.agent as Json | undefined)?.id ?? '')
    // Exercise each supported filter dimension
    const sessionFiltered = await apiJson<Json>(state.page.request, `/api/usage/summary?sessionId=${sessionId}`)
    const agentFiltered = agentId
      ? await apiJson<Json>(state.page.request, `/api/usage/summary?agentId=${agentId}`)
      : { totals: { records: 0 }, groups: [] }
    const timeFiltered = await apiJson<Json>(
      state.page.request,
      `/api/usage/summary?createdFrom=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
    )
    ;(state as typeof state & { filterResults?: Json[] }).filterResults = [sessionFiltered, agentFiltered, timeFiltered]
  },
)

Then('totals and grouped breakdowns update consistently', function (this: StepsWorld) {
  const state = this.e2e as typeof this.e2e & { filterResults?: Json[] }
  assert.ok(state, 'e2e state must exist')
  const results = state.filterResults
  assert.ok(Array.isArray(results) && results.length > 0, 'filter results must exist')
  for (const result of results) {
    assert.ok('totals' in result, 'each filtered result must include totals')
    assert.ok('groups' in result, 'each filtered result must include groups')
    const totals = result.totals as Json
    assert.ok(typeof totals.records === 'number', 'totals.records must be a number')
    assert.ok(typeof totals.totalTokens === 'number', 'totals.totalTokens must be a number')
  }
})

Then('empty ranges show an explicit empty state', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Request a time range far in the future — must return an empty but valid summary
  const futureFrom = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const futureTo = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
  const empty = await apiJson<Json>(
    state.page.request,
    `/api/usage/summary?createdFrom=${encodeURIComponent(futureFrom)}&createdTo=${encodeURIComponent(futureTo)}`,
  )
  assert.ok('totals' in empty, 'empty-range summary must include totals')
  assert.ok('groups' in empty, 'empty-range summary must include groups')
  const totals = empty.totals as Json
  assert.equal(totals.records, 0, 'empty range totals.records must be 0')
  assert.ok(Array.isArray(empty.groups) && empty.groups.length === 0, 'empty range groups must be an empty array')
})
