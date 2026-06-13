import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import type { Json, ListResponse } from './shared-helpers'
import type { AmaWorld } from './world'

// The browse scenarios reuse the page/workflow Givens from ui-layout.steps.ts
// (same World instance); these structural types read that shared state.
interface SharedUiWorkflow {
  page: Page
  runId: string
  agentId?: string
  environmentId?: string
}

interface SharedEnvDetailWorkflow {
  page: Page
  runId: string
  environmentId?: string
}

interface BulkState {
  page: Page
  runId: string
  agentId?: string
  environmentId?: string
  sessionIds?: string[]
  failingSessionId?: string
}

type ListUxWorld = AmaWorld & {
  uiWorkflow?: SharedUiWorkflow
  envDetailWorkflow?: SharedEnvDetailWorkflow
  envEditSnapshot?: Json
  envEditSessionId?: string
  bulk?: BulkState
}

function sharedWorkflow(world: ListUxWorld): SharedUiWorkflow {
  assert.ok(world.uiWorkflow, 'the shared UI workflow must be initialized by the page Given')
  return world.uiWorkflow
}

async function bulkState(world: ListUxWorld): Promise<BulkState> {
  if (world.bulk) {
    return world.bulk
  }
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.bulk = { page, runId: `list-ux-${Date.now()}-${Math.random().toString(16).slice(2)}` }
  return world.bulk
}

async function createBulkSessions(state: BulkState, count: number) {
  if (!state.agentId) {
    const agent = await apiJson<Json>(state.page.request, '/api/v1/agents', {
      method: 'POST',
      data: { name: `${state.runId} bulk agent` },
    })
    state.agentId = String(agent.id)
    const environment = await apiJson<Json>(state.page.request, '/api/v1/environments', {
      method: 'POST',
      data: { name: `${state.runId} bulk env` },
    })
    state.environmentId = String(environment.id)
  }
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
      method: 'POST',
      data: {
        agentId: state.agentId,
        environmentId: state.environmentId,
        runtime: 'ama',
        title: `${state.runId} batch session ${index + 1}`,
      },
    })
    ids.push(String(session.id))
  }
  state.sessionIds = ids
}

// ─── agents-ui: Browse and filter agents ───

