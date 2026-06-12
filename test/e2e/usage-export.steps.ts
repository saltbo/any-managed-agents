import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import type { StepsWorld } from './shared-helpers'
import { driveRealUsageTurn, type UsageSummaryShape } from './usage-acceptance.steps'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'
const EXPORT_GROUP_BY = 'organization,project,provider,model,agent,session'

type UsageExportWorld = StepsWorld & {
  usageExport?: UsageSummaryShape
  usageExportCsv?: string
  usageExportCsvContentType?: string
}

// ─── Scenario: Export usage summaries (usage-summary.feature) ────────────────

Given('an operator has permission to view usage', { timeout: 120_000 }, async function (this: UsageExportWorld) {
  // Sign in and drive a real runtime turn so the export carries recorded usage.
  const state = await driveRealUsageTurn(this, 'export', 'record usage for the export')
  const summary = await apiJson<UsageSummaryShape>(state.page.request, '/api/usage/summary')
  assert.ok(summary.totals.records >= 1, 'the operator can read usage for the project before exporting')
})

When('the operator exports usage for a time range', async function (this: UsageExportWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const from = encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())
  const to = encodeURIComponent(new Date(Date.now() + 60 * 1000).toISOString())
  const query = `createdFrom=${from}&createdTo=${to}&groupBy=${encodeURIComponent(EXPORT_GROUP_BY)}`
  this.usageExport = await apiJson<UsageSummaryShape>(state.page.request, `/api/usage/export?${query}`)
  const csvResponse = await apiResponse(state.page.request, `/api/usage/export?${query}&format=csv`)
  assert.equal(csvResponse.status(), 200, 'the CSV export succeeds')
  assert.ok(
    String(csvResponse.headers()['content-disposition']).includes('attachment'),
    'the CSV export downloads as an attachment',
  )
  this.usageExportCsvContentType = String(csvResponse.headers()['content-type'])
  this.usageExportCsv = await csvResponse.text()
})

Then('the export includes stable ids, grouping fields, and safe cost metadata', function (this: UsageExportWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const exported = this.usageExport
  assert.ok(exported, 'the JSON export must have been fetched')
  const group = exported.groups.find((candidate) => candidate.key.session === state.latestSession?.id)
  assert.ok(group, 'the export contains the grouped usage for the runtime session')
  assert.equal(group.key.provider, 'workers-ai', 'the export keeps the provider grouping field')
  assert.equal(group.key.model, WORKERS_AI_MODEL, 'the export keeps the model grouping field')
  assert.equal(group.key.agent, state.agent?.id, 'the export keys the group by the stable agent id')
  assert.ok(group.totalTokens > 0, 'the export carries the recorded token usage')
  const aggregate = group as unknown as Record<string, unknown>
  assert.ok(typeof aggregate.costMicros === 'number', 'the export includes cost in safe integer micros')
  assert.equal(aggregate.currency, 'USD', 'the export includes the cost currency')
  assert.deepEqual(
    Object.keys(aggregate).sort(),
    ['completionTokens', 'costMicros', 'currency', 'durationMs', 'key', 'promptTokens', 'records', 'totalTokens'],
    'the export exposes only aggregate metadata, never raw provider payloads',
  )
  // CSV format mirrors the same grouping fields and aggregates.
  assert.ok(this.usageExportCsvContentType?.includes('text/csv'), 'the CSV export uses the text/csv content type')
  const [header = '', ...rows] = String(this.usageExportCsv).split('\n')
  assert.equal(
    header,
    'organization,project,provider,model,agent,session,records,promptTokens,completionTokens,totalTokens,durationMs,costMicros,currency',
    'the CSV header lists the grouping fields and aggregate columns',
  )
  assert.ok(
    rows.some((row) => row.includes(String(state.latestSession?.id))),
    'a CSV row carries the stable session id',
  )
})

Then('the export respects organization and project scope', async function (this: UsageExportWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const exported = this.usageExport
  assert.ok(exported && exported.groups.length >= 1, 'the JSON export must contain groups')
  const organization = (state.auth?.organization ?? {}) as Record<string, unknown>
  const project = (state.auth?.project ?? {}) as Record<string, unknown>
  for (const group of exported.groups) {
    assert.equal(group.key.organization, organization.id, "groups stay inside the operator's organization")
    assert.equal(group.key.project, project.id, "groups stay inside the operator's project")
  }
  // A different operator in a different organization never sees this usage.
  const otherToken = await apiJson<{ accessToken: string }>(state.page.request, '/api/e2e/auth/token', {
    method: 'POST',
    data: { runId: `${state.runId}-other-org` },
  })
  const otherExport = await apiJson<UsageSummaryShape>(
    state.page.request,
    `/api/usage/export?groupBy=${encodeURIComponent(EXPORT_GROUP_BY)}`,
    { headers: { authorization: `Bearer ${otherToken.accessToken}` } },
  )
  assert.ok(
    !otherExport.groups.some((group) => group.key.session === state.latestSession?.id),
    "another organization's export never includes this session's usage",
  )
})
