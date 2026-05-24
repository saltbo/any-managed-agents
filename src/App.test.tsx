import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { Agent, AuthContext, Environment, Session, SessionEvent } from './lib/api'

const now = '2026-05-23T00:00:00.000Z'
const authContext: AuthContext = {
  user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
  organization: { id: 'org_1', name: 'Acme' },
  project: { id: 'project_1', name: 'Control Plane' },
  roles: ['owner'],
  permissions: ['agents:write'],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function noContent() {
  return new Response(null, { status: 204 })
}

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    projectId: 'project_1',
    name: 'Node workspace',
    description: 'Runtime',
    packages: [{ name: 'tsx', version: 'latest' }],
    variables: { NODE_ENV: { description: 'mode', required: false } },
    secretRefs: [{ name: 'npm_token', ref: 'secret:npm' }],
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
    ...overrides,
  }
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
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
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    agentId: 'agent_1',
    agentVersionId: 'agentver_1',
    agentSnapshot: {
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: 'project_1',
      version: 1,
      instructions: 'Do the task',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
      systemPrompt: 'Do the task',
      allowedTools: ['read', 'write'],
      mcpConnectors: [],
      sandboxPolicy: { network: 'enabled' },
      defaultEnvironmentId: 'env_1',
      metadata: {},
      createdAt: now,
    },
    environmentId: 'env_1',
    environmentVersionId: 'envver_1',
    environmentSnapshot: {
      ...environment(),
      environmentId: 'env_1',
      version: 1,
    },
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
    ...overrides,
  }
}

function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
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
    ...overrides,
  }
}

function mockConsoleApi(seed?: {
  environments?: Environment[]
  agents?: Agent[]
  sessions?: Session[]
  events?: SessionEvent[]
}) {
  const state = {
    environments: seed?.environments ?? [],
    agents: seed?.agents ?? [],
    sessions: seed?.sessions ?? [],
    events: seed?.events ?? [],
  }

  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/auth/me') {
      return jsonResponse(authContext)
    }
    if (url === '/api/auth/logout') {
      return noContent()
    }
    if (url === '/api/environments' && method === 'GET') {
      return jsonResponse({ data: state.environments })
    }
    if (url === '/api/environments' && method === 'POST') {
      const created = environment({ id: 'env_created', name: 'Node workspace' })
      state.environments = [created]
      return jsonResponse(created)
    }
    if (url === '/api/agents' && method === 'GET') {
      return jsonResponse({ data: state.agents })
    }
    if (url === '/api/agents' && method === 'POST') {
      const created = agent({ id: 'agent_created', defaultEnvironmentId: state.environments[0]?.id ?? null })
      state.agents = [created]
      return jsonResponse(created)
    }
    if (url === '/api/agents/agent_created/sessions' && method === 'POST') {
      const created = session({ agentId: 'agent_created' })
      state.sessions = [created]
      return jsonResponse(created)
    }
    if (url === '/api/sessions' && method === 'GET') {
      return jsonResponse({ data: state.sessions })
    }
    if (url === '/api/sessions/session_1/events' && method === 'GET') {
      return jsonResponse({ data: state.events })
    }
    if (url === '/api/sessions/session_1/runtime' && method === 'POST') {
      state.events = [event()]
      return jsonResponse({ accepted: true })
    }
    if (url === '/api/sessions/session_1/runtime' && method === 'GET') {
      return new Response('{"type":"agent_end","message":"AMA task completed"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }
    if (url === '/api/sessions/session_1/stop' && method === 'POST') {
      state.sessions = [session({ status: 'stopped', stoppedAt: now })]
      return jsonResponse(state.sessions[0])
    }
    if (url === '/api/sessions/session_1' && method === 'DELETE') {
      state.sessions = [session({ status: 'archived', archivedAt: now })]
      return noContent()
    }

    throw new Error(`Unexpected fetch: ${method} ${url}`)
  })

  return { fetchMock, state }
}

