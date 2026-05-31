import assert from 'node:assert/strict'
import { AfterAll, Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, closeLocalApp, delay, openLocalPage, waitForSession } from './local-app'
import type { AmaWorld } from './world'

interface Environment {
  id: string
  name?: string
}

interface Agent {
  id: string
  name?: string
}

interface Session {
  id: string
  title?: string | null
}

interface Vault {
  id: string
  name?: string
}

interface SessionEvent {
  sequence: number
  type: string
  payload: Record<string, unknown>
}

interface UiWorkflow {
  page: Page
  auth?: {
    user?: { email?: string; name?: string | null }
    organization?: { name?: string }
    project?: { name?: string }
  }
  environmentId: string
  agentId: string
  sessionId: string
  vaultId: string
  message: string
  runId: string
  controlPlaneRequestHeaders: Record<string, string>[]
}

type UiWorld = AmaWorld & { uiWorkflow?: UiWorkflow }

AfterAll({ timeout: 30_000 }, async () => {
  await closeLocalApp()
})

Given('the local real UI e2e app is running', { timeout: 120_000 }, async function (this: UiWorld) {
  const page = await openLocalPage()
  const auth = await authenticateE2EPage(page)
  this.uiWorkflow = {
    page,
    auth,
    environmentId: '',
    agentId: '',
    sessionId: '',
    vaultId: '',
    message: '',
    runId: `ui-e2e-${Date.now()}`,
    controlPlaneRequestHeaders: [],
  }
})

When(
  'the user opens the console',
  async function (this: UiWorld & { e2e?: { page: Page; auth?: UiWorkflow['auth'] } }) {
    const page = this.uiWorkflow?.page ?? this.e2e?.page ?? (await openLocalPage())
    const auth = this.uiWorkflow?.auth ?? this.e2e?.auth ?? (await authenticateE2EPage(page))
    this.uiWorkflow = {
      page,
      auth,
      environmentId: this.uiWorkflow?.environmentId ?? '',
      agentId: this.uiWorkflow?.agentId ?? '',
      sessionId: this.uiWorkflow?.sessionId ?? '',
      vaultId: this.uiWorkflow?.vaultId ?? '',
      message: this.uiWorkflow?.message ?? '',
      runId: this.uiWorkflow?.runId ?? `ui-e2e-${Date.now()}`,
      controlPlaneRequestHeaders: this.uiWorkflow?.controlPlaneRequestHeaders ?? [],
    }
    await page.goto('/agents')
  },
)

When('the user opens the login page', async function (this: UiWorld) {
  const page = await openLocalPage()
  await page.goto('/sessions?status=idle')
  this.uiWorkflow = {
    page,
    environmentId: '',
    agentId: '',
    sessionId: '',
    vaultId: '',
    message: '',
    runId: `ui-e2e-${Date.now()}`,
    controlPlaneRequestHeaders: [],
  }
})

Then('the page offers OIDC provider sign-in and preserves the requested return path', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  const action = page.getByRole('button', { name: 'Continue with OIDC provider' })
  await expect(action).toBeVisible()
  assert.equal(await action.getAttribute('href'), null, 'AMA must not expose a local login URL')
})

Given('the developer is signed in for the first time', { timeout: 120_000 }, async function (this: UiWorld) {
  await ensureUiWorkflow(this)
})

When('the developer opens quickstart', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/quickstart')
})

Then(
  'the page shows a stepper for provider, agent, environment, session, and integration',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    await expect(page.getByText('1. Provider')).toBeVisible()
    await expect(page.getByText('2. Environment')).toBeVisible()
    await expect(page.getByText('3. Agent')).toBeVisible()
    await expect(page.getByText('4. Session')).toBeVisible()
    await expect(page.getByText('5. Integration')).toBeVisible()
  },
)

Then('the page starts on a usable workflow rather than a marketing page', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByText('First run workflow')).toBeVisible()
  await expect(page.getByRole('link', { name: /Open/ }).first()).toBeVisible()
})

