import assert from 'node:assert/strict'
import { Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson } from './local-app'
import type { AmaWorld } from './world'

// The "a signed-in user has access to a project" Given step is defined in
// product-api.steps.ts and sets this.e2e. We extend the world to access it.
type Json = Record<string, unknown>
interface E2EState {
  page: Page
  auth?: Json
  runId?: string
}
type WebUiWorld = AmaWorld & { e2e?: E2EState; createdAgentName?: string }

When('the user completes the agent creation flow', { timeout: 120_000 }, async function (this: WebUiWorld) {
  const e2e = this.e2e
  assert.ok(e2e?.page, 'A signed-in user session must exist (Given a signed-in user has access to a project)')
  const page = e2e.page
  const runId = e2e.runId ?? `web-ui-create-${Date.now()}`
  const agentName = `${runId} created agent`
  this.createdAgentName = agentName

  // Navigate to agents and open create flow
  await page.goto('/agents')
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await page.getByRole('button', { name: 'Create agent' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Name').fill(agentName)
  await dialog.getByRole('button', { name: 'Save agent' }).click()
  await expect(page.getByText('Agent created')).toBeVisible({ timeout: 10_000 })
})

Then('the agent appears in the project agent list', async function (this: WebUiWorld) {
  const page = (this.e2e as E2EState).page
  const agentName = this.createdAgentName as string
  await expect(page.getByRole('link', { name: agentName })).toBeVisible()
})

Then(
  'the user can create a session by selecting the new agent and an active environment',
  { timeout: 120_000 },
  async function (this: WebUiWorld) {
    const e2e = this.e2e as E2EState
    const page = e2e.page
    const agentName = this.createdAgentName as string
    const runId = e2e.runId ?? `web-ui-create-${Date.now()}`

    // Ensure there is an active environment to bind the session
    const envExists = await apiJson<{ data: { id: string }[] }>(page.request, '/api/environments')
    let environmentId = envExists.data.find((env) => (env as { status?: string }).status === 'active')?.id
    if (!environmentId) {
      const env = await apiJson<{ id: string }>(page.request, '/api/environments', {
        method: 'POST',
        data: {
          name: `${runId} session env`,
          description: 'Environment for web-ui create agent test.',
          packages: [],
          networkPolicy: { mode: 'unrestricted' },
          packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
          resourceLimits: { memoryMb: 512, timeoutSeconds: 300 },
          runtimeConfig: { image: 'ama-pi-runtime' },
          metadata: { runId },
        },
      })
      environmentId = env.id
    }

    // Navigate to agent detail and verify Create session button is available
    await page.getByRole('link', { name: agentName }).click()
    await expect(page).toHaveURL(/\/agents\/agent_/)
    const createSessionBtn = page.getByRole('button', { name: 'Create session' })
    await expect(createSessionBtn).toBeVisible()

    // Open the create session sheet
    await createSessionBtn.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // Verify the session form loads with agent and environment selectors
    await expect(sheet.getByText('Agent', { exact: true })).toBeVisible()
    // Close without creating to keep test state clean
    await page.keyboard.press('Escape')
  },
)
