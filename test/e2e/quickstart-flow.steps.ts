import assert from 'node:assert/strict'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, delay, openLocalPage, waitForSession } from './local-app'
import type { AmaWorld } from './world'

type Json = Record<string, unknown>

interface QuickstartFlowState {
  page: Page
  auth: { project?: { name?: string } }
  runId: string
  agentId: string
  environmentId: string
  sessionId: string
  sentPrompt: string
  sessionStepLockedBeforeEnvironment: boolean
  createdEnvironment: Json | null
  exampleText: string
}

type QuickstartWorld = AmaWorld & { quickstart?: QuickstartFlowState }

// The full journey crosses session startup and runtime turns; keep one
// generous budget instead of per-step tuning.
const STEP_TIMEOUT = { timeout: 120_000 }
const SAFE_PROMPT_PATTERN = /Stay read-only and do not modify the workspace/

async function ensureQuickstartFlow(world: QuickstartWorld) {
  if (world.quickstart) return world.quickstart
  const page = await openLocalPage()
  const auth = await authenticateE2EPage(page)
  world.quickstart = {
    page,
    auth,
    runId: `qs-flow-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    agentId: '',
    environmentId: '',
    sessionId: '',
    sentPrompt: '',
    sessionStepLockedBeforeEnvironment: false,
    createdEnvironment: null,
    exampleText: '',
  }
  return world.quickstart
}

function requireQuickstartFlow(world: QuickstartWorld) {
  assert.ok(world.quickstart, 'quickstart flow state must be initialized by a Given step')
  return world.quickstart
}

async function createFlowAgent(state: QuickstartFlowState, data: Json = {}) {
  const agent = await apiJson<Json>(state.page.request, '/api/v1/agents', {
    method: 'POST',
    data: {
      name: `${state.runId} agent`,
      instructions: 'Respond concisely through the local deterministic runtime.',
      model: '@cf/moonshotai/kimi-k2.6',
      ...data,
    },
  })
  state.agentId = String(agent.id)
  return agent
}

async function createFlowEnvironment(state: QuickstartFlowState, data: Json = {}) {
  const environment = await apiJson<Json>(state.page.request, '/api/v1/environments', {
    method: 'POST',
    data: {
      name: `${state.runId} environment`,
      hostingMode: 'cloud',
      networkPolicy: { mode: 'unrestricted' },
      runtimeConfig: { image: 'ama-pi-runtime' },
      ...data,
    },
  })
  state.environmentId = String(environment.id)
  return environment
}

async function waitForPersistedEventText(state: QuickstartFlowState, sessionId: string, pattern: RegExp) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = await apiJson<{ data: Json[] }>(state.page.request, `/api/v1/sessions/${sessionId}/events?limit=200`)
    if (pattern.test(JSON.stringify(events.data))) {
      return events.data
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} never persisted an event matching ${pattern}`)
}

async function createSessionThroughQuickstart(state: QuickstartFlowState) {
  const page = state.page
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/sessions') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: /Create (new )?test session/ }).click()
  const session = (await (await sessionResponse).json()) as Json
  state.sessionId = String(session.id)
  await expect(page).toHaveURL(new RegExp(`session=${state.sessionId}`), { timeout: 15_000 })
  return session
}

async function sendQuickstartPrompt(state: QuickstartFlowState, prompt?: string) {
  const page = state.page
  const composer = page.getByLabel('First task')
  await expect(composer).toBeVisible({ timeout: 30_000 })
  if (prompt !== undefined) {
    await composer.fill(prompt)
  }
  state.sentPrompt = await composer.inputValue()
  assert.ok(state.sentPrompt.trim(), 'composer must contain a prompt before sending')
  const send = page.getByRole('button', { name: 'Send first task' })
  // Sending goes through the live runtime WebSocket, which only opens once the
  // session reports its runtime endpoint.
  await expect(send).toBeEnabled({ timeout: 60_000 })
  await send.click()
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  assert.ok(overflow <= 1, `Quickstart must not scroll horizontally at this viewport (overflow ${overflow}px)`)
}