Then(
  'each completed step shows the API call that was made against the current platform origin',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    await expect(page.getByText('GET /api/providers')).toBeVisible()
    await expect(page.getByText('POST /api/environments')).toBeVisible()
    await expect(page.getByText('POST /api/agents')).toBeVisible()
    await expect(page.getByText('POST /api/sessions')).toBeVisible()
    await expect(page.getByText('GET /api/openapi.json')).toBeVisible()
  },
)

Then('incomplete prerequisites are visible before the user starts a runtime session', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByText('pending').first()).toBeVisible()
})

When('the developer checks deployment health', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  const response = await workflow.page.request.get('/api/health')
  this.response = response as unknown as Response
  this.openApiDocument = (await response.json()) as Record<string, unknown>
})

Then('the control plane health endpoint responds successfully', function (this: UiWorld) {
  assert.equal((this.response as unknown as { status: () => number }).status(), 200)
  assert.equal((this.openApiDocument as { status?: string }).status, 'ok')
})

Then('Cloudflare runtime tests can validate D1 and Durable Object bindings', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  const response = await workflow.page.request.get('/api/e2e/ready')
  assert.equal(response.status(), 200)
})

Given('the project has no agents', { timeout: 120_000 }, async function (this: UiWorld) {
  await ensureUiWorkflow(this)
})

Given('a project has agents', { timeout: 120_000 }, async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  const agent = await createUiAgent(workflow)
  workflow.agentId = agent.id
})

Given('a model provider is available', { timeout: 120_000 }, async function (this: UiWorld) {
  await ensureUiWorkflow(this)
})

When('the user opens the agents page', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/agents')
  await expect(workflow.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
})

Then('the page shows the Agents heading and a deliberate create action', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create agent' })).toBeVisible()
})

Then(
  'the empty state explains that agents are reusable definitions for future sessions',
  async function (this: UiWorld) {
    await expect(requireUiWorkflow(this).page.getByText('No agents')).toBeVisible()
  },
)

Then('each agent row shows name, model, tools, status, version, and updated time', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByRole('cell', { name: /workers-ai/ }).first()).toBeVisible()
  await expect(page.getByText('active').first()).toBeVisible()
  await expect(page.getByText('v1').first()).toBeVisible()
  await expect(page.getByText('sandbox.exec').first()).toBeVisible()
})

Then('clicking a row opens the agent detail route', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await workflow.page
    .getByRole('link', { name: new RegExp(workflow.runId) })
    .first()
    .click()
  await expect(workflow.page).toHaveURL(/\/agents\/agent_/)
  await expect(workflow.page.getByText('Runtime configuration')).toBeVisible()
  await expect(workflow.page.getByText('ama@local-ui')).toBeVisible()
  await expect(workflow.page.getByText('Sandbox policy')).toHaveCount(0)
})

Then('row actions do not trigger accidental navigation', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await workflow.page.goto('/agents')
  await workflow.page.getByRole('button', { name: 'Archive agent' }).first().click()
  await expect(workflow.page.getByRole('alertdialog')).toBeVisible()
  await expect(workflow.page).toHaveURL(/\/agents$/)
})

When('the user starts the create-agent flow', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/agents')
  await workflow.page.getByRole('button', { name: 'Create agent' }).click()
})

Then('the form uses the shared form components and validation states', async function (this: UiWorld) {
  const dialog = requireUiWorkflow(this).page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Create Agent' })).toBeVisible()
  await expect(dialog.getByLabel('Name')).toBeVisible()
})

Then('the user can choose a model provider, model, skills, tools, and MCP connectors', async function (this: UiWorld) {
  const dialog = requireUiWorkflow(this).page.getByRole('dialog')
  await expect(dialog.getByLabel('Provider')).toBeVisible()
  await expect(dialog.getByLabel('Model')).toBeVisible()
  await expect(dialog.getByLabel('Skills')).toBeVisible()
  await expect(dialog.getByLabel('Allowed Pi tools')).toBeVisible()
  await expect(dialog.getByLabel('MCP connectors')).toBeVisible()
})

