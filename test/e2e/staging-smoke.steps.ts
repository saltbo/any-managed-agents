import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Given, Then, When } from '@cucumber/cucumber'
import { type APIRequestContext, chromium, expect, type Page } from '@playwright/test'
import type { AmaWorld, StagingSmokeConfig, StagingSmokeEvidence } from './world'

const SELF_HOSTED_SMOKE_PROVIDER = process.env.AMA_E2E_PROVIDER ?? 'workers-ai'
const SELF_HOSTED_SMOKE_MODEL = process.env.AMA_E2E_MODEL ?? '@cf/moonshotai/kimi-k2.6'
const SELF_HOSTED_SMOKE_CAPABILITY = `runtime-provider-model:ama:${SELF_HOSTED_SMOKE_PROVIDER}:${SELF_HOSTED_SMOKE_MODEL}`

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
  sandboxId?: string | null
  runtimeEndpointPath?: string | null
  metadata?: Record<string, unknown>
}

interface SessionEvent {
  id: string
  sequence: number
  type: string
  visibility: string
  payload: Record<string, unknown>
  createdAt: string
}

interface ListResponse<T> {
  data: T[]
}

interface Runner {
  id: string
  status: string
}

interface RunnerWorkItem {
  id: string
  status: string
  payload: Record<string, unknown>
}

interface RunnerWorkLease {
  id: string
  status: string
  workItem: RunnerWorkItem
}

function assertIncludes(path: string, ...patterns: RegExp[]) {
  const content = readFileSync(path, 'utf8')
  for (const pattern of patterns) {
    assert.match(content, pattern, `${path} should match ${pattern}`)
  }
}

function readPackageScripts() {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
  return packageJson.scripts ?? {}
}

function stagingConfig() {
  const origin = process.env.AMA_STAGING_ORIGIN
  const accessToken = process.env.AMA_E2E_ACCESS_TOKEN
  const storageState = process.env.AMA_E2E_STORAGE_STATE
  const loginEmail = process.env.AMA_E2E_EMAIL
  const loginPassword = process.env.AMA_E2E_PASSWORD
  const effectiveStorageState = accessToken ? undefined : storageState

  if (!origin) {
    throw new Error('Set AMA_STAGING_ORIGIN to run the staging smoke against an explicit deployment origin.')
  }
  return {
    origin,
    runId: `staging-smoke-${Date.now()}`,
    ...(accessToken ? { accessToken } : {}),
    ...(effectiveStorageState ? { effectiveStorageState } : {}),
    ...(loginEmail ? { loginEmail } : {}),
    ...(loginPassword ? { loginPassword } : {}),
  }
}

Given('staging smoke credentials are configured', function (this: AmaWorld) {
  const config = stagingConfig()
  if (!config.effectiveStorageState && !config.accessToken && (!config.loginEmail || !config.loginPassword)) {
    throw new Error(
      'Set AMA_E2E_STORAGE_STATE, AMA_E2E_ACCESS_TOKEN, or AMA_E2E_EMAIL/AMA_E2E_PASSWORD to run the staging smoke.',
    )
  }
  this.stagingSmokeConfig = config
})

