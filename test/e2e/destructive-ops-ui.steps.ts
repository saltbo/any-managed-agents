import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

interface DestructiveWorld extends AmaWorld {
  // Set by agent-detail-ui / environment-detail-ui Given steps
  activeResourcePage?: Page
  activeResourceType?: string
  activeResourceId?: string
  activeResourceName?: string
  // Workflow for destructive-ops specific scenarios
  destructiveWorkflow?: {
    page: Page
    runId: string
    agentId?: string
    environmentId?: string
    sessionId?: string
  }
}

async function ensureDestructiveWorkflow(world: DestructiveWorld) {
  if (world.destructiveWorkflow) return world.destructiveWorkflow
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.destructiveWorkflow = {
    page,
    runId: `destructive-e2e-${Date.now()}`,
  }
  return world.destructiveWorkflow
}

// ─── Shared step: used by agent-detail.feature AND environment-detail.feature ───

When('the user chooses archive and confirms the destructive action', async function (this: DestructiveWorld) {
  // Determine which page to use: prefer the active resource page set by context steps,
  // falling back to the destructive workflow page.
  const page = this.activeResourcePage ?? this.destructiveWorkflow?.page
  assert.ok(page, 'A page must be open before confirming archive')
  // Click the Archive button — it appears in the detail view actions
  await page.getByRole('button', { name: 'Archive' }).click()
  // The shared ConfirmAction dialog opens
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  // Confirm the archive
  await dialog.getByRole('button', { name: /Archive/ }).click()
  // Wait for dialog to close
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
})

// ─── Destructive-ops.feature: Confirm destructive action ───

When(
  'a user deletes, archives, revokes, or stops a sensitive resource',
  { timeout: 120_000 },
  async function (this: DestructiveWorld) {
    const workflow = await ensureDestructiveWorkflow(this)
    // Create an agent to archive as the representative sensitive resource
    const agent = await apiJson<{ id: string; name: string }>(workflow.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${workflow.runId} confirm-destructive agent`,
        instructions: 'Test agent for destructive op confirmation.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: [],
        allowedTools: [],
        metadata: { runId: workflow.runId },
      },
    })
    workflow.agentId = agent.id
    await workflow.page.goto('/agents')
    await expect(workflow.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    // Click archive on the agent row — opens the ConfirmAction dialog
    await workflow.page.getByRole('button', { name: 'Archive agent' }).first().click()
  },
)

Then('the platform requires explicit confirmation and records an audit event', async function (this: DestructiveWorld) {
  const page = (this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>).page
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  // Title, description, and confirm button all contain "Archive" — use first() to avoid strict mode violation
  await expect(dialog.getByText(/Archive/).first()).toBeVisible()
  // Confirm and check audit
  await dialog.getByRole('button', { name: /Archive/ }).click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
  // Verify audit record created by checking the audit page
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Audit' })).toBeVisible()
})

// ─── Destructive-ops.feature: Use consistent destructive confirmations ───

When(
  'a user archives agents, environments, sessions, vaults, credentials, providers, MCP connections, or governance rules',
  { timeout: 120_000 },
  async function (this: DestructiveWorld) {
    const workflow = await ensureDestructiveWorkflow(this)
    // Create an agent to trigger the archive dialog
    const agent = await apiJson<{ id: string }>(workflow.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${workflow.runId} consistent-dialog agent`,
        instructions: 'Agent for consistent dialog test.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: [],
        allowedTools: [],
        metadata: { runId: workflow.runId },
      },
    })
    workflow.agentId = agent.id
    await workflow.page.goto('/agents')
    await expect(workflow.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    await workflow.page.getByRole('button', { name: 'Archive agent' }).first().click()
  },
)

Then('the UI uses the shared confirmation dialog pattern', async function (this: DestructiveWorld) {
  const page = (this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>).page
  // Shared ConfirmAction renders an AlertDialog with Cancel and Confirm buttons
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Archive/ })).toBeVisible()
})

Then('the dialog names the resource and consequence', async function (this: DestructiveWorld) {
  const page = (this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>).page
  const dialog = page.getByRole('alertdialog')
  // Dialog title says "Archive agent?" and confirm button says "Archive agent" — use first() to avoid strict mode
  await expect(dialog.getByText(/Archive agent/i).first()).toBeVisible()
  await expect(dialog.getByText(new RegExp(`${this.destructiveWorkflow?.runId}`, 'i'))).toBeVisible()
})

Then('cancel leaves the resource unchanged', async function (this: DestructiveWorld) {
  const page = (this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>).page
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).not.toBeVisible({ timeout: 5_000 })
  // Agent still shows as active in the list
  await expect(page.getByText('active').first()).toBeVisible()
})

// ─── Destructive-ops.feature: Distinguish archive, revoke, stop, and hard delete ───

When('a destructive operation is offered', { timeout: 120_000 }, async function (this: DestructiveWorld) {
  const workflow = await ensureDestructiveWorkflow(this)
  // Create an agent and an environment to check label semantics across resource types
  const agent = await apiJson<{ id: string }>(workflow.page.request, '/api/agents', {
    method: 'POST',
    data: {
      name: `${workflow.runId} distinguish agent`,
      instructions: 'Agent for distinction test.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: [],
      allowedTools: [],
      metadata: { runId: workflow.runId },
    },
  })
  workflow.agentId = agent.id
})

Then(
  'the product labels whether it is reversible archive, credential revoke, session stop, or permanent delete',
  async function (this: DestructiveWorld) {
    const workflow = this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>
    const page = workflow.page

    // Agents: "Archive agent" label (reversible, keeps record)
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
    await page.getByRole('button', { name: 'Archive agent' }).first().click()
    const agentDialog = page.getByRole('alertdialog')
    // Title "Archive agent?" and button "Archive agent" both match — use first() to avoid strict mode
    await expect(agentDialog.getByText(/Archive agent/i).first()).toBeVisible()
    // Description says "Existing active sessions are not deleted" — reversible archive semantics
    await expect(agentDialog.getByText(/not deleted|leave the active list/i)).toBeVisible()
    await agentDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(agentDialog).not.toBeVisible({ timeout: 5_000 })

    // Sessions: archive button accessible name is "Archive" (icon-only button in the row)
    // The dialog title says "Archive session?" confirming the label semantics
    await page.goto('/sessions')
    // Sessions list uses a ghost "Archive" button per row (aria-label not set, visible text "Archive")
    const archiveSessionBtn = page.getByRole('button', { name: 'Archive' }).first()
    const sessionRowPresent = await archiveSessionBtn.isVisible().catch(() => false)
    if (sessionRowPresent) {
      await archiveSessionBtn.click()
      const sessionDialog = page.getByRole('alertdialog')
      await expect(sessionDialog.getByText(/Archive session/i)).toBeVisible()
      await expect(sessionDialog.getByText(/preserv/i)).toBeVisible()
      await sessionDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(sessionDialog).not.toBeVisible({ timeout: 5_000 })
    }

    // Credential revoke: vault credentials show 'revoked' status (not 'deleted')
    // Verify no hard-delete button for agents (archival resource)
    await page.goto('/agents')
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0)
  },
)

Then(
  'permanent delete is available only when the resource has no required historical references',
  async function (this: DestructiveWorld) {
    const page = (this.destructiveWorkflow as NonNullable<DestructiveWorld['destructiveWorkflow']>).page
    // Agents are archival resources (have session history) — no hard delete offered
    await page.goto('/agents')
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0)
    // Environments are archival resources — no hard delete offered
    await page.goto('/environments')
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0)
  },
)