function primaryNav() {
  return within(screen.getByRole('navigation', { name: 'Primary' }))
}

async function confirmAction(triggerName: string, confirmName = triggerName) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }))
  const dialog = await screen.findByRole('alertdialog')
  fireEvent.click(within(dialog).getByRole('button', { name: confirmName }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState({}, '', '/')
})

describe('App', () => {
  it('shows the FlareAuth login action when the session is missing', async () => {
    window.history.pushState({}, '', '/sessions?status=idle')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ error: { message: 'Authentication required' } }, 401),
    )

    render(<App />)

    expect(await screen.findByText('Continue with FlareAuth')).toBeTruthy()
    expect(screen.getByText('Sign in through FlareAuth to open the control plane.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue with FlareAuth' })).toHaveProperty(
      'href',
      'http://localhost:3000/api/auth/login?returnTo=%2Fsessions%3Fstatus%3Didle',
    )
  })

  it('drives the v1 console from resource creation through runtime events', async () => {
    const { fetchMock } = mockConsoleApi()

    render(<App />)

    expect(await screen.findByText('No agents')).toBeTruthy()
    expect(screen.queryByText('Acceptance Path')).toBeNull()
    expect(document.querySelector('[data-slot="button"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="card"]')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create Environment' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Create Agent' })).toBeNull()
    expect(primaryNav().getByRole('link', { name: 'Agents' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Environments' })).toBeTruthy()
    expect(primaryNav().getByRole('link', { name: 'Sessions' })).toBeTruthy()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Environments' }))
    expect(window.location.pathname).toBe('/environments')
    expect(screen.getByRole('heading', { name: 'Environments' })).toBeTruthy()
    expect(screen.getByText('No environments')).toBeTruthy()
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(window.location.pathname).toBe('/sessions')
    expect(screen.getByText('No sessions')).toBeTruthy()
    fireEvent.click(primaryNav().getByRole('link', { name: 'Environments' }))
    expect(window.location.pathname).toBe('/environments')

    fireEvent.click(screen.getByRole('button', { name: 'Create environment' }))
    expect(await screen.findByRole('heading', { name: 'Create Environment' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save environment' }))
    expect(await screen.findByText('Environment created')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create Environment' })).toBeNull()

    fireEvent.click(primaryNav().getByRole('link', { name: 'Agents' }))
    expect(window.location.pathname).toBe('/agents')
    fireEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(await screen.findByRole('heading', { name: 'Create Agent' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save agent' }))
    expect(await screen.findByText('Agent created')).toBeTruthy()
    expect(screen.getByText('Coding agent')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Start session' }))
    expect(await screen.findByText('Session started')).toBeTruthy()
    expect(window.location.pathname).toBe('/sessions')
    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeTruthy()
    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('No persisted events yet.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))
    expect(await screen.findByText('Task sent to runtime')).toBeTruthy()
    expect(screen.getAllByText(/AMA task completed/).length).toBeGreaterThan(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/session_1/runtime',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('shows error, stopped, and archived session states', async () => {
    mockConsoleApi({
      environments: [environment()],
      agents: [agent()],
      sessions: [
        session({ status: 'error', statusReason: 'Runtime crashed' }),
        session({ id: 'session_stopped', status: 'stopped', stoppedAt: now }),
        session({ id: 'session_archived', status: 'archived', archivedAt: now }),
      ],
      events: [event({ type: 'error', payload: { message: 'Runtime crashed' } })],
    })

    render(<App />)

    await screen.findByText('Coding agent')
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))
    expect(screen.getByText('Runtime crashed')).toBeTruthy()
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)

    await confirmAction('Stop session')
    expect(await screen.findByText('Session stopped')).toBeTruthy()
    const statusRows = screen.getAllByText('Status').map((label) => label.closest('div'))
    expect(statusRows.some((row) => row && within(row).queryByText('stopped'))).toBe(true)

    await confirmAction('Archive session')
    expect(await screen.findByText('Session archived')).toBeTruthy()
    expect(screen.getAllByText('archived').length).toBeGreaterThan(0)
  })

  it('surfaces load failures after the loading state', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return jsonResponse(authContext)
      }
      return jsonResponse({ error: { message: 'Control plane unavailable' } }, 503)
    })

    render(<App />)

    expect(screen.getByText('Loading console')).toBeTruthy()
    expect(await screen.findByText('Control plane unavailable')).toBeTruthy()
  })

  it('renders sessions, runtime events, and sends tasks through the runtime endpoint', async () => {
    const runtimeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return jsonResponse({ accepted: true })
      }
      return new Response('{"type":"agent_end","message":"AMA task completed"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      })
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/auth/me') {
        return jsonResponse({
          user: { id: 'user_1', email: 'owner@example.com', name: 'Owner', avatarUrl: null },
          organization: { id: 'org_1', name: 'Acme' },
          project: { id: 'project_1', name: 'Control Plane' },
          roles: ['owner'],
          permissions: ['agents:write'],
        })
      }
      if (url.startsWith('/api/agents')) {
        return jsonResponse({ data: [agentFixture] })
      }
      if (url.startsWith('/api/environments')) {
        return jsonResponse({ data: [environmentFixture] })
      }
      if (url === '/api/sessions/session_1/events') {
        return jsonResponse({
          data: [
            {
              id: 'event_1',
              organizationId: 'org_1',
              projectId: 'project_1',
              sessionId: 'session_1',
              sequence: 1,
              type: 'lifecycle',
              visibility: 'audit',
              role: null,
              parentEventId: null,
              correlationId: null,
              payload: { status: 'idle', reason: 'runtime_ready' },
              metadata: {},
              createdAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        })
      }
      if (url.startsWith('/api/sessions')) {
        return jsonResponse({ data: [sessionFixture] })
      }
      if (url === '/runtime/sessions/session_1/rpc') {
        return await runtimeFetch(input, init)
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Control Plane')).toBeTruthy())
    fireEvent.click(primaryNav().getByRole('link', { name: 'Sessions' }))

    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('/runtime/sessions/session_1/rpc')).toBeTruthy()
    expect(await screen.findByText(/runtime_ready/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))

    await waitFor(() => expect(runtimeFetch).toHaveBeenCalled())
    expect(runtimeFetch.mock.calls[0]?.[0]).toBe('/runtime/sessions/session_1/rpc')
    expect(runtimeFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
    expect(await screen.findByText(/agent_end/)).toBeTruthy()
  })
})

const environmentFixture = {
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
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

const agentFixture = {
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
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}

const sessionFixture = {
  id: 'session_1',
  organizationId: 'org_1',
  projectId: 'project_1',
  agentId: 'agent_1',
  agentVersionId: 'agentver_1',
  agentSnapshot: {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    instructions: 'Do the task',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    systemPrompt: 'Do the task',
    allowedTools: ['read', 'write'],
    mcpConnectors: [],
    sandboxPolicy: { network: 'enabled' },
    defaultEnvironmentId: 'env_1',
    metadata: {},
    createdAt: '2026-05-23T00:00:00.000Z',
  },
  environmentId: 'env_1',
  environmentVersionId: 'envver_1',
  environmentSnapshot: null,
  durableObjectName: 'session_1',
  sandboxId: 'session_1',
  piRuntimeId: 'pi_session_1',
  piProcessId: 'proc_session_1',
  runtimeEndpointPath: '/runtime/sessions/session_1/rpc',
  agentUrl: '/agents/managed-agent/session_1',
  modelProvider: 'workers-ai',
  modelConfig: { model: '@cf/moonshotai/kimi-k2.6' },
  status: 'idle',
  statusReason: null,
  metadata: {},
  startedAt: '2026-05-23T00:00:00.000Z',
  stoppedAt: null,
  archivedAt: null,
  createdAt: '2026-05-23T00:00:00.000Z',
  updatedAt: '2026-05-23T00:00:00.000Z',
}
