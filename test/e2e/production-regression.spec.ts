import { type APIRequestContext, type BrowserContext, expect, type Page, test } from '@playwright/test'

const origin = process.env.AMA_ORIGIN ?? 'https://ama.tftt.cc'
const storageState = process.env.AMA_E2E_STORAGE_STATE
const sessionCookie = process.env.AMA_E2E_COOKIE
const loginEmail = process.env.AMA_E2E_EMAIL
const loginPassword = process.env.AMA_E2E_PASSWORD
const effectiveStorageState = sessionCookie ? undefined : storageState
const runId = `real-e2e-${Date.now()}`

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

test.use(effectiveStorageState ? { storageState: effectiveStorageState } : {})

test.describe('real authenticated production regression', () => {
  test.skip(
    !effectiveStorageState && !sessionCookie && (!loginEmail || !loginPassword),
    'Set AMA_E2E_STORAGE_STATE, AMA_E2E_COOKIE, or AMA_E2E_EMAIL/AMA_E2E_PASSWORD to run the real regression.',
  )

  test('creates resources, chats through the runtime, renders debug data, and avoids replay duplicates', async ({
    page,
  }) => {
    const created: { sessionId?: string; agentId?: string; environmentId?: string } = {}

    await authenticate(page)
    await expectAuthenticated(page)

    try {
      const environment = await apiJson<Environment>(page.request, '/api/environments', {
        method: 'POST',
        data: {
          name: `${runId} environment`,
          description: 'Production regression environment created through public AMA APIs.',
          packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
          networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
          packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
          resourceLimits: { memoryMb: 1024, timeoutSeconds: 900 },
          runtimeImage: { image: 'ama-pi-runtime' },
          metadata: { runId },
        },
      })
      created.environmentId = environment.id

      const agent = await apiJson<Agent>(page.request, '/api/agents', {
        method: 'POST',
        data: {
          name: `${runId} agent`,
          description: 'Production regression agent created through public AMA APIs.',
          instructions:
            'You are running an AMA production regression. Reply concisely. Use available tools when asked to run a shell command.',
          systemPrompt:
            'You are running an AMA production regression. Reply concisely. Use available tools when asked to run a shell command.',
          provider: process.env.AMA_E2E_PROVIDER ?? 'workers-ai',
          model: process.env.AMA_E2E_MODEL ?? '@cf/moonshotai/kimi-k2.6',
          allowedTools: ['sandbox.exec'],
          sandboxPolicy: { network: 'enabled' },
          metadata: { runId },
        },
      })
      created.agentId = agent.id

      const session = await apiJson<Session>(page.request, '/api/sessions', {
        method: 'POST',
        data: {
          agentId: agent.id,
          environmentId: environment.id,
          title: `${runId} session`,
          metadata: { runId },
        },
      })
      created.sessionId = session.id

      const readySession = await waitForSession(page.request, session.id)
      await page.goto(`/sessions/${readySession.id}`)
      await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Refresh events' })).toBeVisible()

      for (let turn = 1; turn <= 20; turn += 1) {
        await sendAndExpect(
          page,
          readySession.id,
          `This is production regression turn ${turn}. Reply exactly with: ama-real-browser-e2e-turn-${turn}`,
          new RegExp(`ama-real-browser-e2e-turn-${turn}`, 'i'),
        )
      }
      await sendAndExpect(
        page,
        readySession.id,
        'Use the sandbox.exec tool to run `whoami`, then reply exactly with `ama-whoami:<output>` using the command output.',
        /ama-whoami:/i,
      )

      const toolEvents = await waitForPersistedEvents(
        page.request,
        readySession.id,
        (events) => events.filter((event) => event.type.includes('tool') || hasToolPayload(event)).length > 0,
      )
      await expect(page.getByText('Tool').first()).toBeVisible()

      await sendAndExpect(
        page,
        readySession.id,
        'Use the sandbox.exec tool to run `sh -c "echo ama-visible-error >&2; exit 7"` and show the error.',
        /ama-visible-error|exit 7|error/i,
      )
      const errorEvents = await waitForPersistedEvents(
        page.request,
        readySession.id,
        (events) =>
          events.filter((event) => event.type === 'error' || eventContains(event, 'ama-visible-error')).length > 0,
      )

      await page.getByRole('tab', { name: 'Debug' }).click()
      await expect(page.getByText(/ama-visible-error|error/i).first()).toBeVisible()
      await expect(page.getByText(toolEvents[0]?.id ?? /tool/i).first()).toBeVisible()

      const transcriptTokenCount = await page.getByText(/ama-real-browser-e2e-turn-1/i).count()
      const persistedEventsBeforeReconnect = await persistedEventSignatures(page.request, readySession.id)
      await apiJson<Session>(page.request, `/api/sessions/${readySession.id}/reconnect`)
      await page.reload()
      await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
      await expect(page.getByText(/ama-real-browser-e2e-turn-1/i).first()).toBeVisible()
      await assertNoDuplicateReplayAfterReconnect(page, /ama-real-browser-e2e-turn-1/i, transcriptTokenCount)
      await assertNoDuplicatePersistedEvents(page.request, readySession.id, persistedEventsBeforeReconnect)

      expect(errorEvents.length).toBeGreaterThan(0)
    } finally {
      await cleanup(page.request, created)
    }
  })
})

