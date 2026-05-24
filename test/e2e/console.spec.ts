import { expect, type Page, type Route, test } from '@playwright/test'

const now = '2026-05-23T00:00:00.000Z'

const auth = {
  user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
  organization: { id: 'org_1', name: 'Acme' },
  project: { id: 'project_1', name: 'Control Plane' },
  roles: ['owner'],
  permissions: ['agents:write'],
}

const environment = {
  id: 'env_1',
  projectId: 'project_1',
  name: 'Node workspace',
  description: 'Runtime',
  packages: [{ name: 'tsx', version: 'latest' }],
  variables: { NODE_ENV: { description: 'mode', required: false } },
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

const agent = {
  id: 'agent_1',
  projectId: 'project_1',
  name: 'Coding agent',
  description: 'Runs work',
  instructions: 'Do the work',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  systemPrompt: 'Do the work',
  allowedTools: ['read', 'write'],
  mcpConnectors: [],
  sandboxPolicy: { network: 'enabled' },
  metadata: {},
  status: 'active',
  archivedAt: null,
  currentVersionId: 'agentver_1',
  version: 1,
  createdAt: now,
  updatedAt: now,
}

const session = {
  id: 'session_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  agentId: 'agent_1',
  agentVersionId: 'agentver_1',
  agentSnapshot: { ...agent, agentId: 'agent_1' },
  environmentId: 'env_1',
  environmentVersionId: 'envver_1',
  environmentSnapshot: { ...environment, environmentId: 'env_1' },
  title: null,
  resourceRefs: [],
  vaultRefs: [],
  durableObjectName: 'session_1',
  sandboxId: 'sandbox_1',
  piRuntimeId: 'pi_1',
  piProcessId: 'process_1',
  runtimeEndpointPath: '/runtime/sessions/session_1/rpc',
  agentUrl: '/runtime/sessions/session_1/rpc',
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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function mockApi(page: Page) {
  const state = { sessions: [] as (typeof session)[], events: [] as Array<Record<string, unknown>> }
  await page.addInitScript(() => {
    class MockRuntimeWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      readyState = MockRuntimeWebSocket.CONNECTING
      url: string

      constructor(url: string) {
        super()
        this.url = url
        queueMicrotask(() => {
          this.readyState = MockRuntimeWebSocket.OPEN
          this.dispatchEvent(new Event('open'))
        })
      }

      send(data: string) {
        const command = JSON.parse(data) as { id?: string; type?: string; message?: string }
        this.emit({ type: 'response', id: command.id, command: command.type, success: true })
        if (command.type === 'prompt' || command.type === 'follow_up') {
          const content = `Received: ${command.message}`
          this.emit({
            type: 'message_update',
            id: `${command.id}_assistant`,
            message: { role: 'assistant', content },
            assistantMessageEvent: { text: content },
          })
          this.emit({
            type: 'tool_execution_end',
            id: `${command.id}_tool`,
            toolCall: { id: `${command.id}_tool`, name: 'write_file', output: { ok: true }, durationMs: 4 },
          })
          this.emit({ type: 'message_end', id: `${command.id}_assistant`, message: { role: 'assistant', content } })
          this.emit({ type: 'agent_end', id: `${command.id}_end`, willRetry: false })
        }
      }

      close() {
        this.readyState = MockRuntimeWebSocket.CLOSED
        this.dispatchEvent(new Event('close'))
      }

      private emit(payload: Record<string, unknown>) {
        queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(payload) })))
      }
    }
    window.WebSocket = MockRuntimeWebSocket as unknown as typeof WebSocket
  })
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/api/auth/me') return json(route, auth)
    if (path === '/api/agents' && method === 'GET') return json(route, { data: [agent] })
    if (path === '/api/agents/agent_1' && method === 'GET') return json(route, agent)
    if (path === '/api/agents/agent_1/versions' && method === 'GET')
      return json(route, { data: [session.agentSnapshot] })
    if (path === '/api/environments' && method === 'GET') return json(route, { data: [environment] })
    if (path === '/api/environments/env_1' && method === 'GET') return json(route, environment)
    if (path === '/api/sessions' && method === 'GET') return json(route, { data: state.sessions })
    if (path === '/api/providers') return json(route, { data: [provider()] })
    if (path === '/api/providers/workers-ai') return json(route, provider())
    if (path === '/api/vaults') return json(route, { data: [] })
    if (path === '/api/mcp/connectors') return json(route, { data: [] })
    if (path === '/api/mcp/connections') return json(route, { data: [] })
    if (path === '/api/governance/policy') return json(route, governancePolicy())
    if (path === '/api/usage/summary') return json(route, usageSummary())
    if (path === '/api/audit-records') return json(route, { data: [] })
    if (path === '/api/sessions' && method === 'POST') {
      state.sessions = [session]
      return json(route, session)
    }
    if (path === '/api/sessions/session_1/events') return json(route, { data: state.events })
    if (path === '/api/sessions/session_1' && method === 'GET') return json(route, session)
    return route.continue()
  })
}

for (const scenario of [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile 390px', viewport: { width: 390, height: 900 } },
]) {
  test(`console navigation and session chat workflow at ${scenario.name}`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: scenario.viewport })
    await mockApi(page)

    await page.goto('/quickstart')
    await expect(page.getByText('First run workflow')).toBeVisible()
    for (const label of [
      'Quickstart',
      'Agents',
      'Environments',
      'Sessions',
      'Providers',
      'Vaults',
      'Usage',
      'Audit',
      'Settings',
    ]) {
      await expect(page.getByRole('link', { name: label }).first()).toBeVisible()
    }

    await page.getByRole('link', { name: 'Agents' }).first().click()
    await page.getByRole('button', { name: 'Create session' }).click()
    await expect(page.getByRole('heading', { name: 'Create Session' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Create session' }).click()
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Session created' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Transcript' })).toBeVisible()
    await page.getByRole('button', { name: 'Open agent details' }).click()
    await expect(page.getByRole('heading', { name: 'Coding agent' })).toBeVisible()
    await expect(page.getByText('Agent id')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Open environment details' }).click()
    await expect(page.getByRole('heading', { name: 'Node workspace' })).toBeVisible()
    await expect(page.getByText('Environment id')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByPlaceholder('Send a message to the agent').fill('Create ama-message.txt')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText(/Received: Create ama-message/)).toBeVisible()
    await expect(page.getByText('write_file')).toBeVisible()

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)
    await page.close()
  })
}

function provider() {
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

function governancePolicy() {
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

function usageSummary() {
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