// ─── Scenario: Complete the first-run flow ───

Given('the developer has deployed the platform on Cloudflare', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  const health = await apiJson<Json>(state.page.request, '/api/v1/health')
  assert.equal(health.status, 'ok', 'the deployed control plane must report healthy')
})

When('the developer opens the console for the first time', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  await state.page.goto('/')
  await expect(state.page).toHaveURL(/\/quickstart/, { timeout: 30_000 })
})

Then(
  'the platform guides them to create a project, select a provider, create an environment, create an agent, and create a session',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const page = state.page

    // Project: tenancy bootstrap created the default project and the shell shows it.
    assert.ok(state.auth.project?.name, 'first sign-in must resolve a project')
    await expect(page.getByText(state.auth.project.name as string).first()).toBeVisible()

    // The guided stepper shows all five steps in order.
    for (const label of ['1. Provider', '2. Environment', '3. Agent', '4. Session', '5. Integration']) {
      await expect(page.getByText(label)).toBeVisible()
    }

    // Provider: revisit the completed step and confirm the seeded default.
    await page.getByRole('link', { name: '1. Provider' }).click()
    await expect(page.getByText('Workers AI', { exact: true })).toBeVisible()
    await expect(page.getByText('No credential required')).toBeVisible()

    // Environment: the guided form creates the reusable sandbox template.
    await page.getByRole('link', { name: '2. Environment' }).click()
    await page.getByLabel('Environment name').fill(`${state.runId} flow environment`)
    const environmentResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/environments') && response.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Create environment' }).click()
    assert.equal((await environmentResponse).status(), 201)
    await expect(page).toHaveURL(/step=agent/, { timeout: 15_000 })

    // Agent: template-based creation.
    await page.getByRole('button', { name: 'Use template' }).first().click()
    await page.getByLabel('Name', { exact: true }).fill(`${state.runId} flow agent`)
    const agentResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/agents') && response.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Create agent' }).click()
    assert.equal((await agentResponse).status(), 201)
    await expect(page).toHaveURL(/step=session/, { timeout: 15_000 })

    // Session: the first runtime session is created from the same flow.
    await createSessionThroughQuickstart(state)
    await expect(page.getByText(/\/runtime\/sessions\//).first()).toBeVisible({ timeout: 30_000 })

    // Every step now reports real completion.
    await expect(page.getByText('complete', { exact: true })).toHaveCount(5, { timeout: 15_000 })

    // The guided flow stays usable on a 390px viewport without horizontal scroll.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByText('1. Provider')).toBeVisible()
    await assertNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1440, height: 900 })
  },
)

// ─── Scenario: Create an agent from a template or description ───

Given('the developer is on the agent step', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  await createFlowEnvironment(state)
  await state.page.goto('/quickstart?step=agent')
  await expect(state.page.getByLabel('Agent goal', { exact: true })).toBeVisible({ timeout: 30_000 })
})

When(
  'the developer chooses a template or describes the agent goal',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await expect(state.page.getByRole('button', { name: 'Use template' }).first()).toBeVisible()
    await state.page
      .getByLabel('Agent goal', { exact: true })
      .fill('Review incoming pull requests and summarize risky changes for maintainers')
    await state.page.getByRole('button', { name: 'Draft agent configuration' }).click()
  },
)

Then(
  'the platform drafts agent name, instructions, model, tools, and MCP connectors',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const page = requireQuickstartFlow(this).page
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(/Review incoming pull requests/)
    await expect(page.getByLabel('Instructions', { exact: true })).toHaveValue(/summarize risky changes/)
    // Model is selected from the provider catalog (a shadcn Select combobox), so
    // the drafted model is read from the trigger's displayed value, not an input.
    await expect(page.getByLabel('Model', { exact: true })).toContainText(/.+/)
    await expect(page.getByLabel('Allowed tools', { exact: true })).toHaveValue('read\nwrite\nshell')
    await expect(page.getByText('MCP connectors', { exact: true })).toBeVisible()
    await expect(page.getByText('None drafted', { exact: true })).toBeVisible()
  },
)

