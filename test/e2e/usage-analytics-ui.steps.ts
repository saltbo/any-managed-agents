import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { expect, type Response } from '@playwright/test'
import type { StepsWorld } from './shared-helpers'
import { driveRealUsageTurn, type UsageSummaryShape } from './usage-acceptance.steps'

const WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'
const EMPTY_GROUPS_TEXT = 'Grouped usage appears after sessions record provider events.'

type UsageUiWorld = StepsWorld & {
  usagePageSummary?: UsageSummaryShape
}

function isUsageSummaryResponse(response: Response) {
  return response.url().includes('/api/usage/summary') && response.request().method() === 'GET'
}

// ─── Scenario: View usage summary (usage-summary.feature) ────────────────────

When('the operator opens usage analytics', { timeout: 120_000 }, async function (this: UsageUiWorld) {
  // Drive a real runtime turn first so the page shows recorded usage.
  const state = await driveRealUsageTurn(this, 'usage ui', 'report your token usage')
  const summaryLoaded = state.page.waitForResponse(isUsageSummaryResponse)
  await state.page.goto('/usage')
  const summaryResponse = await summaryLoaded
  assert.equal(summaryResponse.status(), 200, 'the usage page loaded the summary from the control plane')
  this.usagePageSummary = (await summaryResponse.json()) as UsageSummaryShape
  await expect(state.page.getByRole('heading', { name: 'Usage' })).toBeVisible()
})

Then(
  'usage is grouped by organization, project, provider, model, agent, session, and time range',
  { timeout: 120_000 },
  async function (this: UsageUiWorld) {
    const state = this.e2e
    assert.ok(state, 'e2e state must exist')
    const page = state.page
    const summary = this.usagePageSummary
    assert.ok(summary, 'the usage page summary must have been captured')
    assert.ok(summary.totals.totalTokens > 0, 'the page summary reflects the recorded runtime usage')

    // The default grouping keys every row by all dimensions; the rendered
    // group cell carries the real ids of the driven runtime turn.
    const groupCell = page.locator('tbody tr td').first()
    const organization = (state.auth?.organization ?? {}) as Record<string, unknown>
    const project = (state.auth?.project ?? {}) as Record<string, unknown>
    for (const value of [
      String(organization.id),
      String(project.id),
      'workers-ai',
      WORKERS_AI_MODEL,
      String(state.agent?.id),
      String(state.latestSession?.id),
    ]) {
      await expect(groupCell).toContainText(value)
    }

    // Re-grouping by provider and model collapses the key to those fields.
    const regrouped = page.waitForResponse(
      (response) =>
        isUsageSummaryResponse(response) && decodeURIComponent(response.url()).includes('groupBy=provider,model'),
    )
    await page.getByLabel('Group usage by').click()
    await page.getByRole('option', { name: 'Provider and model' }).click()
    await regrouped
    await expect(groupCell).toContainText(WORKERS_AI_MODEL)
    await expect(groupCell).not.toContainText(String(state.latestSession?.id))

    // A future time range excludes the recorded usage and shows the empty state.
    const futureFiltered = page.waitForResponse(
      (response) => isUsageSummaryResponse(response) && response.url().includes('createdFrom='),
    )
    await page.getByLabel('Usage from').fill('2099-01-01T00:00')
    await futureFiltered
    await expect(page.getByText(EMPTY_GROUPS_TEXT)).toBeVisible()

    // Clearing the range restores the recorded usage.
    const rangeCleared = page.waitForResponse(
      (response) => isUsageSummaryResponse(response) && !response.url().includes('createdFrom='),
    )
    await page.getByLabel('Usage from').fill('')
    await rangeCleared
    await expect(page.locator('tbody tr td').first()).toContainText(WORKERS_AI_MODEL)
  },
)