async function authenticate(page: Page) {
  if (sessionCookie) {
    await addCookie(page.context(), sessionCookie)
    return
  }
  if (effectiveStorageState) {
    return
  }

  await page.goto('/quickstart')
  await page.getByRole('link', { name: 'Continue with FlareAuth' }).click()
  await fillLoginField(page, /email|username/i, loginEmail, 'email or username')
  await fillLoginField(page, /password/i, loginPassword, 'password')
  await clickLoginSubmit(page)
  await page.waitForURL((url) => url.origin === new URL(origin).origin && !url.pathname.startsWith('/api/auth'), {
    timeout: 60_000,
  })
}

async function expectAuthenticated(page: Page) {
  const response = await page.request.get('/api/auth/me')
  if (!response.ok()) {
    throw new Error(`GET /api/auth/me returned ${response.status()}: ${await response.text()}`)
  }
  await page.goto('/quickstart')
  await expect(page.getByText('Any Managed Agents').first()).toBeVisible()
}

async function addCookie(context: BrowserContext, rawCookie: string) {
  const url = new URL(origin)
  const [firstCookie] = rawCookie.split(';')
  const separator = firstCookie?.indexOf('=') ?? -1
  if (!firstCookie || separator === -1) {
    throw new Error('AMA_E2E_COOKIE must look like "__Host-ama_session=<value>"')
  }
  await context.addCookies([
    {
      name: firstCookie.slice(0, separator).trim(),
      value: firstCookie.slice(separator + 1).trim(),
      url: url.origin,
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
    },
  ])
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
    if (session.status === 'idle' || session.status === 'running') {
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
  await page.getByPlaceholder('Send a message to the agent').fill(message)
  await page.getByRole('button', { name: 'Send' }).click()
  await waitForAssistantMessage(page.request, sessionId, afterSequence, expected)
  await expect(page.getByText(expected).first()).toBeVisible({ timeout: 120_000 })
}

async function latestEventSequence(request: APIRequestContext, sessionId: string) {
  const events = (await apiJson<ListResponse<SessionEvent>>(request, `/api/sessions/${sessionId}/events?limit=1000`))
    .data
  return Math.max(0, ...events.map((event) => event.sequence))
}

async function waitForAssistantMessage(
  request: APIRequestContext,
  sessionId: string,
  afterSequence: number,
  expected: RegExp,
) {
  await waitForPersistedEvents(request, sessionId, (events) =>
    events.some(
      (event) =>
        event.sequence > afterSequence &&
        (event.type === 'message_end' || event.type === 'turn_end') &&
        eventRole(event) === 'assistant' &&
        expected.test(eventText(event)),
    ),
  )
}

async function waitForPersistedEvents(
  request: APIRequestContext,
  sessionId: string,
  predicate: (events: SessionEvent[]) => boolean,
) {
  let events: SessionEvent[] = []
  for (let attempt = 0; attempt < 60; attempt += 1) {
    events = (await apiJson<ListResponse<SessionEvent>>(request, `/api/sessions/${sessionId}/events?limit=1000`)).data
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function assertNoDuplicateReplayAfterReconnect(page: Page, pattern: RegExp, beforeReloadCount: number) {
  const count = await page.getByText(pattern).count()
  expect(count).toBe(beforeReloadCount)
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
    throw new Error(`Production e2e cleanup failed:\n${errors.join('\n')}`)
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
