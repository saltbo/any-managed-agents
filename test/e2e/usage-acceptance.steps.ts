import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  ensureAgentAndEnvironment,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
  stopSession,
  waitForSessionEventMatch,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

interface UsageTotals {
  records: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  durationMs: number
  costMicros: number
  currency: string
}

export interface UsageSummaryShape {
  groupBy: string
  totals: UsageTotals
  groups: Array<UsageTotals & { key: Record<string, string | null> }>
}

interface FilterTotals {
  records: number
  totalTokens: number
}

type UsageWorld = StepsWorld & {
  usageSummary?: UsageSummaryShape
  usageRecords?: Json[]
  filterResults?: FilterTotals[]
}

export async function driveRealUsageTurn(world: StepsWorld, label: string, prompt: string) {
  const state = await ensureSignedIn(world)
  state.agent = await createAgent(state, {
    name: `${state.runId} ${label} agent`,
    model: WORKERS_AI_MODEL,
  })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} ${label} env` })
  state.latestSession = await createSession(state, { title: `${state.runId} ${label} session` })
  await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.latestSession?.id}/messages`, {
    method: 'POST',
    data: { type: 'prompt', content: `${state.runId} ${prompt}` },
  })
  await waitForSessionEventMatch(state, (event) => event.type === 'usage.recorded', 'recorded model usage')
  return state
}

function assertGroupsAddUpToTotals(summary: UsageSummaryShape, label: string) {
  const groupedRecords = summary.groups.reduce((sum, group) => sum + group.records, 0)
  const groupedTokens = summary.groups.reduce((sum, group) => sum + group.totalTokens, 0)
  assert.equal(groupedRecords, summary.totals.records, `${label}: grouped record counts add up to the totals`)
  assert.equal(groupedTokens, summary.totals.totalTokens, `${label}: grouped token counts add up to the totals`)
}

// ─── Background: Given an organization has active sessions ───────────────────

Given('an organization has active sessions', { timeout: 120_000 }, async function (this: StepsWorld) {
  const state = await ensureAgentAndEnvironment(this)
  state.latestSession = await createSession(state)
})

// ─── Scenario: Summarize usage (usage-audit.feature) ─────────────────────────

When('the operator views usage', { timeout: 120_000 }, async function (this: UsageWorld) {
  // Drive a real runtime turn first so the summary reflects recorded usage
  // instead of an empty-but-valid response shape.
  const state = await driveRealUsageTurn(this, 'summarize', 'summarize the recorded usage')
  this.usageSummary = await apiJson<UsageSummaryShape>(state.page.request, '/api/v1/usage-summary?groupBy=provider')
  // Per-record attribution (organization via project, session, agent, model)
  // lives on the usage records the summary aggregates.
  const records = await apiJson<ListResponse<Json>>(
    state.page.request,
    `/api/v1/usage-records?sessionId=${state.latestSession?.id}&limit=100`,
  )
  this.usageRecords = records.data
})

Then('usage is grouped by organization, project, provider, model, agent, and session', function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const summary = this.usageSummary
  assert.ok(summary, 'usage summary must have been fetched')
  assert.ok(summary.totals.totalTokens > 0, 'the summary aggregates the recorded token usage')
  const providerGroup = summary.groups.find((candidate) => candidate.key.provider === 'workers-ai')
  assert.ok(providerGroup, 'the summary contains a group keyed by the provider')
  assert.ok(providerGroup.totalTokens > 0, 'the provider group carries the recorded token usage')
  // The records aggregated into the summary carry the full attribution chain.
  const records = this.usageRecords
  assert.ok(records && records.length >= 1, 'usage records must have been listed for the session')
  const project = (state.auth?.project ?? {}) as Json
  const modelRecord = records.find((record) => record.usageType === 'model')
  assert.ok(modelRecord, 'a model usage record exists for the session')
  assert.equal(modelRecord.projectId, project.id, 'usage is attributed to the project')
  assert.equal(modelRecord.providerType, 'workers-ai', 'usage is attributed to the provider')
  assert.equal(modelRecord.modelId, WORKERS_AI_MODEL, 'usage is attributed to the model')
  assert.equal(modelRecord.agentId, state.agent?.id, 'usage is attributed to the agent')
  assert.equal(modelRecord.sessionId, state.latestSession?.id, 'usage is attributed to the session')
})