Then(
  'the developer can inspect and edit the draft before creating the agent',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const editedName = `${state.runId} drafted agent`
    await state.page.getByLabel('Name', { exact: true }).fill(editedName)
    await expect(state.page.getByLabel('Name', { exact: true })).toHaveValue(editedName)
    const agents = await apiJson<{ data: Json[] }>(state.page.request, '/api/v1/agents?limit=100')
    assert.ok(
      !agents.data.some((agent) => agent.name === editedName),
      'nothing is saved until the developer creates the agent',
    )
  },
)

Then(
  'creating the agent shows the resulting agent id and version',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const page = state.page
    const agentResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/agents') && response.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Create agent' }).click()
    const response = await agentResponse
    assert.equal(response.status(), 201)
    const agent = (await response.json()) as Json
    state.agentId = String(agent.id)
    await expect(page).toHaveURL(/step=session/, { timeout: 15_000 })
    await expect(page.getByText(new RegExp(`${agent.id}`)).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(new RegExp(`v${agent.version}`)).first()).toBeVisible()
  },
)

// ─── Scenario: Configure the execution environment in quickstart ───

Given('an agent was created in quickstart', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  await createFlowAgent(state, { name: `${state.runId} quickstart agent` })
  await state.page.goto('/quickstart')
  // With an agent but no environment, the stepper lands on the environment step.
  await expect(state.page.getByLabel('Environment name')).toBeVisible({ timeout: 30_000 })
})

When(
  'the developer chooses unrestricted networking, limited networking, or a custom environment',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const page = state.page

    // The session step is locked until the environment step completes.
    state.sessionStepLockedBeforeEnvironment = (await page.getByRole('link', { name: '4. Session' }).count()) === 0
    await expect(page.getByText('4. Session')).toBeVisible()

    // Unrestricted and limited networking are both offered; pick limited.
    await page.getByLabel('Networking', { exact: true }).click()
    await expect(page.getByRole('option', { name: 'Unrestricted networking' })).toBeVisible()
    await page.getByRole('option', { name: 'Limited networking' }).click()

    await page.getByLabel('Environment name').fill(`${state.runId} limited environment`)
    await page.getByLabel('Allowed hosts', { exact: true }).fill('registry.npmjs.org\napi.github.com')
    await page.getByRole('checkbox', { name: 'Allow MCP connector access' }).click()

    const environmentResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/environments') && response.request().method() === 'POST',
      { timeout: 30_000 },
    )
    await page.getByRole('button', { name: 'Create environment' }).click()
    const response = await environmentResponse
    assert.equal(response.status(), 201)
    state.createdEnvironment = (await response.json()) as Json
    state.environmentId = String(state.createdEnvironment.id)
  },
)

Then('the platform creates or selects an environment', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  assert.ok(state.createdEnvironment, 'the environment step created an environment')
  await expect(state.page).toHaveURL(/step=agent/, { timeout: 15_000 })
  // Revisiting the completed step now also offers selecting the environment as
  // a custom choice instead of creating another one.
  await state.page.getByRole('link', { name: '2. Environment' }).click()
  await expect(state.page.getByLabel('Custom environment', { exact: true })).toBeVisible()
})

Then(
  'the environment step explains that environments are reusable sandbox templates',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const page = requireQuickstartFlow(this).page
    await expect(page.getByText('Environments are reusable sandbox templates, not running containers.')).toBeVisible()
  },
)

Then(
  'limited networking captures allowed hosts, MCP access, and package-manager access',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const environment = await apiJson<Json>(state.page.request, `/api/v1/environments/${state.environmentId}`)
    assert.deepEqual(environment.networkPolicy, {
      mode: 'restricted',
      allowedHosts: ['registry.npmjs.org', 'api.github.com'],
    })
    assert.deepEqual(environment.mcpPolicy, { blockedConnectors: ['*'] })
    assert.deepEqual(environment.packageManagerPolicy, { allowedRegistries: ['registry.npmjs.org'] })
  },
)

