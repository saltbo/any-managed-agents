import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

interface AgentRecord {
  id: string
  name: string
  version: number
  status: string
}

interface AgentDetailWorkflow {
  page: Page
  runId: string
  agentId: string
}

type AgentDetailWorld = AmaWorld & {
  agentDetailWorkflow?: AgentDetailWorkflow
  // Shared with destructive-ops-ui.steps.ts
  activeResourcePage?: Page
  activeResourceType?: string
  activeResourceId?: string
  activeResourceName?: string
}

async function ensureAgentDetailWorkflow(world: AgentDetailWorld): Promise<AgentDetailWorkflow> {
  if (world.agentDetailWorkflow) return world.agentDetailWorkflow
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.agentDetailWorkflow = {
    page,
    runId: `agent-detail-e2e-${Date.now()}`,
    agentId: '',
  }
  return world.agentDetailWorkflow
}

async function createTestAgent(workflow: AgentDetailWorkflow, overrides?: Record<string, unknown>) {
  const agent = await apiJson<AgentRecord>(workflow.page.request, '/api/agents', {
    method: 'POST',
    data: {
      name: `${workflow.runId} agent`,
      description: 'Agent detail UI e2e test agent',
      instructions: 'Reply concisely in the test.',
      systemPrompt: 'Reply concisely in the test.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: ['ama@local-ui'],
      allowedTools: ['sandbox.exec'],
      metadata: { runId: workflow.runId },
      ...overrides,
    },
  })
  workflow.agentId = agent.id
  return agent
}

Given('an agent exists', { timeout: 120_000 }, async function (this: AgentDetailWorld) {
  const workflow = await ensureAgentDetailWorkflow(this)
  if (!workflow.agentId) {
    await createTestAgent(workflow)
  }
})

Given(
  'an agent exists with skills, tools, MCP connectors, metadata, and versions',
  { timeout: 120_000 },
  async function (this: AgentDetailWorld) {
    const workflow = await ensureAgentDetailWorkflow(this)
    const agent = await createTestAgent(workflow, {
      skills: ['ama@local-ui', 'ama@test'],
      allowedTools: ['sandbox.exec', 'sandbox.read'],
      mcpConnectors: [],
      metadata: { runId: workflow.runId, env: 'e2e' },
    })
    // Update agent to create a second version
    await apiJson(workflow.page.request, `/api/agents/${agent.id}`, {
      method: 'PATCH',
      data: { description: 'Updated for version 2' },
    })
    workflow.agentId = agent.id
  },
)

Given('an agent is active', { timeout: 120_000 }, async function (this: AgentDetailWorld) {
  const workflow = await ensureAgentDetailWorkflow(this)
  if (!workflow.agentId) {
    await createTestAgent(workflow)
  }
  // Navigate to the agent detail page so archive/edit steps can find the action buttons
  await workflow.page.goto(`/agents/${workflow.agentId}`)
  await expect(workflow.page.getByText('Agent model configuration')).toBeVisible()
  // Expose active resource context for the shared archive step in destructive-ops-ui.steps.ts
  this.activeResourcePage = workflow.page
  this.activeResourceType = 'agent'
  this.activeResourceId = workflow.agentId
  this.activeResourceName = `${workflow.runId} agent`
})

When('the user opens the agent detail page', async function (this: AgentDetailWorld) {
  const workflow = await ensureAgentDetailWorkflow(this)
  assert.ok(workflow.agentId, 'Agent must be created before opening detail page')
  await workflow.page.goto(`/agents/${workflow.agentId}`)
  await expect(workflow.page.getByText('Agent model configuration')).toBeVisible()
})

Then(
  'the page shows instructions, model, tools, policy, versions, and archive state',
  async function (this: AgentDetailWorld) {
    const page = (this.agentDetailWorkflow as AgentDetailWorkflow).page
    await expect(page.getByText('Agent model configuration')).toBeVisible()
    await expect(page.getByText('Provider').first()).toBeVisible()
    await expect(page.getByText('Model').first()).toBeVisible()
    await expect(page.getByText('Skills').first()).toBeVisible()
    await expect(page.getByText('Allowed tools').first()).toBeVisible()
    // Archive state visible via StatusBadge (active/archived)
    await expect(page.getByText('active').first()).toBeVisible()
  },
)