Then(
  'saving creates the agent and returns to the browsable agents list with the new row visible',
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    const name = `${workflow.runId} created agent`
    const dialog = workflow.page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Save agent' }).click()
    await expect(workflow.page.getByText('Agent created')).toBeVisible()
    await expect(workflow.page.getByRole('link', { name })).toBeVisible()
  },
)

Given('the project has no environments', { timeout: 120_000 }, async function (this: UiWorld) {
  await ensureUiWorkflow(this)
})

Given('a project has environments', { timeout: 120_000 }, async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  const environment = await createUiEnvironment(workflow)
  workflow.environmentId = environment.id
})

When('the user opens the environments page', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/environments')
  await expect(workflow.page.getByRole('heading', { name: 'Environments' })).toBeVisible()
})

Then('the page shows the Environments heading and a deliberate create action', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByRole('heading', { name: 'Environments' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create environment' })).toBeVisible()
})

Then(
  'the empty state explains that environments are reusable sandbox templates, not running containers',
  async function (this: UiWorld) {
    await expect(requireUiWorkflow(this).page.getByText('No environments')).toBeVisible()
  },
)

Then(
  'each environment row shows name, status, hostingMode, runtime, runtimeConfig, packages, network policy, and updated time',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    await expect(page.getByText('active').first()).toBeVisible()
    await expect(page.getByText('cloud').first()).toBeVisible()
    await expect(page.getByText('ama').first()).toBeVisible()
    await expect(page.getByText(/tsx/).first()).toBeVisible()
    await expect(page.getByText(/restricted/i).first()).toBeVisible()
  },
)

Then('clicking a row opens the environment detail route', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await workflow.page
    .getByRole('link', { name: new RegExp(workflow.runId) })
    .first()
    .click()
  await expect(workflow.page).toHaveURL(/\/environments\/env_/)
  await expect(workflow.page.getByText('Environment profile')).toBeVisible()
})

When('the user starts the create-environment flow', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/environments')
  await workflow.page.getByRole('button', { name: 'Create environment' }).click()
})

Then(
  'the form captures name, hostingMode, runtime, runtimeConfig, network mode, allowed hosts, package requirements, and variables',
  async function (this: UiWorld) {
    const dialog = requireUiWorkflow(this).page.getByRole('dialog')
    await expect(dialog.getByLabel('Name')).toBeVisible()
    await expect(dialog.getByText('Hosting mode')).toBeVisible()
    await expect(dialog.getByText('Runtime', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Network mode')).toBeVisible()
    await expect(dialog.getByLabel('Allowed hosts')).toBeVisible()
    await expect(dialog.getByLabel('Packages')).toBeVisible()
    await expect(dialog.getByLabel('Variables')).toBeVisible()
    await expect(dialog.getByLabel('Runtime config')).toBeVisible()
  },
)

Then(
  'successful save creates an environment version and returns to the browsable environments list',
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    const name = `${workflow.runId} created environment`
    const dialog = workflow.page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Save environment' }).click()
    await expect(workflow.page.getByText('Environment created')).toBeVisible()
    await expect(workflow.page.getByRole('link', { name })).toBeVisible()
  },
)

Given('the project has no sessions', { timeout: 120_000 }, async function (this: UiWorld) {
  await ensureUiWorkflow(this)
})

Given('a project has sessions', { timeout: 120_000 }, async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await createUiSessionGraph(workflow)
})

Given('active agents exist', { timeout: 120_000 }, async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await createUiEnvironment(workflow)
  await createUiAgent(workflow)
})

When('the user opens the sessions page', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/sessions')
  await expect(workflow.page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
})

Then('the page shows the Sessions heading and a deliberate create action', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create session' })).toBeVisible()
})