Then('the staging smoke command documents the required secret environment variables', () => {
  const scripts = readPackageScripts()
  assert.match(scripts['test:e2e'] ?? '', /specs\/product\/\*\*\/\*\.feature/)
  assert.match(scripts['test:e2e'] ?? '', /@implemented and not @planned/)
  assert.match(scripts['test:smoke'] ?? '', /specs\/smoke\/\*\*\/\*\.feature/)
  assert.match(scripts['test:smoke'] ?? '', /@implemented and not @planned/)
  assert.equal(scripts['test:smoke:dry-run'], undefined)
  assertIncludes(
    '.github/workflows/staging-smoke.yml',
    /npm run test:smoke/,
    /AMA_STAGING_ORIGIN/,
    /AMA_E2E_STORAGE_STATE/,
    /AMA_E2E_ACCESS_TOKEN/,
    /AMA_E2E_EMAIL/,
    /AMA_E2E_PASSWORD/,
  )
  assertIncludes(
    'README.md',
    /npm run test:e2e/,
    /AMA_STAGING_ORIGIN/,
    /AMA_E2E_STORAGE_STATE/,
    /AMA_E2E_ACCESS_TOKEN/,
    /AMA_E2E_EMAIL/,
    /AMA_E2E_PASSWORD/,
    /npm run test:smoke/,
    /Auth input precedence/,
  )
  assertIncludes(
    'docs/infra/cloudflare-deploy.md',
    /Local E2E And Staging Smoke/,
    /npm run test:e2e/,
    /AMA_STAGING_ORIGIN/,
    /AMA_E2E_STORAGE_STATE/,
    /AMA_E2E_ACCESS_TOKEN/,
    /AMA_E2E_EMAIL/,
    /AMA_E2E_PASSWORD/,
    /Auth input precedence/,
  )
  assertIncludes('.gitignore', /\.secrets\//)
})

When('the real authenticated staging browser smoke runs', { timeout: 20 * 60_000 }, async function (this: AmaWorld) {
  assert.ok(this.stagingSmokeConfig, 'Staging smoke credentials must be configured before running smoke')
  this.stagingSmokeEvidence = await runStagingSmoke(this.stagingSmokeConfig)
})

Then('the staging smoke authenticates without direct auth database access', function (this: AmaWorld) {
  assert.ok(this.stagingSmokeEvidence, 'Staging smoke must run before asserting authentication')
  assert.equal(this.stagingSmokeEvidence.authenticated, true)
})

Then('the staging smoke creates resources through public AMA APIs', function (this: AmaWorld) {
  assert.ok(this.stagingSmokeEvidence, 'Staging smoke must run before asserting created resources')
  assert.match(this.stagingSmokeEvidence.environmentId, /^env_/)
  assert.match(this.stagingSmokeEvidence.agentId, /^agent_/)
  assert.match(this.stagingSmokeEvidence.sessionId, /^session_/)
})

Then(
  'the staging smoke verifies runtime chat, tool rendering, debug errors, and replay dedupe',
  function (this: AmaWorld) {
    assert.ok(this.stagingSmokeEvidence, 'Staging smoke must run before asserting runtime behavior')
    assert.equal(this.stagingSmokeEvidence.completedTurns, 20)
    assert.equal(this.stagingSmokeEvidence.sawToolEvent, true)
    assert.equal(this.stagingSmokeEvidence.sawToolUi, true)
    assert.equal(this.stagingSmokeEvidence.sawErrorEvent, true)
    assert.equal(this.stagingSmokeEvidence.sawErrorUi, true)
    assert.equal(this.stagingSmokeEvidence.sawDebugUi, true)
    assert.equal(this.stagingSmokeEvidence.replayDedupeOk, true)
    assert.equal(this.stagingSmokeEvidence.persistedDedupeOk, true)
  },
)

Then('the staging smoke verifies self-hosted runner queue and lease execution', function (this: AmaWorld) {
  assert.ok(this.stagingSmokeEvidence, 'Staging smoke must run before asserting self-hosted runner behavior')
  assert.equal(this.stagingSmokeEvidence.selfHostedRunnerOk, true)
})

async function runStagingSmoke(config: StagingSmokeConfig): Promise<StagingSmokeEvidence> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    baseURL: config.origin,
    ...(config.effectiveStorageState ? { storageState: config.effectiveStorageState } : {}),
  })
  if (config.accessToken) {
    await context.setExtraHTTPHeaders({ authorization: `Bearer ${config.accessToken}` })
    await context.addInitScript((token) => {
      window.localStorage.setItem('ama:e2e-access-token', token)
    }, config.accessToken)
  }
  const page = await context.newPage()
  try {
    const created: { sessionId?: string; agentId?: string; environmentId?: string } = {}
    let authenticated = false
    let completedTurns = 0
    let sawToolEvent = false
    let sawToolUi = false
    let sawErrorEvent = false
    let sawErrorUi = false
    let sawDebugUi = false
    let replayDedupeOk = false
    let persistedDedupeOk = false
    let selfHostedRunnerOk = false

    await authenticate(page, config)
    await expectAuthenticated(page)
    authenticated = true

    let primaryError: unknown
    try {
      const environment = await apiJson<Environment>(page.request, '/api/environments', {
        method: 'POST',
        data: {
          name: `${config.runId} environment`,
          description: 'Staging smoke environment created through public AMA APIs.',
          packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
          networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
          packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
          resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
          runtimeConfig: { image: 'ama-pi-runtime' },
          metadata: { runId: config.runId },
        },
      })
      created.environmentId = environment.id

      const agent = await apiJson<Agent>(page.request, '/api/agents', {
        method: 'POST',
        data: {
          name: `${config.runId} agent`,
          description: 'Staging smoke agent created through public AMA APIs.',
          instructions:
            'You are running an AMA staging smoke. Reply concisely. Use available tools when asked to run a shell command.',
          systemPrompt:
            'You are running an AMA staging smoke. Reply concisely. Use available tools when asked to run a shell command.',
          provider: process.env.AMA_E2E_PROVIDER ?? 'workers-ai',
          model: process.env.AMA_E2E_MODEL ?? '@cf/moonshotai/kimi-k2.6',
          skills: ['ama@staging-smoke'],
          allowedTools: ['sandbox.exec'],
          metadata: { runId: config.runId },
        },
      })
      created.agentId = agent.id

      const session = await apiJson<Session>(page.request, '/api/sessions', {
        method: 'POST',
        data: {
          agentId: agent.id,
          environmentId: environment.id,
          title: `${config.runId} session`,
          metadata: { runId: config.runId },
        },
      })
      created.sessionId = session.id

      const readySession = await waitForSession(page.request, session.id)
      await page.goto(`/sessions/${readySession.id}`)
      await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh events' })).toBeVisible()

      for (let turn = 1; turn <= 20; turn += 1) {
        await sendAndExpectAssistantTurn(
          page,
          readySession.id,
          `Staging smoke turn ${turn}. Reply with one short acknowledgement.`,
        )
        completedTurns = turn
      }
      const whoamiTurn = await sendAndExpect(
        page,
        readySession.id,
        'Use the sandbox.exec tool to run `whoami`, then reply exactly with `ama-whoami:<output>` using the command output.',
        /ama-whoami:/i,
      )

      await waitForPersistedEvents(
        page.request,
        readySession.id,
        (events) => {
          sawToolEvent = events.filter((event) => event.type.includes('tool') || hasToolPayload(event)).length > 0
          return sawToolEvent
        },
        whoamiTurn.beforeSequence,
      )
      await expect(page.getByText('Tool').first()).toBeVisible()
      sawToolUi = true

      const errorTurn = await sendAndExpect(
        page,
        readySession.id,
        'Use the sandbox.exec tool to run `sh -c "echo ama-visible-error >&2; exit 7"` and show the error.',
        /ama-visible-error|exit 7|error/i,
      )
      const errorEvents = await waitForPersistedEvents(
        page.request,
        readySession.id,
        (events) =>
          events.filter((event) => event.type === 'runtime.error' || eventContains(event, 'ama-visible-error')).length >
          0,
        errorTurn.beforeSequence,
      )
      sawErrorEvent = errorEvents.length > 0

      await expect(page.getByText(/ama-visible-error|exit code:\s*7|exit 7/i).first()).toBeVisible()
      sawErrorUi = true
      await page.getByRole('tab', { name: 'Debug' }).click()
      await expect(page.getByText(/Tool end|Message end|Agent end/i).first()).toBeVisible()
      sawDebugUi = true

      const persistedEventsBeforeReconnect = await persistedEventSignatures(page.request, readySession.id)
      await apiJson<Session>(page.request, `/api/sessions/${readySession.id}/reconnect`)
      await page.reload()
      await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
      await assertNoDuplicatePersistedEvents(page.request, readySession.id, persistedEventsBeforeReconnect)
      replayDedupeOk = true
      persistedDedupeOk = true
      selfHostedRunnerOk = await exerciseSelfHostedRunnerMode(page.request, config)

      assert.ok(created.environmentId, 'Staging smoke should create an environment')
      assert.ok(created.agentId, 'Staging smoke should create an agent')
      assert.ok(created.sessionId, 'Staging smoke should create a session')
      return {
        authenticated,
        environmentId: created.environmentId,
        agentId: created.agentId,
        sessionId: created.sessionId,
        completedTurns,
        sawToolEvent,
        sawToolUi,
        sawErrorEvent,
        sawErrorUi,
        sawDebugUi,
        replayDedupeOk,
        persistedDedupeOk,
        selfHostedRunnerOk,
      }
    } catch (error) {
      primaryError = error
      throw error
    } finally {
      await cleanup(page.request, created, primaryError)
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

async function exerciseSelfHostedRunnerMode(request: APIRequestContext, config: StagingSmokeConfig) {
  const created: { sessionId?: string; agentId?: string; environmentId?: string; runnerId?: string } = {}
  let primaryError: unknown
  try {
    const environment = await apiJson<Environment>(request, '/api/environments', {
      method: 'POST',
      data: {
        name: `${config.runId} self-hosted environment`,
        description: 'Staging smoke self-hosted environment created through public AMA APIs.',
        hostingMode: 'self_hosted',
        runtime: 'ama',
        networkPolicy: { mode: 'unrestricted' },
        packages: [],
        metadata: { runId: config.runId, smokeMode: 'self-hosted-runner' },
      },
    })
    created.environmentId = environment.id

    const agent = await apiJson<Agent>(request, '/api/agents', {
      method: 'POST',
      data: {
        name: `${config.runId} self-hosted agent`,
        description: 'Staging smoke self-hosted agent created through public AMA APIs.',
        instructions: 'Execute queued self-hosted runner work.',
        systemPrompt: 'Execute queued self-hosted runner work.',
        provider: SELF_HOSTED_SMOKE_PROVIDER,
        model: SELF_HOSTED_SMOKE_MODEL,
        skills: ['ama@staging-smoke', 'ama@self-hosted-runner'],
        allowedTools: ['sandbox.exec'],
        metadata: { runId: config.runId, smokeMode: 'self-hosted-runner' },
      },
    })
    created.agentId = agent.id

    const capabilities = ['node', 'git', 'sandbox.exec', SELF_HOSTED_SMOKE_CAPABILITY]
    const runner = await apiJson<Runner>(request, '/api/runners', {
      method: 'POST',
      data: {
        name: `${config.runId} self-hosted runner`,
        environmentId: environment.id,
        capabilities,
        credentialSecretRef: `cloudflare-secret:${config.runId}-runner-token`,
        metadata: { runId: config.runId, smokeMode: 'self-hosted-runner' },
      },
    })
    created.runnerId = runner.id

    const activeRunner = await apiJson<Runner>(request, `/api/runners/${runner.id}/heartbeats`, {
      method: 'POST',
      data: {
        status: 'active',
        currentLoad: 0,
        capabilities,
        metadata: { runId: config.runId, smokeMode: 'self-hosted-runner' },
      },
    })
    assert.equal(activeRunner.status, 'active')

    const session = await apiJson<Session>(request, '/api/sessions', {
      method: 'POST',
      data: {
        agentId: agent.id,
        environmentId: environment.id,
        title: `${config.runId} self-hosted session`,
        initialPrompt: 'Execute this self-hosted runner smoke task.',
        metadata: { runId: config.runId, smokeMode: 'self-hosted-runner' },
      },
    })
    created.sessionId = session.id
    assert.equal(session.status, 'pending')
    assert.equal(session.statusReason, 'waiting-for-runner')
    assert.equal(session.sandboxId, null)
    assert.equal(session.runtimeEndpointPath, null)

    const workItems = await apiJson<ListResponse<RunnerWorkItem>>(
      request,
      `/api/runners/work-items?sessionId=${session.id}`,
    )
    assert.equal(workItems.data.length, 1)
    assert.equal(workItems.data[0]?.status, 'available')
    assert.equal(objectValue(workItems.data[0]?.payload).runtimeDriver, 'ama-self-hosted')
    assert.equal(objectValue(workItems.data[0]?.payload).runtimeOwner, undefined)

    const lease = await apiJson<RunnerWorkLease>(request, `/api/runners/${runner.id}/leases`, {
      method: 'POST',
      data: { leaseDurationSeconds: 90 },
    })
    assert.equal(lease.status, 'active')
    assert.equal(lease.workItem.status, 'leased')

    const running = await apiJson<Session>(request, `/api/sessions/${session.id}`)
    assert.equal(running.status, 'running')

    const events = await apiJson<{ accepted: number }>(request, `/api/runners/${runner.id}/leases/${lease.id}/events`, {
      method: 'POST',
      data: {
        events: [
          {
            type: 'tool_call.started',
            payload: {
              type: 'tool_call.started',
              toolName: 'sandbox.exec',
              input: { command: 'printf self-hosted-runner-smoke' },
            },
            metadata: { runnerId: runner.id, runId: config.runId },
          },
        ],
      },
    })
    assert.equal(events.accepted, 1)

    const completed = await apiJson<RunnerWorkLease>(request, `/api/runners/${runner.id}/leases/${lease.id}`, {
      method: 'PATCH',
      data: { status: 'completed', result: { ok: true, smokeMode: 'self-hosted-runner' } },
    })
    assert.equal(completed.status, 'completed')
    assert.equal(completed.workItem.status, 'succeeded')

    const idle = await apiJson<Session>(request, `/api/sessions/${session.id}`)
    assert.equal(idle.status, 'idle')
    return true
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    await cleanupSelfHostedRunnerMode(request, created, primaryError)
  }
}

async function authenticate(page: Page, config: StagingSmokeConfig) {
  if (config.accessToken) {
    await page.goto('/quickstart')
    return
  }
  if (config.effectiveStorageState) {
    await page.goto('/quickstart')
    await installBearerFromBrowserStorage(page)
    return
  }

  await page.goto('/quickstart')
  await page.getByRole('button', { name: 'Continue with OIDC provider' }).click()
  await fillLoginField(page, /email|username/i, config.loginEmail, 'email or username')
  await fillLoginField(page, /password/i, config.loginPassword, 'password')
  await clickLoginSubmit(page)
  await page.waitForURL(
    (url) =>
      url.origin === new URL(config.origin).origin &&
      !url.pathname.startsWith('/api/auth') &&
      !url.pathname.startsWith('/auth/callback'),
    {
      timeout: 60_000,
    },
  )
  await installBearerFromBrowserStorage(page)
}

async function expectAuthenticated(page: Page) {
  const response = await page.request.get('/api/projects')
  if (!response.ok()) {
    throw new Error(`GET /api/projects returned ${response.status()}: ${await response.text()}`)
  }
  await page.goto('/quickstart')
  await expect(page.getByText('Any Managed Agents').first()).toBeVisible()
}

async function installBearerFromBrowserStorage(page: Page) {
  await page.waitForFunction(
    () => {
      if (window.localStorage.getItem('ama:e2e-access-token')) {
        return true
      }
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (!key?.startsWith('oidc.user:')) continue
        const raw = window.localStorage.getItem(key)
        if (!raw) continue
        try {
          const user = JSON.parse(raw) as { access_token?: string; expires_at?: number }
          if (user.access_token && (!user.expires_at || user.expires_at * 1000 > Date.now())) {
            return true
          }
        } catch {}
      }
      return false
    },
    undefined,
    { timeout: 30_000 },
  )
  const accessToken = await page.evaluate(() => {
    const e2eToken = window.localStorage.getItem('ama:e2e-access-token')
    if (e2eToken) {
      return e2eToken
    }
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith('oidc.user:')) continue
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      try {
        const user = JSON.parse(raw) as { access_token?: string; expires_at?: number }
        if (user.access_token && (!user.expires_at || user.expires_at * 1000 > Date.now())) {
          return user.access_token
        }
      } catch {}
    }
    return null
  })
  if (!accessToken) {
    throw new Error('OIDC sign-in completed without a usable access token in browser storage')
  }
  await page.context().setExtraHTTPHeaders({ authorization: `Bearer ${accessToken}` })
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
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const session = await apiJson<Session>(request, `/api/sessions/${sessionId}`)
    if (session.status === 'idle') {
      return session
    }
    if (session.status === 'error') {
      throw new Error(`Session startup failed: ${session.statusReason ?? 'unknown error'}`)
    }
    await delay(2_000)
  }
  throw new Error(`Session ${sessionId} did not become usable before timeout`)
}

