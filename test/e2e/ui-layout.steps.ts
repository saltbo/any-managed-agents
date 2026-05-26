import assert from 'node:assert/strict'
import { AfterAll, Given, Then, When } from '@cucumber/cucumber'
import { expect, type Page } from '@playwright/test'
import { apiJson, authenticateE2EPage, closeLocalApp, delay, openLocalPage, waitForSession } from './local-app'
import type { AmaWorld } from './world'

interface Environment {
  id: string
}

interface Agent {
  id: string
}

interface Session {
  id: string
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
  message: string
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
    message: '',
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
      message: this.uiWorkflow?.message ?? '',
      controlPlaneRequestHeaders: this.uiWorkflow?.controlPlaneRequestHeaders ?? [],
    }
    await page.goto('/agents')
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
        runtimeImage: { image: 'ama-pi-runtime' },
        metadata: { runId },
      },
    })
    const agent = await apiJson<Agent>(workflow.page.request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${runId} agent`,
        instructions: 'Reply concisely through the local deterministic Pi runtime.',
        systemPrompt: 'Reply concisely through the local deterministic Pi runtime.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        allowedTools: ['sandbox.exec'],
        sandboxPolicy: { network: 'enabled' },
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
      events.some((event) => eventText(event).includes(`Received: ${workflow.message}`)),
    )
    await expect(workflow.page.getByText(`Received: ${workflow.message}`).first()).toBeVisible()
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