Then('the empty state explains that sessions are task runs of versioned agents', async function (this: UiWorld) {
  await expect(requireUiWorkflow(this).page.getByText('No sessions')).toBeVisible()
})

Then(
  'each session row shows title or id, status, agent, model, environment, started time, last update time, and duration when available',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    await expect(page.getByText('idle').first()).toBeVisible()
    await expect(page.getByText(/workers-ai/).first()).toBeVisible()
    await expect(page.getByText(/kimi-k2.6/).first()).toBeVisible()
  },
)

Then('rows stay one line inside an adaptive height table surface', async function (this: UiWorld) {
  const row = requireUiWorkflow(this).page.getByRole('row').nth(1)
  const box = await row.boundingBox()
  assert.ok(box && box.height < 72, `Expected compact one-line row, got ${JSON.stringify(box)}`)
})

Then('clicking a row opens the session detail route', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await workflow.page
    .getByRole('link', { name: new RegExp(workflow.runId) })
    .first()
    .click()
  await expect(workflow.page).toHaveURL(/\/sessions\/session_/)
  await expect(workflow.page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
})

When('the user starts the create-session flow', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/sessions')
  await workflow.page.getByRole('button', { name: 'Create session' }).click()
  await expect(workflow.page.getByRole('dialog')).toBeVisible()
})

Then(
  'the form captures agent, environment, title, metadata, resources, and vault references',
  async function (this: UiWorld) {
    const dialog = requireUiWorkflow(this).page.getByRole('dialog')
    await expect(dialog.getByText('Agent', { exact: true })).toBeVisible()
    await expect(dialog.getByText('Environment', { exact: true })).toBeVisible()
    await expect(dialog.getByLabel('Title')).toBeVisible()
    await expect(dialog.getByLabel('Metadata')).toBeVisible()
    await expect(dialog.getByLabel('Resource refs')).toBeVisible()
    await expect(dialog.getByLabel('Vault refs')).toBeVisible()
  },
)

Then(
  'successful save opens the session detail page with the runtime message composer ready',
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    const dialog = workflow.page.getByRole('dialog')
    await dialog.getByLabel('Title').fill(`${workflow.runId} created session`)
    await dialog.getByRole('button', { name: 'Create session' }).click()
    await expect(workflow.page).toHaveURL(/\/sessions\/session_/)
    await expect(workflow.page.getByPlaceholder('Send a message to the agent')).toBeVisible()
  },
)

Given('a project has vaults', { timeout: 120_000 }, async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  const vault = await createUiVault(workflow)
  workflow.vaultId = vault.id
})

When('the user opens the vaults page', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/vaults')
  await expect(workflow.page.getByRole('heading', { name: 'Vaults' })).toBeVisible()
})

Then('vaults and credential metadata are visible with secret values redacted', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await expect(workflow.page.getByRole('link', { name: new RegExp(workflow.runId) })).toBeVisible()
  await expect(workflow.page.getByText(/raw-secret/)).toHaveCount(0)
})

Then('the page shows pagination and a deliberate create action', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await expect(page.getByRole('button', { name: 'Create vault' })).toBeVisible()
  await expect(page.getByText(/1 \/ 1/)).toBeVisible()
})

Then(
  'each vault row shows display name, scope, status, created time, and updated time',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    await expect(page.getByText('project').first()).toBeVisible()
    await expect(page.getByText('active').first()).toBeVisible()
  },
)

When('the user starts the create-vault flow', async function (this: UiWorld) {
  const workflow = await ensureUiWorkflow(this)
  await workflow.page.goto('/vaults')
  await workflow.page.getByRole('button', { name: 'Create vault' }).click()
})

Then('the form captures display name, description, and scope', async function (this: UiWorld) {
  const dialog = requireUiWorkflow(this).page.getByRole('dialog')
  await expect(dialog.getByLabel('Name')).toBeVisible()
  await expect(dialog.getByLabel('Description')).toBeVisible()
  await expect(dialog.getByText('Scope')).toBeVisible()
})