async function sendAndExpect(page: Page, sessionId: string, message: string, expected: RegExp) {
  const afterSequence = await latestEventSequence(page.request, sessionId)
  await page.getByRole('tab', { name: 'Transcript' }).click()
  const input = page.getByPlaceholder('Send a message to the agent')
  const sendButton = page.getByRole('button', { name: 'Send' })
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(message)
  await expect(sendButton).toBeEnabled({ timeout: 60_000 })
  await sendButton.click()
  await waitForAssistantMessage(page.request, sessionId, afterSequence, expected)
  await expect(page.getByText(expected).first()).toBeVisible({ timeout: 120_000 })
  await expect(page.getByText(/^running$/)).toHaveCount(0, { timeout: 60_000 })
  return { beforeSequence: afterSequence }
}

async function sendAndExpectAssistantTurn(page: Page, sessionId: string, message: string) {
  const afterSequence = await latestEventSequence(page.request, sessionId)
  await page.getByRole('tab', { name: 'Transcript' }).click()
  const input = page.getByPlaceholder('Send a message to the agent')
  const sendButton = page.getByRole('button', { name: 'Send' })
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(message)
  await expect(sendButton).toBeEnabled({ timeout: 60_000 })
  await sendButton.click()
  const assistantText = await waitForAssistantTurn(page.request, sessionId, afterSequence)
  await expect(page.getByText(message).first()).toBeVisible({ timeout: 120_000 })
  if (assistantText) {
    await expect(page.getByText(assistantText, { exact: false }).first()).toBeVisible({ timeout: 120_000 })
  }
  await expect(page.getByText(/^running$/)).toHaveCount(0, { timeout: 60_000 })
  return { beforeSequence: afterSequence }
}