Then(
  'the environment step must be completed before creating a session',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    assert.ok(
      state.sessionStepLockedBeforeEnvironment,
      'the session step must be locked while the environment step is incomplete',
    )
    // After completing the environment step the session step unlocks.
    await expect(state.page.getByRole('link', { name: '4. Session' })).toBeVisible()
  },
)

// ─── Scenario: Create a session and send the first task ───

Given('quickstart has an active agent and environment', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  await createFlowAgent(state)
  await createFlowEnvironment(state)
  await state.page.goto('/quickstart')
  await expect(state.page.getByRole('button', { name: 'Create test session' })).toBeVisible({ timeout: 30_000 })
})

When(
  'the developer creates a test session with the agent and environment',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const session = await createSessionThroughQuickstart(state)
    assert.equal(session.agentId, state.agentId)
    assert.equal(session.environmentId, state.environmentId)
  },
)

Then(
  'the platform creates a session and shows its runtime endpoint',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await expect(state.page.getByText(state.sessionId, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(state.page.getByText(new RegExp(`/api/v1/runtime/sessions/${state.sessionId}`))).toBeVisible({
      timeout: 30_000,
    })
  },
)

Then('the preview shows transcript and debug modes', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const page = requireQuickstartFlow(this).page
  await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Debug' })).toBeVisible()
})

Then(
  'the message composer is focused with a safe example prompt',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const page = requireQuickstartFlow(this).page
    const composer = page.getByLabel('First task')
    await expect(composer).toBeFocused()
    await expect(composer).toHaveValue(SAFE_PROMPT_PATTERN)
  },
)

When('the developer sends the prompt', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  // Mark the document so a full page reload would be detectable afterwards.
  await state.page.evaluate(() => {
    ;(window as unknown as { __amaQuickstartLiveDocument?: boolean }).__amaQuickstartLiveDocument = true
  })
  await sendQuickstartPrompt(state)
})

Then('the message is accepted by the selected session runtime', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  const escaped = state.sentPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await waitForPersistedEventText(state, state.sessionId, new RegExp(`AMA runtime processed: ${escaped}`))
})

Then(
  'session events stream into the preview without a page reload',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await expect(state.page.getByText(`AMA runtime processed: ${state.sentPrompt}`).first()).toBeVisible({
      timeout: 60_000,
    })
    const stillLiveDocument = await state.page.evaluate(
      () => (window as unknown as { __amaQuickstartLiveDocument?: boolean }).__amaQuickstartLiveDocument === true,
    )
    assert.ok(stillLiveDocument, 'the preview must update without reloading the page')
  },
)

Then(
  'final success or failure remains inspectable in the session detail page',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await state.page.getByRole('link', { name: 'Open session detail' }).click()
    await expect(state.page).toHaveURL(new RegExp(`/sessions/${state.sessionId}`), { timeout: 30_000 })
    await expect(state.page.getByRole('tab', { name: 'Transcript' })).toBeVisible({ timeout: 30_000 })
    await expect(state.page.getByText(`AMA runtime processed: ${state.sentPrompt}`).first()).toBeVisible({
      timeout: 60_000,
    })
  },
)

// ─── Scenario: Run the default Workers AI agent ───

Given('Workers AI is available', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  const providers = await apiJson<{ data: Json[] }>(state.page.request, '/api/v1/providers')
  const workersAi = providers.data.find((provider) => provider.type === 'workers-ai')
  assert.ok(workersAi, 'the workers-ai provider must be seeded')
  assert.equal(workersAi.enabled, true)
})

When('the developer creates an agent with the default model', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  const page = state.page
  await page.goto('/quickstart?step=provider')
  await expect(page.getByText('No credential required')).toBeVisible({ timeout: 30_000 })
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/sessions') &&
      response.request().method() === 'POST' &&
      response.status() === 201,
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: 'Run the default Workers AI agent' }).click()
  const session = (await (await sessionResponse).json()) as Json
  state.sessionId = String(session.id)
  state.agentId = String(session.agentId)
})

