import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import { Then } from '@cucumber/cucumber'
import { type Browser, chromium, type Page, type Route } from '@playwright/test'
import type { ViteDevServer } from 'vite'

const now = '2026-05-23T00:00:00.000Z'

interface ResourceState {
  environments: Record<string, Record<string, unknown>>
  agents: Record<string, Record<string, unknown>>
  sessions: Record<string, Record<string, unknown>>
  events: Record<string, Array<Record<string, unknown>>>
}

Then(
  'a browser verifies the v1 create-session-to-run-task UI workflow with mocked API responses on desktop and mobile',
  { timeout: 120_000 },
  async () => {
    const port = await freePort()
    const server = await startVite(port)
    let browser: Browser | null = null

    try {
      browser = await chromium.launch({ headless: true })
      await runBrowserWorkflow(browser, port, { width: 1280, height: 900 })
      await runBrowserWorkflow(browser, port, { width: 390, height: 844 })
    } finally {
      await browser?.close()
      await stopProcess(server)
    }
  },
)

async function runBrowserWorkflow(browser: Browser, port: number, viewport: { width: number; height: number }) {
  const state: ResourceState = { environments: {}, agents: {}, sessions: {}, events: {} }
  const page = await browser.newPage({ viewport })
  try {
    await page.route('**/*', (route) => routeRequest(route, state))

    await page.goto(`http://127.0.0.1:${port}/quickstart`)
    await page.getByRole('link', { name: 'Environments' }).click()
    await page.getByRole('button', { name: 'Create environment' }).click()
    await page.getByRole('button', { name: 'Save environment' }).click()
    await expectText(page, 'Environment created')

    await page.getByRole('link', { name: 'Agents' }).click()
    await page.getByRole('button', { name: 'Create agent' }).click()
    await page.getByRole('button', { name: 'Save agent' }).click()
    await expectText(page, 'Agent created')
    await page.getByRole('button', { name: 'Start session' }).click()
    await expectText(page, 'Session started')

    await page.getByRole('button', { name: 'Send task' }).click()
    await expectText(page, 'Task sent to runtime')
    await expectText(page, 'AMA task completed')

    await page.getByRole('button', { name: 'Stop session' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Stop session' }).click()
    await expectText(page, 'Session stopped')

    assert.equal(Object.keys(state.environments).length, 1)
    assert.equal(Object.keys(state.agents).length, 1)
    assert.equal(Object.keys(state.sessions).length, 1)
    assert.ok(Object.values(state.events).some((events) => events.some((event) => event.type === 'message')))
  } finally {
    await page.close()
  }
}

async function routeRequest(route: Route, state: ResourceState) {
  const request = route.request()
  const url = new URL(request.url())

  if (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/runtime')) {
    await route.continue()
    return
  }

  const response = handleApiRequest(url, request.method(), request.postDataJSON(), state)
  await route.fulfill(response)
}

function handleApiRequest(
  url: URL,
  method: string,
  body: unknown,
  state: ResourceState,
): { status?: number; contentType?: string; body: string } {
  if (method === 'GET' && url.pathname === '/api/auth/me') {
    return json({
      user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
      organization: { id: 'org_1', name: 'Acme' },
      project: { id: 'project_1', name: 'Control Plane' },
      roles: ['owner'],
      permissions: ['agents:write'],
    })
  }

  if (url.pathname === '/api/environments') {
    if (method === 'POST') {
      const environment = environmentFixture('env_1', readName(body, 'Node workspace'))
      state.environments[environment.id as string] = environment
      return json(environment, 201)
    }
    return list(Object.values(state.environments))
  }

  if (url.pathname.startsWith('/api/environments/')) {
    return json(
      state.environments[url.pathname.split('/')[3] ?? ''] ?? {},
      state.environments[url.pathname.split('/')[3] ?? ''] ? 200 : 404,
    )
  }

  if (url.pathname === '/api/agents') {
    if (method === 'POST') {
      const environmentId = Object.keys(state.environments)[0] ?? null
      const agent = agentFixture('agent_1', readName(body, 'Coding agent'), environmentId)
      state.agents[agent.id as string] = agent
      return json(agent, 201)
    }
    return list(Object.values(state.agents))
  }

  if (url.pathname.match(/^\/api\/agents\/[^/]+\/sessions$/) && method === 'POST') {
    const agentId = url.pathname.split('/')[3] ?? 'agent_1'
    const agent = state.agents[agentId] ?? agentFixture(agentId, 'Coding agent', null)
    const environmentId = (agent.defaultEnvironmentId as string | null) ?? null
    const session = sessionFixture('session_1', agentId, environmentId)
    state.sessions[session.id as string] = session
    state.events[session.id as string] = [
      eventFixture(session.id as string, 1, 'lifecycle', 'debug', { status: 'idle', reason: 'runtime_ready' }),
    ]
    return json(session, 201)
  }

  if (url.pathname.startsWith('/api/agents/')) {
    return json(
      state.agents[url.pathname.split('/')[3] ?? ''] ?? {},
      state.agents[url.pathname.split('/')[3] ?? ''] ? 200 : 404,
    )
  }

  if (url.pathname === '/api/sessions') {
    return list(Object.values(state.sessions))
  }

  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/events$/)) {
    const sessionId = url.pathname.split('/')[3] ?? ''
    return list(state.events[sessionId] ?? [])
  }

  if (url.pathname.match(/^\/api\/sessions\/[^/]+\/stop$/) && method === 'POST') {
    const sessionId = url.pathname.split('/')[3] ?? ''
    const session = state.sessions[sessionId]
    assert.ok(session, `Expected session ${sessionId}`)
    session.status = 'stopped'
    session.stoppedAt = now
    state.events[sessionId]?.push(
      eventFixture(sessionId, state.events[sessionId].length + 1, 'lifecycle', 'audit', { status: 'stopped' }),
    )
    return json(session)
  }

  if (url.pathname.startsWith('/api/sessions/')) {
    return json(
      state.sessions[url.pathname.split('/')[3] ?? ''] ?? {},
      state.sessions[url.pathname.split('/')[3] ?? ''] ? 200 : 404,
    )
  }

  if (url.pathname.match(/^\/runtime\/sessions\/[^/]+\/rpc$/)) {
    const sessionId = url.pathname.split('/')[3] ?? ''
    if (method === 'POST') {
      state.events[sessionId]?.push(
        eventFixture(sessionId, state.events[sessionId].length + 1, 'message', 'transcript', {
          content: 'Create ama-task.txt with exactly: AMA task completed',
        }),
      )
      state.events[sessionId]?.push(
        eventFixture(sessionId, state.events[sessionId].length + 1, 'message', 'transcript', {
          content: 'AMA task completed',
        }),
      )
      return json({ accepted: true })
    }
    return { contentType: 'application/x-ndjson', body: '{"type":"agent_end","message":"AMA task completed"}\n' }
  }

  if (url.pathname === '/api/providers') return list([providerFixture()])
  if (url.pathname === '/api/vaults') return list([])
  if (url.pathname === '/api/mcp/connectors') return list([])
  if (url.pathname === '/api/mcp/connections') return list([])
  if (url.pathname === '/api/governance/policy') return json(governanceFixture())
  if (url.pathname === '/api/usage/summary') return json(usageFixture())
  if (url.pathname === '/api/audit-records') return list([])

  throw new Error(`Unhandled browser E2E request: ${method} ${url.pathname}`)
}