async function latestEventSequence(request: APIRequestContext, sessionId: string) {
  const events = (
    await apiJson<ListResponse<SessionEvent>>(request, `/api/sessions/${sessionId}/events?order=desc&limit=1`)
  ).data
  return Math.max(0, ...events.map((event) => event.sequence))
}

async function waitForAssistantMessage(
  request: APIRequestContext,
  sessionId: string,
  afterSequence: number,
  expected: RegExp,
) {
  await waitForPersistedEvents(
    request,
    sessionId,
    (events) =>
      events.some(
        (event) =>
          event.sequence > afterSequence &&
          (event.type === 'transcript.message' || event.type === 'session.lifecycle') &&
          eventRole(event) === 'assistant' &&
          expected.test(eventText(event)),
      ),
    afterSequence,
  )
}

async function waitForAssistantTurn(request: APIRequestContext, sessionId: string, afterSequence: number) {
  let assistantText = ''
  await waitForPersistedEvents(
    request,
    sessionId,
    (events) => {
      const event = events.find(
        (candidate) =>
          candidate.sequence > afterSequence &&
          candidate.type === 'session.lifecycle' &&
          eventRole(candidate) === 'assistant',
      )
      if (!event) {
        return false
      }
      assistantText = firstVisibleText(eventText(event))
      return true
    },
    afterSequence,
  )
  return assistantText
}