Then('the summary includes time range filters', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state && this.usageSummary, 'usage summary must have been fetched')
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const to = new Date(Date.now() + 60 * 1000).toISOString()
  const inRange = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/v1/usage-summary?groupBy=provider&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  )
  assert.equal(
    inRange.totals.totalTokens,
    this.usageSummary.totals.totalTokens,
    'a range covering the runtime turn returns the recorded usage',
  )
  const futureFrom = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const outOfRange = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/v1/usage-summary?groupBy=provider&from=${encodeURIComponent(futureFrom)}`,
  )
  assert.equal(outOfRange.totals.records, 0, 'a range after the runtime turn excludes the recorded usage')
})

// ─── Scenario: Export audit records (usage-audit.feature) ────────────────────

When('an operator exports audit records for a time range', async function (this: StepsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Generate audit events by stopping the existing session
  await stopSession(state)
  // Export = content negotiation on the audit-records collection over a range.
  const from = new Date(Date.now() - 60 * 1000).toISOString()
  const to = new Date(Date.now() + 60 * 1000).toISOString()
  const query = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`
  const csvResponse = await apiResponse(state.page.request, `/api/v1/audit-records?${query}`, {
    headers: { accept: 'text/csv' },
  })
  assert.equal(csvResponse.status(), 200, 'the audit export succeeds')
  assert.ok(
    String(csvResponse.headers()['content-type']).includes('text/csv'),
    'the audit export downloads as text/csv',
  )
  const exported = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/audit-records?${query}`)
  ;(state as typeof state & { auditExport?: Json[] }).auditExport = exported.data
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
  const project = (state.auth as Json | undefined)?.project as Json | undefined
  const projectId = typeof project?.id === 'string' ? project.id : ''
  if (projectId && exported.length > 0) {
    for (const record of exported) {
      assert.equal(record.projectId, projectId, `audit record must be scoped to the operator's project`)
    }
  }
  // Verify no raw secret values appear in the export
  assert.ok(!JSON.stringify(exported).includes('raw-secret'), 'audit export must not include raw secret values')
})

// ─── Scenario: Filter and group usage analytics (usage-summary.feature) ──────

Given(
  'sessions have recorded token, duration, tool, sandbox, and error usage',
  { timeout: 120_000 },
  async function (this: UsageWorld) {
    // This prompt makes the test runtime issue a sandbox.exec tool call before
    // answering, so the session records model usage and sandbox tool usage.
    const state = await driveRealUsageTurn(this, 'filter', 'inspect the sandbox status')
    await waitForSessionEventMatch(state, (event) => event.type === 'tool_execution_end', 'a completed tool execution')
  },
)

function totalsOf(records: Json[]): FilterTotals {
  return {
    records: records.length,
    totalTokens: records.reduce((sum, record) => sum + Number(record.totalTokens ?? 0), 0),
  }
}

When(
  'the operator filters by organization, project, provider, model, agent, session, status, or time range',
  async function (this: UsageWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const sessionId = String(state.latestSession?.id)
    const agentId = String(state.agent?.id)
    const from = encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())
    // Dimension filtering lives on the records collection; the summary endpoint
    // only filters by time range and groups by a single dimension.
    const fetchRecords = async (query: string) => {
      const response = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/usage-records?${query}&limit=100`)
      return response.data
    }
    const sessionRecords = await fetchRecords(`sessionId=${sessionId}`)
    const agentRecords = await fetchRecords(`sessionId=${sessionId}&agentId=${agentId}`)
    // The providerId filter also matches the providerType, so the platform
    // default (null providerId, workers-ai providerType) still narrows here.
    const providerRecords = await fetchRecords(`sessionId=${sessionId}&providerId=workers-ai`)
    const modelRecords = await fetchRecords(`sessionId=${sessionId}&modelId=${encodeURIComponent(WORKERS_AI_MODEL)}`)
    const timeRecords = await fetchRecords(`sessionId=${sessionId}&from=${from}`)
    // No status filter on the records collection: narrow client-side.
    const statusRecords = sessionRecords.filter((record) => record.status === 'success')
    this.filterResults = [
      totalsOf(sessionRecords),
      totalsOf(agentRecords),
      totalsOf(providerRecords),
      totalsOf(modelRecords),
      totalsOf(statusRecords),
      totalsOf(timeRecords),
    ]
    // A single-dimension summary still aggregates the same project usage.
    const summary = await apiJson<UsageSummaryShape>(state.page.request, '/api/v1/usage-summary?groupBy=provider')
    assertGroupsAddUpToTotals(summary, 'provider summary')
  },
)

Then('totals and grouped breakdowns update consistently', function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const results = this.filterResults
  assert.ok(results && results.length === 6, 'each filter dimension produced totals')
  const [bySession, byAgent, byProvider, byModel, byStatus, byTime] = results as [
    FilterTotals,
    FilterTotals,
    FilterTotals,
    FilterTotals,
    FilterTotals,
    FilterTotals,
  ]
  assert.ok(bySession.records >= 2, 'the session recorded model and tool usage')
  assert.ok(bySession.totalTokens > 0, 'the session-filtered records carry recorded tokens')
  // Agent, status, and time filters cover the same single-session activity.
  assert.equal(byAgent.records, bySession.records, 'agent and session filters agree')
  assert.equal(byStatus.records, bySession.records, 'all recorded usage completed successfully')
  assert.equal(byTime.records, bySession.records, 'an in-range time filter keeps all usage')
  // Provider/model filters narrow to model usage and exclude sandbox tool usage.
  assert.ok(byProvider.records >= 1, 'the provider filter matches the model usage')
  assert.ok(byProvider.records < bySession.records, 'the provider filter excludes sandbox tool usage')
  assert.equal(byModel.records, byProvider.records, 'model and provider filters agree')
})

Then('empty ranges show an explicit empty state', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Request a time range far in the future — must return an empty but valid summary
  const futureFrom = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const futureTo = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
  const empty = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/v1/usage-summary?groupBy=provider&from=${encodeURIComponent(futureFrom)}&to=${encodeURIComponent(futureTo)}`,
  )
  assert.equal(empty.totals.records, 0, 'empty range totals.records must be 0')
  assert.ok(Array.isArray(empty.groups) && empty.groups.length === 0, 'empty range groups must be an empty array')
})
