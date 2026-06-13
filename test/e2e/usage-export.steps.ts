import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { apiJson, apiResponse } from './local-app'
import type { Json, ListResponse, StepsWorld } from './shared-helpers'
import { driveRealUsageTurn, type UsageSummaryShape } from './usage-acceptance.steps'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

type UsageExportWorld = StepsWorld & {
  usageExport?: Json[]
  usageExportCsv?: string
  usageExportCsvContentType?: string
}

// ─── Scenario: Export usage summaries (usage-summary.feature) ────────────────

Given('an operator has permission to view usage', { timeout: 120_000 }, async function (this: UsageExportWorld) {
  // Sign in and drive a real runtime turn so the export carries recorded usage.
  const state = await driveRealUsageTurn(this, 'export', 'record usage for the export')
  const summary = await apiJson<UsageSummaryShape>(state.page.request, '/api/v1/usage-summary?groupBy=provider')
  assert.ok(summary.totals.records >= 1, 'the operator can read usage for the project before exporting')
})

When('the operator exports usage for a time range', async function (this: UsageExportWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const from = encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())
  const to = encodeURIComponent(new Date(Date.now() + 60 * 1000).toISOString())
  const query = `from=${from}&to=${to}&limit=100`
  // Export = content negotiation on the records collection over the time range.
  const list = await apiJson<ListResponse<Json>>(state.page.request, `/api/v1/usage-records?${query}`)
  this.usageExport = list.data
  const csvResponse = await apiResponse(state.page.request, `/api/v1/usage-records?${query}`, {
    headers: { accept: 'text/csv' },
  })
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
  const record = exported.find((candidate) => candidate.sessionId === state.latestSession?.id)
  assert.ok(record, 'the export contains the recorded usage for the runtime session')
  assert.ok(String(record.id).length > 0, 'the export keys each record by a stable id')
  assert.equal(record.providerType, 'workers-ai', 'the export keeps the provider grouping field')
  assert.equal(record.modelId, WORKERS_AI_MODEL, 'the export keeps the model grouping field')
  assert.equal(record.agentId, state.agent?.id, 'the export keys the record by the stable agent id')
  assert.ok(Number(record.totalTokens) > 0, 'the export carries the recorded token usage')
  assert.ok(typeof record.costMicros === 'number', 'the export includes cost in safe integer micros')
  assert.equal(record.currency, 'USD', 'the export includes the cost currency')
  // CSV format mirrors the same fields and never carries raw provider payloads.
  assert.ok(this.usageExportCsvContentType?.includes('text/csv'), 'the CSV export uses the text/csv content type')
  const [header = '', ...rows] = String(this.usageExportCsv)
    .split('\n')
    .filter((line) => line.length > 0)
  assert.equal(
    header,
    'id,createdAt,projectId,agentId,agentVersionId,sessionId,providerId,providerType,modelId,status,usageType,promptTokens,completionTokens,totalTokens,durationMs,costMicros,currency',
    'the CSV header lists the stable id, grouping fields, and aggregate columns',
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
  assert.ok(exported && exported.length >= 1, 'the JSON export must contain records')
  const project = (state.auth?.project ?? {}) as Record<string, unknown>
  for (const record of exported) {
    assert.equal(record.projectId, project.id, "records stay inside the operator's project")
  }
  // A different operator in a different organization never sees this usage.
  const otherToken = await apiJson<{ accessToken: string }>(state.page.request, '/api/v1/e2e/auth/token', {
    method: 'POST',
    data: { runId: `${state.runId}-other-org` },
  })
  const otherExport = await apiJson<ListResponse<Json>>(state.page.request, '/api/v1/usage-records?limit=100', {
    headers: { authorization: `Bearer ${otherToken.accessToken}` },
  })
  assert.ok(
    !otherExport.data.some((record) => record.sessionId === state.latestSession?.id),
    "another organization's export never includes this session's usage",
  )
})
