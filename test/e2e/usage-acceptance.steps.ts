import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson } from './local-app'
import {
  createAgent,
  createEnvironment,
  createSession,
  ensureAgentAndEnvironment,
  ensureSignedIn,
  type Json,
  type StepsWorld,
  stopSession,
  waitForSessionEventMatch,
} from './shared-helpers'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

export interface UsageSummaryShape {
  totals: { records: number; promptTokens: number; completionTokens: number; totalTokens: number }
  groups: Array<{ key: Record<string, unknown>; records: number; totalTokens: number }>
}

type UsageWorld = StepsWorld & {
  usageSummary?: UsageSummaryShape
  filterResults?: UsageSummaryShape[]
}

export async function driveRealUsageTurn(world: StepsWorld, label: string, prompt: string) {
  const state = await ensureSignedIn(world)
  state.agent = await createAgent(state, {
    name: `${state.runId} ${label} agent`,
    provider: 'workers-ai',
    model: WORKERS_AI_MODEL,
  })
  state.environment ??= await createEnvironment(state, { name: `${state.runId} ${label} env` })
  state.latestSession = await createSession(state, { title: `${state.runId} ${label} session` })
  await apiJson<Json>(state.page.request, `/api/sessions/${state.latestSession?.id}/commands`, {
    method: 'POST',
    data: { type: 'prompt', message: `${state.runId} ${prompt}` },
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
  this.usageSummary = await apiJson<UsageSummaryShape>(state.page.request, '/api/usage/summary')
})

Then('usage is grouped by organization, project, provider, model, agent, and session', function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const summary = this.usageSummary
  assert.ok(summary, 'usage summary must have been fetched')
  assert.ok(summary.totals.totalTokens > 0, 'the summary aggregates the recorded token usage')
  const group = summary.groups.find((candidate) => candidate.key.session === state.latestSession?.id)
  assert.ok(group, 'the summary contains a group for the runtime session')
  const organization = (state.auth?.organization ?? {}) as Json
  const project = (state.auth?.project ?? {}) as Json
  assert.equal(group.key.organization, organization.id, 'the group is keyed by the organization')
  assert.equal(group.key.project, project.id, 'the group is keyed by the project')
  assert.equal(group.key.provider, 'workers-ai', 'the group is keyed by the provider')
  assert.equal(group.key.model, WORKERS_AI_MODEL, 'the group is keyed by the model')
  assert.equal(group.key.agent, state.agent?.id, 'the group is keyed by the agent')
  assert.ok(group.totalTokens > 0, 'the session group carries the recorded token usage')
})

Then('the summary includes time range filters', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state && this.usageSummary, 'usage summary must have been fetched')
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const to = new Date(Date.now() + 60 * 1000).toISOString()
  const inRange = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/usage/summary?createdFrom=${encodeURIComponent(from)}&createdTo=${encodeURIComponent(to)}`,
  )
  assert.equal(
    inRange.totals.totalTokens,
    this.usageSummary.totals.totalTokens,
    'a range covering the runtime turn returns the recorded usage',
  )
  const futureFrom = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const outOfRange = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/usage/summary?createdFrom=${encodeURIComponent(futureFrom)}`,
  )
  assert.equal(outOfRange.totals.records, 0, 'a range after the runtime turn excludes the recorded usage')
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

When(
  'the operator filters by organization, project, provider, model, agent, session, status, or time range',
  async function (this: UsageWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const sessionId = String(state.latestSession?.id)
    const agentId = String(state.agent?.id)
    const from = encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())
    const queries = [
      `sessionId=${sessionId}`,
      `agentId=${agentId}`,
      'provider=workers-ai',
      `model=${encodeURIComponent(WORKERS_AI_MODEL)}`,
      'status=success',
      `createdFrom=${from}`,
    ]
    this.filterResults = []
    for (const query of queries) {
      this.filterResults.push(
        await apiJson<UsageSummaryShape>(state.page.request, `/api/usage/summary?${query}&groupBy=provider,session`),
      )
    }
  },
)

Then('totals and grouped breakdowns update consistently', function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const results = this.filterResults
  assert.ok(results && results.length === 6, 'each filter dimension produced a summary')
  const [bySession, byAgent, byProvider, byModel, byStatus, byTime] = results as [
    UsageSummaryShape,
    UsageSummaryShape,
    UsageSummaryShape,
    UsageSummaryShape,
    UsageSummaryShape,
    UsageSummaryShape,
  ]
  assert.ok(bySession.totals.records >= 2, 'the session recorded model and tool usage')
  assert.ok(bySession.totals.totalTokens > 0, 'the session-filtered summary carries recorded tokens')
  for (const [label, result] of Object.entries({ bySession, byAgent, byProvider, byModel, byStatus, byTime })) {
    assertGroupsAddUpToTotals(result, label)
  }
  // Agent, status, and time filters cover the same single-session activity.
  assert.equal(byAgent.totals.records, bySession.totals.records, 'agent and session filters agree')
  assert.equal(byStatus.totals.records, bySession.totals.records, 'all recorded usage completed successfully')
  assert.equal(byTime.totals.records, bySession.totals.records, 'an in-range time filter keeps all usage')
  // Provider/model filters narrow to model usage and exclude sandbox tool usage.
  assert.ok(byProvider.totals.records >= 1, 'the provider filter matches the model usage')
  assert.ok(byProvider.totals.records < bySession.totals.records, 'the provider filter excludes sandbox tool usage')
  assert.equal(byModel.totals.records, byProvider.totals.records, 'model and provider filters agree')
})

Then('empty ranges show an explicit empty state', async function (this: UsageWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  // Request a time range far in the future — must return an empty but valid summary
  const futureFrom = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  const futureTo = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString()
  const empty = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/usage/summary?createdFrom=${encodeURIComponent(futureFrom)}&createdTo=${encodeURIComponent(futureTo)}`,
  )
  assert.equal(empty.totals.records, 0, 'empty range totals.records must be 0')
  assert.ok(Array.isArray(empty.groups) && empty.groups.length === 0, 'empty range groups must be an empty array')
})