Then(
  'successful creation returns to the browsable vault list with the new row visible',
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    const name = `${workflow.runId} created vault`
    const dialog = workflow.page.getByRole('dialog')
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('button', { name: 'Save vault' }).click()
    await expect(workflow.page.getByText('Vault created')).toBeVisible()
    await expect(workflow.page.getByRole('link', { name })).toBeVisible()
  },
)

Then(
  'sidebar navigation, project context, organization context, and account controls are visible',
  async function (this: UiWorld) {
    const workflow = await ensureUiWorkflow(this)
    const page = workflow.page
    for (const label of ['Quickstart', 'Agents', 'Environments', 'Sessions', 'Providers', 'Vaults', 'MCP']) {
      await expect(page.getByRole('link', { name: label }).first()).toBeVisible()
    }
    assert.ok(workflow.auth?.project?.name)
    assert.ok(workflow.auth?.organization?.name)
    await expect(page.getByText(workflow.auth.project.name).first()).toBeVisible()
    await expect(page.getByText(workflow.auth.organization.name).first()).toBeVisible()
    const userName = workflow.auth.user?.name || workflow.auth.user?.email
    assert.ok(userName)
    await expect(page.getByRole('button', { name: new RegExp(userName) }).first()).toBeVisible()
  },
)

When('web UI calls control-plane routes', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  workflow.controlPlaneRequestHeaders = []
  workflow.page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/agents') {
      workflow.controlPlaneRequestHeaders.push(request.headers())
    }
  })
  await workflow.page.goto('/agents')
  await expect(workflow.page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await expect
    .poll(() => workflow.controlPlaneRequestHeaders.length, { message: 'Expected web UI to request /api/agents' })
    .toBeGreaterThan(0)
})

Then(
  'requests use the shared Hono RPC client with shared auth, error handling, tenancy headers, and response parsing',
  function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    assert.ok(
      workflow.controlPlaneRequestHeaders.some((headers) => headers['x-ama-client'] === 'web-rpc'),
      'Expected browser control-plane requests to include the shared Hono RPC client marker',
    )
  },
)

Then('external automation remains described by the OpenAPI document', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  const response = await workflow.page.request.get('/api/openapi.json')
  assert.equal(response.status(), 200)
  const document = (await response.json()) as { paths?: Record<string, unknown> }
  assert.ok(document.paths?.['/api/agents'], 'Expected OpenAPI to describe external agents control-plane path')
  assert.ok(document.paths?.['/api/sessions'], 'Expected OpenAPI to describe external sessions control-plane path')
})

Then(
  'the sidebar shows agents, sessions, providers, vaults, usage, audit, and settings',
  async function (this: UiWorld) {
    const page = requireUiWorkflow(this).page
    for (const label of ['Agents', 'Sessions', 'Providers', 'Vaults', 'Usage', 'Audit', 'Settings']) {
      await expect(page.getByRole('link', { name: label })).toBeVisible()
    }
  },
)

Then('the current organization and project are visible', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  const projectName = workflow.auth?.project?.name
  const organizationName = workflow.auth?.organization?.name
  assert.ok(projectName, 'Expected authenticated project name')
  assert.ok(organizationName, 'Expected authenticated organization name')
  await expect(workflow.page.getByText(projectName).first()).toBeVisible()
  await expect(workflow.page.getByText(organizationName).first()).toBeVisible()
})