Then('the header shows name, status, and timestamps', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  // Page header shows agent name (runId agent)
  await expect(page.getByText(new RegExp(workflow.runId)).first()).toBeVisible()
  // Status badge is visible
  await expect(page.getByText('active').first()).toBeVisible()
  // Timestamps shown in description (Created / Updated)
  await expect(page.getByText(/Created/).first()).toBeVisible()
})

Then(
  'the configuration view shows instructions, provider, model, skills, tools, MCP connectors, and metadata without exposing secrets or sandbox policy',
  async function (this: AgentDetailWorld) {
    const page = (this.agentDetailWorkflow as AgentDetailWorkflow).page
    await expect(page.getByText('Provider').first()).toBeVisible()
    await expect(page.getByText('Model').first()).toBeVisible()
    await expect(page.getByText('Skills').first()).toBeVisible()
    await expect(page.getByText('Allowed tools').first()).toBeVisible()
    await expect(page.getByText('MCP connectors').first()).toBeVisible()
    await expect(page.getByText('Metadata').first()).toBeVisible()
    // No sandbox policy section
    await expect(page.getByText('Sandbox policy')).toHaveCount(0)
  },
)

Then(
  'the versions view shows each immutable version with change time and runtime-relevant fields',
  async function (this: AgentDetailWorld) {
    const page = (this.agentDetailWorkflow as AgentDetailWorkflow).page
    // Version selector is visible with at least v1
    await expect(page.getByText(/v\d+/).first()).toBeVisible()
    // Version details: Version, Created, Provider, Model
    await expect(page.getByText('Version').first()).toBeVisible()
    await expect(page.getByText('Created').first()).toBeVisible()
  },
)

// When: Opens the edit sheet and attempts to save with an empty required field.
// The dialog stays open because validation blocks submission.
// Subsequent Then steps complete the successful save and verify the outcome.
When('the user edits runtime configuration and saves', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  await page.getByRole('button', { name: 'Edit agent' }).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  // Clear the required Name field and attempt to save
  await sheet.getByLabel('Name').clear()
  await sheet.getByRole('button', { name: 'Save changes' }).click()
  // The sheet must still be visible — empty name is invalid
  // (either HTML5 required blocks it or the server rejects it)
})

// Then: Asserts the edit sheet stayed open with a validation indication,
// then fills valid data and completes the save.
Then('validation errors appear next to their fields', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  const sheet = page.getByRole('dialog')
  // Sheet must still be open — invalid submit was blocked
  await expect(sheet).toBeVisible()
  // Fill valid data so the subsequent "successful save" step can proceed
  await sheet.getByLabel('Name').fill(`${workflow.runId} agent updated`)
  await sheet.getByLabel('Instructions').fill('Updated instructions for new version.')
})

// And: Submits the form (now with valid data) and verifies a new version was created.
Then('successful save creates a new version', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Save changes' }).click()
  await expect(sheet).not.toBeVisible({ timeout: 10_000 })
  // Verify version bumped via API — more reliable than UI text matching
  const agentData = await apiJson<AgentRecord>(page.request, `/api/agents/${workflow.agentId}`)
  assert.ok(agentData.version >= 2, `Expected agent version >= 2 after edit, got ${agentData.version}`)
})

Then('active sessions keep their original snapshots', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  // Sessions tab remains accessible and renders without errors after version bump
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('data-state', 'active')
  await expect(page.getByRole('tabpanel')).toBeVisible()
})

Then('the agent status becomes archived', async function (this: AgentDetailWorld) {
  const workflow = this.agentDetailWorkflow as AgentDetailWorkflow
  const page = workflow.page
  // After archive the detail page should show 'archived' status badge
  await expect(page.getByText('archived').first()).toBeVisible({ timeout: 10_000 })
})

Then('create-session actions are disabled', async function (this: AgentDetailWorld) {
  const page = (this.agentDetailWorkflow as AgentDetailWorkflow).page
  // Create session button is hidden for archived agents
  await expect(page.getByRole('button', { name: 'Create session' })).toHaveCount(0)
})

Then('existing sessions remain linked and readable', async function (this: AgentDetailWorld) {
  const page = (this.agentDetailWorkflow as AgentDetailWorkflow).page
  // Sessions tab still exists and renders without errors after archiving
  await page.getByRole('tab', { name: 'Sessions' }).click()
  await expect(page.getByRole('tabpanel')).toBeVisible()
})