function readName(body: unknown, fallback: string) {
  return typeof body === 'object' && body && 'name' in body ? String(body.name) : fallback
}

function list(data: Array<Record<string, unknown>>) {
  return json({
    data,
    pagination: {
      limit: 100,
      nextCursor: null,
      hasMore: false,
      firstId: data[0]?.id ?? null,
      lastId: data.at(-1)?.id ?? null,
    },
  })
}

function json(value: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(value) }
}

function environmentFixture(id: string, name: string) {
  return {
    id,
    projectId: 'project_1',
    name,
    description: 'Runtime',
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: {},
    secretRefs: [],
    networkPolicy: { mode: 'restricted' },
    mcpPolicy: {},
    packageManagerPolicy: {},
    resourceLimits: { memoryMb: 1024 },
    runtimeImage: { image: 'node:24' },
    metadata: {},
    status: 'active',
    archivedAt: null,
    currentVersionId: 'envver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function agentFixture(id: string, name: string, defaultEnvironmentId: string | null) {
  return {
    id,
    projectId: 'project_1',
    name,
    description: 'Runs tasks',
    instructions: 'Do the task',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    systemPrompt: 'Do the task',
    allowedTools: ['read', 'write'],
    mcpConnectors: [],
    sandboxPolicy: { network: 'enabled' },
    defaultEnvironmentId,
    metadata: {},
    status: 'active',
    archivedAt: null,
    currentVersionId: 'agentver_1',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function sessionFixture(id: string, agentId: string, environmentId: string | null) {
  return {
    id,
    organizationId: 'org_1',
    projectId: 'project_1',
    agentId,
    agentVersionId: 'agentver_1',
    agentSnapshot: { ...agentFixture(agentId, 'Coding agent', environmentId), id: 'agentver_1', agentId, version: 1 },
    environmentId,
    environmentVersionId: environmentId ? 'envver_1' : null,
    environmentSnapshot: environmentId
      ? { ...environmentFixture(environmentId, 'Node workspace'), environmentId }
      : null,
    durableObjectName: id,
    sandboxId: id,
    piRuntimeId: `pi_${id}`,
    piProcessId: `proc_${id}`,
    runtimeEndpointPath: `/runtime/sessions/${id}/rpc`,
    agentUrl: `/agents/managed-agent/${id}`,
    modelProvider: 'workers-ai',
    modelConfig: { model: '@cf/moonshotai/kimi-k2.6' },
    status: 'idle',
    statusReason: null,
    metadata: {},
    startedAt: now,
    stoppedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function eventFixture(
  sessionId: string,
  sequence: number,
  type: string,
  visibility: string,
  payload: Record<string, unknown>,
) {
  return {
    id: `event_${sequence}`,
    organizationId: 'org_1',
    projectId: 'project_1',
    sessionId,
    sequence,
    type,
    visibility,
    role: type === 'message' ? 'assistant' : null,
    parentEventId: null,
    correlationId: null,
    payload,
    metadata: {},
    createdAt: now,
  }
}

function providerFixture() {
  return {
    id: 'workers-ai',
    projectId: 'project_1',
    type: 'workers-ai',
    displayName: 'Workers AI',
    baseUrl: null,
    isDefault: true,
    status: 'active',
    hasCredential: false,
    credentialStatus: 'not_required',
    metadata: {},
    rateLimits: {},
    budgetPolicy: {},
    modelCatalogStatus: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
}

function governanceFixture() {
  return {
    id: 'policy_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    scope: 'project',
    providerRules: [],
    modelRules: [],
    toolPolicy: {},
    mcpPolicy: {},
    sandboxPolicy: {},
    budgetPolicy: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
  }
}

function usageFixture() {
  return {
    totals: {
      key: {},
      records: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      costMicros: 0,
      currency: 'USD',
    },
    groups: [],
  }
}

async function expectText(page: Page, text: string) {
  await page.getByText(text).first().waitFor()
}

async function freePort() {
  const server = createNetServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(typeof address === 'object' && address)
  const port = address.port
  server.close()
  await once(server, 'close')
  return port
}

async function startVite(port: number) {
  const [{ createServer: createViteServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
    import('vite'),
    import('@vitejs/plugin-react-swc'),
    import('@tailwindcss/vite'),
  ])
  const server = await createViteServer({
    configFile: false,
    mode: 'development',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), './src'),
        '@server': path.resolve(process.cwd(), './server'),
        '@shared': path.resolve(process.cwd(), './shared'),
      },
    },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
    },
  })
  await server.listen()
  return server
}

async function stopProcess(server: ViteDevServer) {
  await server.close()
}