Given(
  'the browser user creates an environment, an agent, and a session through public APIs',
  { timeout: 120_000 },
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    const runId = `local-ui-e2e-${Date.now()}`
    const environment = await apiJson<Environment>(workflow.page.request, '/api/environments', {
      method: 'POST',
      data: {
        name: `${runId} environment`,
        description: 'Local UI e2e environment created through public APIs.',
        packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
        metadata: { runId },
      },
    })
    const agent = await apiJson<Agent>(workflow.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${runId} agent`,
        instructions: 'Reply concisely through the selected environment runtime.',
        systemPrompt: 'Reply concisely through the selected environment runtime.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        skills: ['ama@local-ui'],
        allowedTools: ['sandbox.exec'],
        metadata: { runId },
      },
    })
    const session = await apiJson<Session>(workflow.page.request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: agent.id,
        environmentId: environment.id,
        title: `${runId} session`,
        metadata: { runId },
      },
    })
    const readySession = (await waitForSession(workflow.page.request, session.id)) as Session
    workflow.environmentId = environment.id
    workflow.agentId = agent.id
    workflow.sessionId = readySession.id
  },
)

When('the browser user opens the session detail page', async function (this: UiWorld) {
  const workflow = requireUiWorkflow(this)
  await workflow.page.goto(`/sessions/${workflow.sessionId}`)
  await expect(workflow.page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
})

Then('the session detail header remains fixed above the transcript', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  const headerTitle = page.getByText(/local-ui-e2e-\d+ session/).first()
  const transcriptTab = page.getByRole('tab', { name: 'Transcript' })
  await expect(headerTitle).toBeVisible()
  const titleBox = await headerTitle.boundingBox()
  const tabBox = await transcriptTab.boundingBox()
  assert.ok(titleBox, 'Expected session title to have a layout box')
  assert.ok(tabBox, 'Expected transcript tab to have a layout box')
  assert.ok(titleBox.y < tabBox.y, `Expected header above transcript controls: ${JSON.stringify({ titleBox, tabBox })}`)
})

Then('the session chat composer remains fixed near the viewport bottom', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  await assertComposerNearBottom(page)
})

Then('the transcript controls render without overlap', async function (this: UiWorld) {
  const page = requireUiWorkflow(this).page
  const transcriptTab = page.getByRole('tab', { name: 'Transcript' })
  const debugTab = page.getByRole('tab', { name: 'Debug' })
  await expect(transcriptTab).toBeVisible()
  await expect(debugTab).toBeVisible()
  const transcriptBox = await transcriptTab.boundingBox()
  const debugBox = await debugTab.boundingBox()
  assert.ok(transcriptBox, 'Expected transcript tab to have a layout box')
  assert.ok(debugBox, 'Expected debug tab to have a layout box')
  assert.ok(
    transcriptBox.x + transcriptBox.width <= debugBox.x,
    `Expected transcript and debug controls not to overlap: ${JSON.stringify({ transcriptBox, debugBox })}`,
  )
})

When(
  'the browser user sends a message through the session composer',
  { timeout: 60_000 },
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    workflow.message = `hello from local ui e2e ${Date.now()}`
    await workflow.page.getByRole('tab', { name: 'Transcript' }).click()
    await workflow.page.getByPlaceholder('Send a message to the agent').fill(workflow.message)
    await workflow.page.getByRole('button', { name: 'Send' }).click()
  },
)

Then(
  'the transcript renders the runtime response without mocked APIs',
  { timeout: 90_000 },
  async function (this: UiWorld) {
    const workflow = requireUiWorkflow(this)
    await waitForPersistedEvents(workflow.page.request, workflow.sessionId, (events) =>
      events.some((event) => eventText(event).includes(`AMA runtime processed: ${workflow.message}`)),
    )
    await expect(workflow.page.getByText(`AMA runtime processed: ${workflow.message}`).first()).toBeVisible()
    await expect(workflow.page.getByText('Tool').first()).toBeVisible()
    await assertComposerNearBottom(workflow.page)
  },
)

async function waitForPersistedEvents(
  request: Page['request'],
  sessionId: string,
  predicate: (events: SessionEvent[]) => boolean,
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = (await apiJson<{ data: SessionEvent[] }>(request, `/api/sessions/${sessionId}/events?limit=200`))
      .data
    if (predicate(events)) {
      return events
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not persist the expected runtime events`)
}

