import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Response } from '@playwright/test'
import { apiJson } from './local-app'
import {
  createProvider,
  type E2EState,
  ensureSignedIn,
  type Json,
  type ListResponse,
  type StepsWorld,
} from './shared-helpers'

type AuditUiOperationsWorld = StepsWorld & {
  auditedProvider?: Json
  auditedVault?: Json
  detailRecord?: Json
  exportedRecords?: Json[]
}

function rawSecret(state: E2EState) {
  return `raw-${state.runId}-ui-credential`
}

function isAuditListResponse(response: Response) {
  return /\/api\/audit-records(\?|$)/.test(response.url()) && response.request().method() === 'GET'
}

async function seedProviderChangeAudit(state: E2EState) {
  const provider = await createProvider(state, { type: 'openai', displayName: `${state.runId} ui provider` })
  return await apiJson<Json>(state.page.request, `/api/providers/${provider.id}`, {
    method: 'PATCH',
    data: {
      displayName: `${state.runId} ui provider v2`,
      metadata: { apiKey: rawSecret(state), note: `${state.runId} ui note` },
    },
  })
}

async function openAuditLog(state: E2EState) {
  const listLoaded = state.page.waitForResponse(isAuditListResponse)
  await state.page.goto('/audit')
  const response = await listLoaded
  assert.equal(response.status(), 200, 'the audit page loaded records from the control plane')
  await expect(state.page.getByRole('heading', { name: 'Audit' })).toBeVisible()
}

async function applyFilter(state: E2EState, marker: string, apply: () => Promise<unknown>) {
  const filtered = state.page.waitForResponse(
    (response) => isAuditListResponse(response) && decodeURIComponent(response.url()).includes(marker),
  )
  await apply()
  const response = await filtered
  assert.equal(response.status(), 200, `the audit list reloaded for ${marker}`)
}

// ─── Scenario: Filter audit records (audit-log-ui.feature) ───────────────────

Given('audit records exist', { timeout: 120_000 }, async function (this: AuditUiOperationsWorld) {
  const state = await ensureSignedIn(this)
  this.auditedProvider = await seedProviderChangeAudit(state)
  this.auditedVault = await apiJson<Json>(state.page.request, '/api/vaults', {
    method: 'POST',
    data: { name: `${state.runId} ui vault` },
  })
})

When('the operator opens the audit log', { timeout: 120_000 }, async function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  await openAuditLog(state)
  await expect(state.page.getByRole('link', { name: 'provider.update' })).toBeVisible()
  await expect(state.page.getByRole('link', { name: 'vault.create' })).toBeVisible()
})

Then(
  'records can be filtered by actor, action, resource, project, and time range',
  { timeout: 120_000 },
  async function (this: AuditUiOperationsWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const page = state.page
    const user = (state.auth?.user ?? {}) as Json

    // Action: only the matching provider change stays visible.
    await applyFilter(state, 'action=provider.update', () =>
      page.getByLabel('Filter by action').fill('provider.update'),
    )
    await expect(page.getByRole('link', { name: 'provider.update' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'vault.create' })).toHaveCount(0)
    await applyFilter(state, 'audit-records', () => page.getByLabel('Filter by action').fill(''))

    // Resource type: only vault records stay visible.
    await applyFilter(state, 'resourceType=vault', () => page.getByLabel('Filter by resource type').fill('vault'))
    await expect(page.getByRole('link', { name: 'vault.create' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'provider.update' })).toHaveCount(0)
    await applyFilter(state, 'audit-records', () => page.getByLabel('Filter by resource type').fill(''))

    // Actor: an unknown actor matches nothing; the real actor restores rows.
    await applyFilter(state, `actorId=${state.runId}-nobody`, () =>
      page.getByLabel('Filter by actor').fill(`${state.runId}-nobody`),
    )
    await expect(page.getByText('No audit records')).toBeVisible()
    await applyFilter(state, `actorId=${user.id}`, () => page.getByLabel('Filter by actor').fill(String(user.id)))
    await expect(page.getByRole('link', { name: 'provider.update' })).toBeVisible()
    await applyFilter(state, 'audit-records', () => page.getByLabel('Filter by actor').fill(''))

    // Time range: a future start excludes everything recorded so far.
    await applyFilter(state, 'createdFrom=', () => page.getByLabel('Audit from').fill('2099-01-01T00:00'))
    await expect(page.getByText('No audit records')).toBeVisible()
    await applyFilter(state, 'audit-records', () => page.getByLabel('Audit from').fill(''))
    await expect(page.getByRole('link', { name: 'vault.create' })).toBeVisible()

    // Project: the filters stay URL-backed, so a project filter deep link applies too.
    await applyFilter(state, `projectId=${state.runId}-no-project`, () =>
      page.goto(`/audit?projectId=${state.runId}-no-project`),
    )
    await expect(page.getByText('No audit records')).toBeVisible()
    await openAuditLog(state)
    await expect(page.getByRole('link', { name: 'provider.update' })).toBeVisible()
  },
)

// ─── Scenario: Inspect an audit record (audit-log-ui.feature) ────────────────