Then(
  'the agent can respond through a session runtime in Cloudflare Sandbox',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await expect(state.page).toHaveURL(new RegExp(`step=session&session=${state.sessionId}`), { timeout: 15_000 })
    await waitForPersistedEventText(state, state.sessionId, /AMA runtime processed: /)
    await expect(state.page.getByText(/AMA runtime processed: /).first()).toBeVisible({ timeout: 60_000 })
    const session = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.sessionId}`)
    const runtimeMetadata = session.runtimeMetadata as Json
    assert.equal(runtimeMetadata.hostingMode, 'cloud', 'the starter session runs in the cloud sandbox hosting mode')
    assert.equal(runtimeMetadata.provider, 'workers-ai')
    const agentSnapshot = session.agentSnapshot as Json
    assert.equal(agentSnapshot.model, '@cf/moonshotai/kimi-k2.6')
  },
)

Then('no Anthropic credential is required', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  const providers = await apiJson<{ data: Json[] }>(state.page.request, '/api/v1/providers')
  const workersAi = providers.data.find((provider) => provider.type === 'workers-ai')
  assert.ok(workersAi, 'the workers-ai provider must exist')
  assert.equal(workersAi.credentialStatus, 'not_required')
  assert.ok(
    !providers.data.some((provider) => provider.type === 'anthropic'),
    'the default path must not require configuring an Anthropic provider',
  )
})

// ─── Scenario: Add sandbox execution ───

Given('Cloudflare Sandbox is configured', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  await createFlowAgent(state, { name: `${state.runId} sandbox agent`, tools: [{ name: 'read' }] })
  await createFlowEnvironment(state, { name: `${state.runId} sandbox environment` })
  await state.page.goto('/quickstart?step=session')
  await expect(state.page.getByRole('button', { name: 'Add sandbox execution' })).toBeVisible({ timeout: 30_000 })
})

When('the developer enables sandbox access for the agent', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  const page = state.page
  const agentResponse = page.waitForResponse(
    (response) => response.url().endsWith(`/api/v1/agents/${state.agentId}`) && response.request().method() === 'PATCH',
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: 'Add sandbox execution' }).click()
  const response = await agentResponse
  assert.equal(response.status(), 200)
  const agent = (await response.json()) as Json
  const toolNames = (agent.tools as Array<{ name: string }>).map((tool) => tool.name)
  assert.deepEqual(toolNames, ['read', 'sandbox.exec', 'sandbox.read', 'sandbox.write'])
  assert.deepEqual(agent.skills, ['ama@coding-agent'])
  await expect(page.getByRole('button', { name: 'Sandbox execution enabled' })).toBeVisible({ timeout: 15_000 })
})

Then(
  'the agent can run an approved command in an isolated sandbox',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await createSessionThroughQuickstart(state)
    await sendQuickstartPrompt(state, 'Run an approved sandbox tool call to check the workspace.')
    const events = await waitForPersistedEventText(state, state.sessionId, /sandbox\.exec/)
    const eventsText = JSON.stringify(events)
    assert.ok(eventsText.includes('git status'), 'the approved command ran through the sandbox executor')
    const session = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.sessionId}`)
    const snapshotToolNames = ((session.agentSnapshot as Json).tools as Array<{ name: string }>).map(
      (tool) => tool.name,
    )
    assert.ok(snapshotToolNames.includes('sandbox.exec'), 'the session snapshot carries the sandbox tool policy')
  },
)

Then('command output is visible in the session debug view', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  const page = state.page
  await page.getByRole('tab', { name: 'Debug' }).click()
  await expect(page.getByText(/"command": "git status"/).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/"output"/).first()).toBeVisible()
})

// ─── Scenario: Show integration options after a successful session ───