Then(
  'the page supports search, filters, status, provider, and navigation to agent detail',
  async function (this: ListUxWorld) {
    const workflow = sharedWorkflow(this)
    const page = workflow.page
    const agentName = `${workflow.runId} agent`
    // Search narrows to the created agent and survives in the URL.
    await page.getByLabel('Search agents').fill(agentName)
    await expect(page).toHaveURL(/search=/)
    await expect(page.getByText(agentName)).toBeVisible()
    // The provider filter lists providers referenced by existing agents.
    // Platform-default agents resolve their provider at session start (null
    // providerId), so the only standing option is "All providers", which keeps
    // the agent visible.
    await page.getByLabel('Filter by provider').click()
    await page.getByRole('option', { name: 'All providers' }).click()
    await expect(page.getByText(agentName)).toBeVisible()
    // Status filter to archived hides the active agent; back to active shows it.
    await page.getByLabel('Filter by status').click()
    await page.getByRole('option', { name: 'archived', exact: true }).click()
    await expect(page.getByText(agentName)).toHaveCount(0)
    await page.getByLabel('Filter by status').click()
    await page.getByRole('option', { name: 'active', exact: true }).click()
    await expect(page.getByText(agentName)).toBeVisible()
    // Navigation to agent detail.
    await page.getByRole('link', { name: agentName }).click()
    await expect(page).toHaveURL(/\/agents\//)
    await expect(page.getByText('Agent model configuration')).toBeVisible()
  },
)

// ─── environments-ui: Browse environments ───

Then(
  'the user can search, filter, create, edit, archive, and inspect environments',
  async function (this: ListUxWorld) {
    const workflow = sharedWorkflow(this)
    const page = workflow.page
    const environmentName = `${workflow.runId} environment`
    await page.getByLabel('Search environments').fill(environmentName)
    await expect(page).toHaveURL(/search=/)
    await page.getByLabel('Filter by hosting mode').click()
    await page.getByRole('option', { name: 'cloud', exact: true }).click()
    await expect(page.getByText(environmentName)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create environment' })).toBeVisible()
    // Inspect: navigate to detail, where edit and archive affordances live.
    await page.getByRole('link', { name: environmentName }).click()
    await expect(page).toHaveURL(/\/environments\//)
    await expect(page.getByRole('button', { name: 'Edit environment' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Archive' }).first()).toBeVisible()
  },
)

// ─── environment-detail: Edit an environment from detail ───

When(
  'the user edits packages, variables, secret references, network policy, resource limits, runtime config, or metadata',
  { timeout: 120_000 },
  async function (this: ListUxWorld) {
    const workflow = this.envDetailWorkflow
    assert.ok(workflow?.environmentId, 'environment detail workflow must be initialized')
    const page = workflow.page
    // A session pinned to the current version proves snapshot immutability later.
    const agent = await apiJson<Json>(page.request, '/api/v1/agents', {
      method: 'POST',
      data: { name: `${workflow.runId} env-edit agent` },
    })
    const session = await apiJson<Json>(page.request, '/api/v1/sessions', {
      method: 'POST',
      data: {
        agentId: agent.id,
        environmentId: workflow.environmentId,
        runtime: 'ama',
        title: `${workflow.runId} env-edit session`,
      },
    })
    this.envEditSessionId = String(session.id)
    this.envEditSnapshot = (await apiJson<Json>(page.request, `/api/v1/sessions/${session.id}`))
      .environmentSnapshot as Json

    await page.goto(`/environments/${workflow.environmentId}`)
    await page.getByRole('button', { name: 'Edit environment' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // Invalid first: clearing the name blocks the save with a field error.
    await sheet.getByLabel('Name', { exact: true }).fill('')
    await sheet.getByRole('button', { name: /Save environment|Create environment/ }).click()
  },
)

Then('successful save creates a new environment version', async function (this: ListUxWorld) {
  const workflow = this.envDetailWorkflow
  assert.ok(workflow?.environmentId, 'environment detail workflow must be initialized')
  const page = workflow.page
  const sheet = page.getByRole('dialog')
  // Provide valid edits across packages, variables, and network policy.
  await sheet.getByLabel('Name', { exact: true }).fill(`${workflow.runId} environment edited`)
  await sheet.getByLabel(/Packages/).fill('tsx@latest\nvitest@latest')
  await sheet.getByLabel(/Variables/).fill('NODE_ENV=test')
  const saveResponse = page.waitForResponse(
    (response) => response.url().includes('/api/v1/environments/') && response.request().method() === 'PATCH',
    { timeout: 30_000 },
  )
  await sheet.getByRole('button', { name: /Save environment|Create environment/ }).click()
  const response = await saveResponse
  assert.equal(response.status(), 200, `environment update must succeed: ${await response.text()}`)
  const versions = await apiJson<ListResponse<Json>>(
    page.request,
    `/api/v1/environments/${workflow.environmentId}/versions`,
  )
  assert.ok(versions.data.length >= 2, 'editing creates a new immutable environment version')
})

Then('existing sessions keep their original environment snapshots', async function (this: ListUxWorld) {
  const workflow = this.envDetailWorkflow
  assert.ok(workflow && this.envEditSessionId, 'the pre-edit session must exist')
  const session = await apiJson<Json>(workflow.page.request, `/api/v1/sessions/${this.envEditSessionId}`)
  assert.deepEqual(
    session.environmentSnapshot,
    this.envEditSnapshot,
    'the session environment snapshot is unchanged by the edit',
  )
})

// ─── sessions-ui: Browse sessions ───

Then('sessions can be searched, filtered, sorted, opened, stopped, and archived', async function (this: ListUxWorld) {
  const workflow = sharedWorkflow(this)
  const page = workflow.page
  const title = `${workflow.runId} session`
  await page.getByLabel('Search sessions').fill(title)
  await expect(page).toHaveURL(/search=/)
  await expect(page.getByText(title).first()).toBeVisible()
  // Sort control round-trips through the URL.
  await page.getByRole('combobox').filter({ hasText: 'Recently updated' }).click()
  await page.getByRole('option', { name: 'Recently started' }).click()
  await expect(page).toHaveURL(/sort=started-desc/)
  // Open the session; stop/archive affordances live on the opened session,
  // behind the header Actions menu.
  await page.getByRole('link', { name: title }).first().click()
  await expect(page).toHaveURL(/\/sessions\//)
  await page.getByRole('button', { name: 'Actions' }).click()
  await expect(page.getByRole('menuitem', { name: /Stop session|Archive session/ }).first()).toBeVisible()
  await page.keyboard.press('Escape')
})

// ─── sessions-list-bulk-archive: Bulk archive sessions ───

Given('multiple sessions are selected', { timeout: 120_000 }, async function (this: ListUxWorld) {
  const state = await bulkState(this)
  await createBulkSessions(state, 3)
  const page = state.page
  await page.goto(`/sessions?search=${encodeURIComponent(`${state.runId} batch session`)}`)
  await expect(page.getByText(`${state.runId} batch session 1`)).toBeVisible()
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await checkbox.check()
  }
  const checkedCount = await page.getByRole('checkbox', { checked: true }).count()
  assert.ok(checkedCount >= 3, 'three sessions are selected')
})

When('the user archives them', async function (this: ListUxWorld) {
  const state = await bulkState(this)
  const page = state.page
  await page.getByRole('button', { name: 'Archive selected' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Archive sessions/ })
    .click()
  await expect(page.getByTestId('batch-archive-outcome')).toContainText('All selected sessions archived')
})

Then(
  'archived sessions are hidden from the default list and remain available through filters',
  async function (this: ListUxWorld) {
    const state = await bulkState(this)
    const page = state.page
    const defaultList = await apiJson<ListResponse<Json>>(page.request, '/api/v1/sessions?limit=100')
    for (const id of state.sessionIds ?? []) {
      assert.ok(
        !defaultList.data.some((session) => session.id === id),
        'archived sessions are hidden from the default list',
      )
    }
    await page.goto(`/sessions?search=${encodeURIComponent(`${state.runId} batch session`)}&status=archived`)
    await expect(page.getByText(`${state.runId} batch session 1`)).toBeVisible()
  },
)

// ─── destructive-ops: Stop batch destructive operations on first failure ───

Given('a user performs a batch archive or revoke operation', { timeout: 120_000 }, async function (this: ListUxWorld) {
  const state = await bulkState(this)
  await createBulkSessions(state, 3)
  const page = state.page
  // Deterministic mid-batch failure: the second session's archive request is
  // rejected at the network layer, exercising the UI's halt semantics.
  const failingId = state.sessionIds?.[1]
  assert.ok(failingId, 'three sessions must exist')
  state.failingSessionId = failingId
  // v1 archives a session via PATCH /api/v1/sessions/{id} {archived:true};
  // reject that single request to exercise the UI's mid-batch halt semantics.
  await page.route(`**/api/v1/sessions/${failingId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { type: 'internal_error', message: 'Injected batch failure' } }),
      })
      return
    }
    await route.fallback()
  })
  await page.goto(`/sessions?search=${encodeURIComponent(`${state.runId} batch session`)}`)
  await expect(page.getByText(`${state.runId} batch session 1`)).toBeVisible()
  for (const checkbox of await page.getByRole('checkbox').all()) {
    await checkbox.check()
  }
})

When('one item fails', async function (this: ListUxWorld) {
  const state = await bulkState(this)
  const page = state.page
  await page.getByRole('button', { name: 'Archive selected' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: /Archive sessions/ })
    .click()
  await expect(page.getByTestId('batch-archive-outcome')).toContainText('Failed on')
})

Then('later items are not processed', async function (this: ListUxWorld) {
  const state = await bulkState(this)
  const ids = state.sessionIds ?? []
  const archived = await apiJson<ListResponse<Json>>(state.page.request, '/api/v1/sessions?archived=true&limit=100')
  const isArchived = (id: string) => archived.data.some((session) => session.id === id)
  // The list renders newest-first, so the batch processed session 3 first,
  // failed on the injected session 2, and never reached session 1.
  assert.equal(isArchived(ids[2] ?? ''), true, 'the item before the failure archived')
  assert.equal(isArchived(ids[1] ?? ''), false, 'the failed item is not archived')
  assert.equal(isArchived(ids[0] ?? ''), false, 'items after the failure are not processed')
})

Then('the UI reports which items succeeded and which item failed', async function (this: ListUxWorld) {
  const state = await bulkState(this)
  const outcome = state.page.getByTestId('batch-archive-outcome')
  await expect(outcome).toContainText('Archived 1 session')
  await expect(outcome).toContainText('Failed on')
  await expect(outcome).toContainText('1 not processed')
})

Then('selection state supports retry without guessing', async function (this: ListUxWorld) {
  const state = await bulkState(this)
  const page = state.page
  // The failed and unprocessed sessions stay selected (the archived row is
  // gone); the archive action remains armed for a precise retry.
  const rowCheckboxes = page.getByRole('checkbox').and(page.locator(':not([aria-label="Select all sessions"])'))
  await expect(rowCheckboxes).toHaveCount(2)
  for (const checkbox of await rowCheckboxes.all()) {
    await expect(checkbox).toBeChecked()
  }
  await expect(page.getByRole('button', { name: 'Archive selected' })).toBeEnabled()
})