async function waitForPersistedEvents(
  request: APIRequestContext,
  sessionId: string,
  predicate: (events: SessionEvent[]) => boolean,
  cursor = 0,
) {
  let events: SessionEvent[] = []
  for (let attempt = 0; attempt < 180; attempt += 1) {
    events = (
      await apiJson<ListResponse<SessionEvent>>(
        request,
        `/api/sessions/${sessionId}/events?limit=200${cursor > 0 ? `&cursor=${cursor}` : ''}`,
      )
    ).data
    if (predicate(events)) {
      return events
    }
    await delay(1_000)
  }
  throw new Error(`Session ${sessionId} did not persist the expected runtime events`)
}

function eventRole(event: SessionEvent) {
  const message = objectValue(event.payload.message)
  return typeof message.role === 'string' ? message.role : null
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

function firstVisibleText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function assertNoDuplicatePersistedEvents(
  request: APIRequestContext,
  sessionId: string,
  beforeReconnect: string[],
) {
  expect(await persistedEventSignatures(request, sessionId)).toEqual(beforeReconnect)
}

async function persistedEventSignatures(request: APIRequestContext, sessionId: string) {
  const events = (await apiJson<ListResponse<SessionEvent>>(request, `/api/sessions/${sessionId}/events?limit=200`))
    .data
  return events.map((event) => `${event.type}:${event.visibility}:${stableStringify(event.payload)}`)
}

async function cleanup(
  request: APIRequestContext,
  created: { sessionId?: string; agentId?: string; environmentId?: string },
  primaryError?: unknown,
) {
  const errors: string[] = []
  if (created.sessionId) {
    await archiveCreatedResource(request, `/api/sessions/${created.sessionId}`, errors)
  }
  if (created.agentId) {
    await archiveCreatedResource(request, `/api/agents/${created.agentId}`, errors)
  }
  if (created.environmentId) {
    await archiveCreatedResource(request, `/api/environments/${created.environmentId}`, errors)
  }
  if (errors.length > 0) {
    const cleanupError = new Error(`Staging smoke cleanup failed:\n${errors.join('\n')}`)
    if (primaryError) {
      throw new AggregateError([primaryError, cleanupError], 'Staging smoke failed and cleanup also failed')
    }
    throw cleanupError
  }
}

async function cleanupSelfHostedRunnerMode(
  request: APIRequestContext,
  created: { sessionId?: string; agentId?: string; environmentId?: string; runnerId?: string },
  primaryError?: unknown,
) {
  const errors: string[] = []
  if (created.runnerId) {
    try {
      const response = await request.patch(`/api/runners/${created.runnerId}`, {
        data: { status: 'disabled', metadata: { archivedBy: 'staging-smoke' } },
      })
      if (!response.ok()) {
        errors.push(`PATCH /api/runners/${created.runnerId} returned ${response.status()}: ${await response.text()}`)
      }
    } catch (error) {
      errors.push(
        `PATCH /api/runners/${created.runnerId} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (created.sessionId) {
    await archiveCreatedResource(request, `/api/sessions/${created.sessionId}`, errors)
  }
  if (created.agentId) {
    await archiveCreatedResource(request, `/api/agents/${created.agentId}`, errors)
  }
  if (created.environmentId) {
    await archiveCreatedResource(request, `/api/environments/${created.environmentId}`, errors)
  }
  if (errors.length > 0) {
    const cleanupError = new Error(`Self-hosted staging smoke cleanup failed:\n${errors.join('\n')}`)
    if (primaryError) {
      throw new AggregateError([primaryError, cleanupError], 'Self-hosted staging smoke failed and cleanup also failed')
    }
    throw cleanupError
  }
}

async function archiveCreatedResource(request: APIRequestContext, path: string, errors: string[]) {
  try {
    const response = await request.delete(path)
    if (!response.ok()) {
      errors.push(`DELETE ${path} returned ${response.status()}: ${await response.text()}`)
    }
  } catch (error) {
    errors.push(`DELETE ${path} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function fillLoginField(page: Page, name: RegExp, value: string | undefined, label: string) {
  if (!value) {
    throw new Error(`Missing login ${label}`)
  }
  const byRole = page.getByRole('textbox', { name }).first()
  await byRole.waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    const byLabel = page.getByLabel(name).first()
    await byLabel.waitFor({ state: 'visible', timeout: 30_000 })
    await byLabel.fill(value)
  })
  if (await byRole.isVisible().catch(() => false)) {
    await byRole.fill(value)
  }
}

async function clickLoginSubmit(page: Page) {
  await clickFirstVisible(page, [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Continue")',
    'button:has-text("Log in")',
  ])
}

async function clickFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first()
    if (await locator.isVisible().catch(() => false)) {
      await locator.click()
      return
    }
  }
  throw new Error(`Unable to find visible login submit control from selectors: ${selectors.join(', ')}`)
}

function hasToolPayload(event: SessionEvent) {
  return Boolean(event.payload.toolCall ?? event.payload.toolExecution ?? event.payload.call)
}

function eventContains(event: SessionEvent, text: string) {
  return JSON.stringify(event).includes(text)
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
