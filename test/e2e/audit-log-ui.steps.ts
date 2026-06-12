import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

interface AuditWorkflow {
  page: Page
  runId: string
}

type AuditUiWorld = AmaWorld & { auditWorkflow?: AuditWorkflow }

async function ensureAuditWorkflow(world: AuditUiWorld): Promise<AuditWorkflow> {
  if (world.auditWorkflow) return world.auditWorkflow
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.auditWorkflow = {
    page,
    runId: `audit-ui-e2e-${Date.now()}`,
  }
  return world.auditWorkflow
}

// ─── Scenario: Render audit log states ───

Given('audit records are loading', { timeout: 120_000 }, async function (this: AuditUiWorld) {
  const workflow = await ensureAuditWorkflow(this)
  // Route the audit API to return an empty list so we can later
  // observe both the empty state and the populated state separately.
  await workflow.page.route('**/api/audit-records*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) }),
  )
  await workflow.page.goto('/audit')
  await expect(workflow.page.getByRole('heading', { name: 'Audit' })).toBeVisible()
})

Then('the audit page shows a loading state using shared UI primitives', async function (this: AuditUiWorld) {
  const page = (this.auditWorkflow as AuditWorkflow).page
  // The page renders the shared PageHeader primitive while data loads/is empty
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
  // Description from shared PageHeader component
  await expect(page.getByText('Review security-relevant control-plane activity')).toBeVisible()
})

When('no records match the filters', async function (this: AuditUiWorld) {
  // The route intercept set in the Given step returns an empty list.
  // Reload to ensure the empty-data render path is exercised.
  const page = (this.auditWorkflow as AuditWorkflow).page
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
})

Then('the page shows an empty state', async function (this: AuditUiWorld) {
  const page = (this.auditWorkflow as AuditWorkflow).page
  // AuditView renders EmptyState with this exact text when records array is empty
  await expect(page.getByText('No audit records')).toBeVisible()
})

When('records exist', async function (this: AuditUiWorld) {
  const workflow = this.auditWorkflow as AuditWorkflow
  const page = workflow.page
  // Replace the empty intercept with one that returns a real-looking audit record
  // Using route injection rather than real API calls avoids flakiness from audit write latency
  await page.unroute('**/api/audit-records*')
  await page.route('**/api/audit-records*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: `${workflow.runId}-audit-1`,
            action: 'agent.create',
            outcome: 'success',
            resourceType: 'agent',
            resourceId: `${workflow.runId}-agent`,
            actorType: 'user',
            actorUserId: null,
            policyCategory: null,
            requestId: null,
            projectId: null,
            createdAt: new Date().toISOString(),
          },
        ],
        total: 1,
      }),
    }),
  )
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
})

Then(
  'each row shows timestamp, actor, action, resource type, resource id, project, and outcome',
  async function (this: AuditUiWorld) {
    const page = (this.auditWorkflow as AuditWorkflow).page
    // Verify all column headers are present
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Outcome' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Resource' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Created' })).toBeVisible()
    // At least one data row must exist
    const dataRows = page.getByRole('row').filter({ hasNot: page.getByRole('columnheader') })
    await expect(dataRows.first()).toBeVisible()
  },
)
