import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, openLocalPage } from './local-app'
import type { AmaWorld } from './world'

interface EnvironmentRecord {
  id: string
  name: string
  version: number
  archivedAt: string | null
}

interface EnvDetailWorkflow {
  page: Page
  runId: string
  environmentId: string
}

// e2e world shape set by product-api.steps.ts "an environment exists" step
interface ProductE2EState {
  page: Page
  runId?: string
  environment?: { id: string; name?: string }
}

type EnvDetailWorld = AmaWorld & {
  envDetailWorkflow?: EnvDetailWorkflow
  // Set by product-api.steps.ts "an environment exists" step
  e2e?: ProductE2EState
  // Shared with destructive-ops-ui.steps.ts
  activeResourcePage?: Page
  activeResourceType?: string
  activeResourceId?: string
  activeResourceName?: string
}

async function ensureEnvDetailWorkflow(world: EnvDetailWorld): Promise<EnvDetailWorkflow> {
  if (world.envDetailWorkflow) return world.envDetailWorkflow
  const page = await openLocalPage()
  await authenticateE2EPage(page)
  world.envDetailWorkflow = {
    page,
    runId: `env-detail-e2e-${Date.now()}`,
    environmentId: '',
  }
  return world.envDetailWorkflow
}

async function createTestEnvironment(workflow: EnvDetailWorkflow, overrides?: Record<string, unknown>) {
  const environment = await apiJson<EnvironmentRecord>(workflow.page.request, '/api/v1/environments', {
    method: 'POST',
    data: {
      name: `${workflow.runId} environment`,
      description: 'Environment detail UI e2e test environment',
      packages: [
        { name: 'tsx', version: 'latest' },
        { name: 'typescript', version: 'latest' },
      ],
      variables: { NODE_ENV: { description: 'node environment', required: false } },
      credentialRefs: [],
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
      runtimeConfig: { image: 'ama-pi-runtime' },
      metadata: { runId: workflow.runId },
      ...overrides,
    },
  })
  workflow.environmentId = environment.id
  return environment
}

// "an environment exists" is defined in product-api.steps.ts; we do NOT redefine it here.
// The env ID is available via this.e2e.environment.id when that step runs.

Given(
  'an environment has package requirements, variables, secret references, network policy, resource limits, runtime config, metadata, and versions',
  { timeout: 120_000 },
  async function (this: EnvDetailWorld) {
    const workflow = await ensureEnvDetailWorkflow(this)
    const env = await createTestEnvironment(workflow)
    // Update to create a second version
    await apiJson(workflow.page.request, `/api/v1/environments/${env.id}`, {
      method: 'PATCH',
      data: { description: 'Updated for version 2' },
    })
    workflow.environmentId = env.id
  },
)

Given('an environment is active', { timeout: 120_000 }, async function (this: EnvDetailWorld) {
  const workflow = await ensureEnvDetailWorkflow(this)
  if (!workflow.environmentId) {
    await createTestEnvironment(workflow)
  }
  // Navigate to the environment detail page so archive steps can find the action buttons
  await workflow.page.goto(`/environments/${workflow.environmentId}`)
  await expect(workflow.page.getByText('Environment profile')).toBeVisible()
  // Expose active resource context for the shared archive step in destructive-ops-ui.steps.ts
  this.activeResourcePage = workflow.page
  this.activeResourceType = 'environment'
  this.activeResourceId = workflow.environmentId
  this.activeResourceName = `${workflow.runId} environment`
})

When('the user opens the environment detail page', async function (this: EnvDetailWorld) {
  // Support both workflow sources: our own envDetailWorkflow and the product-api world e2e
  const detailWorkflow = this.envDetailWorkflow
  const envId = detailWorkflow?.environmentId || this.e2e?.environment?.id
  assert.ok(envId, 'Environment must be created before opening detail page')

  let page: Page
  if (detailWorkflow?.page) {
    page = detailWorkflow.page
  } else if (this.e2e?.page) {
    page = this.e2e.page
    // Also set up the envDetailWorkflow so later Then steps can use it
    const runId = this.e2e.runId ?? `env-detail-e2e-${Date.now()}`
    this.envDetailWorkflow = { page, runId, environmentId: envId }
  } else {
    const newPage = await openLocalPage()
    await authenticateE2EPage(newPage)
    const runId = `env-detail-e2e-${Date.now()}`
    this.envDetailWorkflow = { page: newPage, runId, environmentId: envId }
    page = newPage
  }

  await page.goto(`/environments/${envId}`)
  await expect(page.getByText('Environment profile')).toBeVisible()
})

Then(
  'packages, variables, network policy, versions, and sessions that selected the environment are visible',
  async function (this: EnvDetailWorld) {
    const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
    await expect(page.getByText('Environment profile')).toBeVisible()
    await expect(page.getByText('Packages').first()).toBeVisible()
    await expect(page.getByText('Variables').first()).toBeVisible()
    await expect(page.getByText('Network policy').first()).toBeVisible()
    await expect(page.getByText('Sessions using this environment').first()).toBeVisible()
  },
)

Then(
  'the header shows name, status, current version, runtime config, and timestamps',
  async function (this: EnvDetailWorld) {
    const workflow = this.envDetailWorkflow as EnvDetailWorkflow
    const page = workflow.page
    await expect(page.getByText(new RegExp(workflow.runId))).toBeVisible()
    await expect(page.getByText('active').first()).toBeVisible()
    await expect(page.getByText(/v\d+/).first()).toBeVisible()
    await expect(page.getByText('Runtime config')).toBeVisible()
  },
)

Then('package requirements are grouped by ecosystem', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  await expect(page.getByText(/tsx/)).toBeVisible()
})

Then('variables and secret references are displayed without raw secret values', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  await expect(page.getByText('Variables')).toBeVisible()
  await expect(page.getByText('Credential refs')).toBeVisible()
  await expect(page.getByText('secret-value')).toHaveCount(0)
})

Then('network policy clearly distinguishes unrestricted and limited access', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  await expect(page.getByText('Network policy')).toBeVisible()
  await expect(page.getByText(/[Rr]estricted/)).toBeVisible()
})

Then('related sessions show historical runs that selected the environment', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  await expect(page.getByText('Sessions using this environment')).toBeVisible()
})

Then('the environment status becomes archived', async function (this: EnvDetailWorld) {
  const workflow = this.envDetailWorkflow as EnvDetailWorkflow
  const page = workflow.page
  await expect(page.getByText('archived').first()).toBeVisible({ timeout: 10_000 })
})

Then('new session flows cannot select it', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  // Archive button no longer shown for already-archived environment
  await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0)
})

// Note: "existing sessions remain readable" is already defined in product-api.steps.ts.
// For the environment-detail archive scenario we use a distinct step that checks the
// browser UI rather than duplicating the API-based step.
Then('archived environment sessions remain visible in the browser', async function (this: EnvDetailWorld) {
  const page = (this.envDetailWorkflow as EnvDetailWorkflow).page
  await expect(page.getByText('Sessions using this environment')).toBeVisible()
})