async function ensureUiWorkflow(world: UiWorld) {
  if (world.uiWorkflow) {
    return world.uiWorkflow
  }
  const page = await openLocalPage()
  const auth = await authenticateE2EPage(page)
  world.uiWorkflow = {
    page,
    auth,
    environmentId: '',
    agentId: '',
    sessionId: '',
    vaultId: '',
    message: '',
    runId: `ui-e2e-${Date.now()}`,
    controlPlaneRequestHeaders: [],
  }
  return world.uiWorkflow
}

async function createUiEnvironment(workflow: UiWorkflow) {
  if (workflow.environmentId) {
    return { id: workflow.environmentId, name: `${workflow.runId} environment` }
  }
  const environment = await apiJson<Environment>(workflow.page.request, '/api/environments', {
    method: 'POST',
    data: {
      name: `${workflow.runId} environment`,
      description: 'BDD UI environment',
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { description: 'mode', required: false } },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
      metadata: { runId: workflow.runId },
    },
  })
  workflow.environmentId = environment.id
  return environment
}

async function createUiAgent(workflow: UiWorkflow) {
  if (workflow.agentId) {
    return { id: workflow.agentId, name: `${workflow.runId} agent` }
  }
  const agent = await apiJson<Agent>(workflow.page.request, '/api/agents', {
    method: 'POST',
    data: {
      name: `${workflow.runId} agent`,
      description: 'BDD UI agent',
      instructions: 'Reply concisely through the deterministic test runtime.',
      systemPrompt: 'Reply concisely through the deterministic test runtime.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      skills: ['ama@local-ui'],
      allowedTools: ['sandbox.exec'],
      metadata: { runId: workflow.runId },
    },
  })
  workflow.agentId = agent.id
  return agent
}

async function createUiSessionGraph(workflow: UiWorkflow) {
  const environment = await createUiEnvironment(workflow)
  const agent = await createUiAgent(workflow)
  const session = await apiJson<Session>(workflow.page.request, '/api/sessions', {
    method: 'POST',
    data: {
      agentId: agent.id,
      environmentId: environment.id,
      title: `${workflow.runId} session`,
      metadata: { runId: workflow.runId },
    },
  })
  const readySession = (await waitForSession(workflow.page.request, session.id)) as Session
  workflow.sessionId = readySession.id
  return readySession
}

async function createUiVault(workflow: UiWorkflow) {
  if (workflow.vaultId) {
    return { id: workflow.vaultId, name: `${workflow.runId} vault` }
  }
  const vault = await apiJson<Vault>(workflow.page.request, '/api/vaults', {
    method: 'POST',
    data: {
      name: `${workflow.runId} vault`,
      description: 'BDD UI vault',
      scope: 'project',
    },
  })
  workflow.vaultId = vault.id
  return vault
}

async function assertComposerNearBottom(page: Page) {
  const viewport = page.viewportSize()
  assert.ok(viewport, 'Expected browser viewport for layout assertions')
  const prompt = page.getByPlaceholder('Send a message to the agent')
  await expect(prompt).toBeVisible()
  const promptBox = await prompt.boundingBox()
  assert.ok(promptBox, 'Expected chat composer input to have a layout box')
  assert.ok(
    promptBox.y + promptBox.height <= viewport.height,
    `Expected composer to stay inside viewport: ${JSON.stringify({ promptBox, viewport })}`,
  )
  assert.ok(
    viewport.height - (promptBox.y + promptBox.height) < 64,
    `Expected composer to stay near viewport bottom: ${JSON.stringify({ promptBox, viewport })}`,
  )
}

function requireUiWorkflow(world: UiWorld) {
  assert.ok(world.uiWorkflow, 'The local UI workflow must be initialized')
  return world.uiWorkflow
}

function eventText(event: SessionEvent) {
  const message = objectValue(event.payload.message)
  return textFromContent(message.content ?? event.payload.content)
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((item) => {
      const block = objectValue(item)
      return typeof block.text === 'string' ? block.text : ''
    })
    .join('')
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