Given('quickstart has created a session', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = await ensureQuickstartFlow(this)
  await createFlowAgent(state)
  await createFlowEnvironment(state)
  const session = await apiJson<Json>(state.page.request, '/api/v1/sessions', {
    method: 'POST',
    data: {
      agentId: state.agentId,
      environmentId: state.environmentId,
      runtime: 'ama',
      title: `${state.runId} integration session`,
    },
  })
  state.sessionId = String(session.id)
  await waitForSession(state.page.request, state.sessionId)
})

When('the developer opens the integration step', STEP_TIMEOUT, async function (this: QuickstartWorld) {
  const state = requireQuickstartFlow(this)
  await state.page.goto(`/quickstart?step=integration&session=${state.sessionId}`)
  await expect(state.page.getByRole('link', { name: '5. Integration' })).toHaveAttribute('aria-current', 'step')
  const blocks = state.page.locator('pre')
  await expect(blocks.first()).toBeVisible({ timeout: 30_000 })
  state.exampleText = (await blocks.allInnerTexts()).join('\n')
})

Then(
  'examples are available for curl, restish, and generated SDKs',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    await expect(state.page.getByText('curl', { exact: true })).toBeVisible()
    await expect(state.page.getByText('restish', { exact: true })).toBeVisible()
    await expect(state.page.getByText('TypeScript SDK', { exact: true })).toBeVisible()
    assert.ok(state.exampleText.includes('curl -X POST'), 'curl example present')
    assert.ok(state.exampleText.includes('restish get'), 'restish example present')
    assert.ok(state.exampleText.includes('AmaClient'), 'generated SDK example present')
  },
)

Then(
  'examples use the current platform origin and \\/api OpenAPI contract',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    const origin = new URL(state.page.url()).origin
    assert.ok(state.exampleText.includes(`${origin}/api/v1/sessions`), 'examples target this platform origin')
    assert.ok(state.exampleText.includes(`${origin}/api/v1/openapi.json`), 'examples reference the OpenAPI contract')
    assert.ok(state.exampleText.includes(state.sessionId), 'examples reference the created session id')
    assert.ok(state.exampleText.includes(state.agentId), 'examples reference the created agent id')
  },
)

Then(
  'examples use AMA session endpoints for live session traffic',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    // The session's runtime connection is an AMA-owned path (proxy mount), never
    // an upstream vendor URL — this is what "live session traffic" reconnects to.
    const connection = await apiJson<Json>(state.page.request, `/api/v1/sessions/${state.sessionId}/connection`)
    const runtimeEndpointPath = String(connection.path)
    assert.ok(runtimeEndpointPath.startsWith('/api/v1/'), 'the session exposes an AMA runtime endpoint path')
    // Live session traffic in the integration examples flows through the AMA
    // session endpoints (create + stream events), not any upstream vendor host.
    assert.ok(
      state.exampleText.includes(`/api/v1/sessions/${state.sessionId}/events`),
      'live traffic examples use the AMA session events endpoint',
    )
    assert.ok(state.exampleText.includes('/api/v1/sessions'), 'examples drive sessions through AMA session endpoints')
  },
)

Then(
  'examples do not include raw secrets or upstream vendor API URLs',
  STEP_TIMEOUT,
  async function (this: QuickstartWorld) {
    const state = requireQuickstartFlow(this)
    assert.ok(state.exampleText.includes('$AMA_ACCESS_TOKEN'), 'examples use a token placeholder')
    const accessToken = await state.page.evaluate(() => window.localStorage.getItem('ama:e2e-access-token'))
    assert.ok(accessToken, 'the authenticated page holds a real access token to compare against')
    assert.ok(!state.exampleText.includes(accessToken as string), 'examples never embed the live page token')
    const bodyText = await state.page.evaluate(() => document.body.innerText)
    assert.ok(!bodyText.includes(accessToken as string), 'the page never renders the live access token')
    assert.ok(
      !/\b(?:api\.)?(?:openai|anthropic)\.com\b/.test(state.exampleText),
      'examples never target upstream vendor API hosts',
    )
  },
)