Given(
  'an audit record exists for a resource change',
  { timeout: 120_000 },
  async function (this: AuditUiOperationsWorld) {
    const state = await ensureSignedIn(this)
    this.auditedProvider = await seedProviderChangeAudit(state)
    const records = await apiJson<ListResponse<Json>>(
      state.page.request,
      `/api/audit-records?action=provider.update&resourceId=${this.auditedProvider.id}`,
    )
    const record = records.data[0]
    assert.ok(record, 'the provider change produced an audit record')
    this.detailRecord = record
  },
)

When('the operator opens the record detail', { timeout: 120_000 }, async function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state && this.detailRecord, 'an audit record must exist')
  const page = state.page
  const detailLoaded = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/audit-records/${this.detailRecord?.id}`) && response.request().method() === 'GET',
  )
  await page.goto(`/audit/${this.detailRecord.id}`)
  const response = await detailLoaded
  assert.equal(response.status(), 200, 'the detail page loaded the record from the control plane')
  await expect(page.getByRole('heading', { name: 'provider.update' })).toBeVisible()
})

Then(
  'the detail shows safe before\\/after metadata, request origin, correlation id, and related resource links',
  async function (this: AuditUiOperationsWorld) {
    const state = this.e2e
    assert.ok(state && this.detailRecord && this.auditedProvider, 'the record detail must be open')
    const page = state.page
    // Redacted before/after snapshots show the change.
    await expect(page.getByRole('heading', { name: 'Before' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'After' })).toBeVisible()
    const content = await page.content()
    assert.ok(content.includes(`${state.runId} ui provider`), 'the before snapshot keeps the original display name')
    assert.ok(content.includes(`${state.runId} ui provider v2`), 'the after snapshot keeps the updated display name')
    // Request origin and correlation id.
    await expect(page.getByText('Request id')).toBeVisible()
    await expect(page.getByText(String(this.detailRecord.requestId)).first()).toBeVisible()
    await expect(page.getByText('Correlation id')).toBeVisible()
    // The record links back to the changed resource.
    const resourceLink = page.getByRole('link', { name: 'Open provider' })
    await expect(resourceLink).toBeVisible()
    await expect(resourceLink).toHaveAttribute('href', `/providers/${this.auditedProvider.id}`)
  },
)

Then('secret values and credential material are redacted', async function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state, 'the record detail must be open')
  const content = await state.page.content()
  assert.ok(content.includes('[REDACTED]'), 'the detail shows redaction markers for secret-shaped values')
  assert.ok(!content.includes(rawSecret(state)), 'the raw credential value never reaches the detail page')
})

// ─── Scenario: Export audit records from the UI (audit-log-ui.feature) ───────

Given('the operator has filtered audit records', { timeout: 120_000 }, async function (this: AuditUiOperationsWorld) {
  const state = await ensureSignedIn(this)
  this.auditedProvider = await seedProviderChangeAudit(state)
  this.auditedVault = await apiJson<Json>(state.page.request, '/api/vaults', {
    method: 'POST',
    data: { name: `${state.runId} ui export vault` },
  })
  await openAuditLog(state)
  await applyFilter(state, 'resourceType=provider', () =>
    state.page.getByLabel('Filter by resource type').fill('provider'),
  )
  await expect(state.page.getByRole('link', { name: 'provider.update' })).toBeVisible()
  await expect(state.page.getByRole('link', { name: 'vault.create' })).toHaveCount(0)
})

When('the operator exports the current view', { timeout: 120_000 }, async function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state, 'e2e state must exist')
  const page = state.page
  const exported = page.waitForResponse(
    (response) =>
      response.url().includes('/api/audit-records/export') && response.url().includes('resourceType=provider'),
  )
  await page.getByRole('button', { name: 'Export records' }).click()
  const response = await exported
  assert.equal(response.status(), 200, 'the export request succeeded with the active filters')
  this.exportedRecords = (await response.json()) as Json[]
  await expect(page.getByText(`Exported ${this.exportedRecords.length} audit records`)).toBeVisible()
})

Then('the export uses the same filters and organization scope', function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state && this.exportedRecords, 'the export must have completed')
  assert.ok(this.exportedRecords.length >= 2, 'the export includes the provider create and update records')
  const organization = (state.auth?.organization ?? {}) as Json
  for (const record of this.exportedRecords) {
    assert.equal(record.resourceType, 'provider', 'the export keeps the active resource type filter')
    assert.equal(record.organizationId, organization.id, "the export stays inside the operator's organization")
  }
  assert.ok(
    !this.exportedRecords.some((record) => record.action === 'vault.create'),
    'records excluded by the filter never reach the export',
  )
})

Then('includes stable identifiers and safe metadata only', function (this: AuditUiOperationsWorld) {
  const state = this.e2e
  assert.ok(state && this.exportedRecords, 'the export must have completed')
  for (const record of this.exportedRecords) {
    assert.ok(String(record.id).startsWith('audit'), 'each exported record has a stable audit id')
    assert.ok(Number.isFinite(Date.parse(String(record.createdAt))), 'each exported record has a timestamp')
  }
  const serialized = JSON.stringify(this.exportedRecords)
  assert.ok(!serialized.includes(rawSecret(state)), 'the export never carries the raw credential value')
  assert.ok(serialized.includes('[REDACTED]'), 'secret-shaped values are exported as redaction markers')
})
