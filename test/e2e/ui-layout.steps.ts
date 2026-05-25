import assert from 'node:assert/strict'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { AfterAll, Given, Then, When } from '@cucumber/cucumber'
import { type APIRequestContext, type Browser, chromium, expect, type Page } from '@playwright/test'
import type { AmaWorld } from './world'

interface Environment {
  id: string
}

interface Agent {
  id: string
}

interface Session {
  id: string
  status: string
  statusReason: string | null
}

interface SessionEvent {
  sequence: number
  type: string
  payload: Record<string, unknown>
}

interface ListResponse<T> {
  data: T[]
}

interface UiWorkflow {
  page: Page
  environmentId: string
  agentId: string
  sessionId: string
  message: string
}

type UiWorld = AmaWorld & { uiWorkflow?: UiWorkflow }

let devServer: ChildProcessWithoutNullStreams | undefined
let devServerOutput = ''
let browser: Browser | undefined
let baseURL: string | undefined

AfterAll(async () => {
  await browser?.close()
  browser = undefined
  await stopDevServer()
  baseURL = undefined
})

Given('the local real UI e2e app is running', { timeout: 120_000 }, async function (this: UiWorld) {
  const page = await openLocalPage()
  const response = await page.request.post('/api/e2e/auth/session')
  if (!response.ok()) {
    throw new Error(`POST /api/e2e/auth/session returned ${response.status()}: ${await response.text()}`)
  }
  const me = await page.request.get('/api/auth/me')
  if (!me.ok()) {
    throw new Error(`GET /api/auth/me returned ${me.status()}: ${await me.text()}`)
  }
  this.uiWorkflow = {
    page,
    environmentId: '',
    agentId: '',
    sessionId: '',
    message: '',
  }
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
    const readySession = await waitForSession(workflow.page.request, session.id)
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

async function openLocalPage() {
  const origin = await ensureLocalApp()
  browser ??= await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
  })
  return await context.newPage()
}

async function ensureLocalApp() {
  if (baseURL) {
    return baseURL
  }
  if (process.env.E2E_BASE_URL) {
    baseURL = process.env.E2E_BASE_URL
    return baseURL
  }

  process.env.CLOUDFLARE_ENV = process.env.CLOUDFLARE_ENV ?? 'e2e'
  process.env.AMA_E2E_TEST_AUTH = 'true'
  process.env.AMA_RUNTIME_MODE = 'test'
  process.env.E2E_APP_PORT = process.env.E2E_APP_PORT ?? '5173'

  const port = Number(process.env.E2E_APP_PORT)
  const origin = `http://localhost:${port}`
  if (await isHttpReady(origin)) {
    if (await isE2EReady(origin)) {
      baseURL = origin
      return baseURL
    }
    throw new Error(`Port ${port} is already in use by a server that is not configured for local e2e auth.`)
  }

  devServerOutput = ''
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CLOUDFLARE_ENV: process.env.CLOUDFLARE_ENV,
    AMA_E2E_TEST_AUTH: process.env.AMA_E2E_TEST_AUTH,
    AMA_RUNTIME_MODE: process.env.AMA_RUNTIME_MODE,
    E2E_APP_PORT: String(port),
  }
  delete childEnv.NODE_OPTIONS
  devServer = spawn('npx', ['vite', 'dev', '--host', 'localhost'], {
    cwd: process.cwd(),
    env: childEnv,
    detached: true,
    stdio: 'pipe',
  })
  devServer.stdout.on('data', (chunk) => {
    devServerOutput += String(chunk)
  })
  devServer.stderr.on('data', (chunk) => {
    devServerOutput += String(chunk)
  })
  baseURL = origin
  await waitForDevServer(baseURL)
  return baseURL
}

async function stopDevServer() {
  if (!devServer) {
    return
  }
  const server = devServer
  devServer = undefined
  const exited = new Promise<void>((resolve) => {
    server.once('exit', () => resolve())
  })
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
    } catch {
      server.kill('SIGTERM')
    }
  } else {
    server.kill('SIGTERM')
  }
  const didExit = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)])
  if (!didExit && server.pid) {
    try {
      process.kill(-server.pid, 'SIGKILL')
    } catch {
      server.kill('SIGKILL')
    }
    await exited
  }
}

async function waitForDevServer(origin: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (devServer?.exitCode !== null) {
      throw new Error(`Local e2e dev server exited with code ${devServer?.exitCode}:\n${devServerOutput}`)
    }
    try {
      if ((await isHttpReady(origin)) && (await isE2EReady(origin))) {
        return
      }
    } catch {
      // Keep waiting until Vite and the Worker runtime are ready.
    }
    await delay(1_000)
  }
  throw new Error(`Local e2e dev server did not become ready:\n${devServerOutput}`)
}

async function isHttpReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

async function isE2EReady(origin: string) {
  try {
    const response = await fetch(`${origin}/api/e2e/ready`)
    return response.ok
  } catch {
    return false
  }
}

async function apiJson<T>(
  request: APIRequestContext,
  path: string,
  init: NonNullable<Parameters<APIRequestContext['fetch']>[1]> = {},
) {
  const response = await request.fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  if (!response.ok()) {
    throw new Error(`${init.method ?? 'GET'} ${path} returned ${response.status()}: ${text}`)
  }
  return (text ? JSON.parse(text) : null) as T
}

async function waitForSession(request: APIRequestContext, sessionId: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const session = await apiJson<Session>(request, `/api/sessions/${sessionId}`)
    if (session.status === 'idle') {
      return session
    }
    if (session.status === 'error') {
      throw new Error(`Session startup failed: ${session.statusReason ?? 'unknown error'}`)
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not become usable before timeout`)
}

async function waitForPersistedEvents(
  request: APIRequestContext,
  sessionId: string,
  predicate: (events: SessionEvent[]) => boolean,
) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const events = (await apiJson<ListResponse<SessionEvent>>(request, `/api/sessions/${sessionId}/events?limit=200`))
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
