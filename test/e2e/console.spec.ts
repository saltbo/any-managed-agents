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
  description: 'Runs tasks',
  instructions: 'Do the task',
  provider: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
  systemPrompt: 'Do the task',
  allowedTools: ['read', 'write'],
  mcpConnectors: [],
  sandboxPolicy: { network: 'enabled' },
  defaultEnvironmentId: 'env_1',
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
  durableObjectName: 'session_1',
  sandboxId: 'sandbox_1',
  piRuntimeId: 'pi_1',
  piProcessId: 'process_1',
  runtimeEndpointPath: '/api/sessions/session_1/runtime',
  agentUrl: '/api/sessions/session_1/runtime',
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
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()

    if (path === '/api/auth/me') return json(route, auth)
    if (path === '/api/agents' && method === 'GET') return json(route, { data: [agent] })
    if (path === '/api/agents/agent_1' && method === 'GET') return json(route, agent)
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
    if (path === '/api/agents/agent_1/sessions' && method === 'POST') {
      state.sessions = [session]
      return json(route, session)
    }
    if (path === '/api/sessions/session_1/events') return json(route, { data: state.events })
    if (path === '/api/sessions/session_1' && method === 'GET') return json(route, session)
    if (path === '/api/sessions/session_1/runtime' && method === 'POST') {
      state.events = [
        {
          id: 'event_1',
          organizationId: 'org_1',
          projectId: 'project_1',
          sessionId: 'session_1',
          sequence: 1,
          type: 'message',
          visibility: 'transcript',
          role: 'assistant',
          parentEventId: null,
          correlationId: null,
          payload: { text: 'AMA task completed' },
          metadata: {},
          createdAt: now,
        },
      ]
      return json(route, { accepted: true })
    }
    if (path === '/api/sessions/session_1/runtime' && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: '{"type":"agent_end","message":"AMA task completed"}\n',
      })
    }
    return route.continue()
  })
}

for (const scenario of [
  { name: 'desktop', viewport: { width: 1280, height: 900 } },
  { name: 'mobile 390px', viewport: { width: 390, height: 900 } },
]) {
  test(`console navigation and session task workflow at ${scenario.name}`, async ({ browser }) => {
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
    await page.getByRole('button', { name: 'Start session' }).click()
    await expect(page.getByText('Session started')).toBeVisible()
    await page.getByRole('button', { name: 'Send task' }).click()
    await expect(page.getByText('Task sent to runtime')).toBeVisible()

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
