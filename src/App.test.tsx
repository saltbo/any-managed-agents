import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

  it('renders the v1 console workflow when signed in', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
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
        return jsonResponse({
          data: [
            {
              id: 'agent_1',
              projectId: 'project_1',
              name: 'Coding agent',
              description: 'Runs tasks',
              instructions: 'Do the task',
              provider: 'workers-ai',
              model: '@cf/moonshotai/kimi-k2.6',
              systemPrompt: 'Do the task',
              allowedTools: ['read', 'write'],
              sandboxPolicy: { network: 'enabled' },
              defaultEnvironmentId: 'env_1',
              metadata: {},
              status: 'active',
              currentVersionId: 'agentver_1',
              version: 1,
              createdAt: '2026-05-23T00:00:00.000Z',
              updatedAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        })
      }
      if (url.startsWith('/api/environments')) {
        return jsonResponse({
          data: [
            {
              id: 'env_1',
              projectId: 'project_1',
              name: 'Node workspace',
              description: 'Runtime',
              packages: [{ name: 'tsx', version: 'latest' }],
              variables: { NODE_ENV: { description: 'mode', required: false } },
              secretRefs: [],
              networkPolicy: { mode: 'restricted' },
              resourceLimits: { memoryMb: 1024 },
              runtimeImage: { image: 'node:24' },
              metadata: {},
              status: 'active',
              currentVersionId: 'envver_1',
              version: 1,
              createdAt: '2026-05-23T00:00:00.000Z',
              updatedAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        })
      }
      if (url.startsWith('/api/sessions')) {
        return jsonResponse({ data: [] })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText('Control Plane')).toBeTruthy())
    expect(screen.getByText('Coding agent')).toBeTruthy()
    expect(screen.getAllByText('Node workspace').length).toBeGreaterThan(0)
    expect(screen.getByText('Create environment')).toBeTruthy()
    expect(screen.getByText('Create agent')).toBeTruthy()
  })

  it('renders sessions, runtime events, and sends tasks through the runtime endpoint', async () => {
    const runtimeFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ accepted: true }),
    )
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
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(await screen.findByText('Session detail')).toBeTruthy()
    expect(screen.getByText('/runtime/sessions/session_1/rpc')).toBeTruthy()
    expect(screen.getByText(/runtime_ready/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send task' }))

    await waitFor(() => expect(runtimeFetch).toHaveBeenCalled())
    expect(runtimeFetch.mock.calls[0]?.[0]).toBe('/runtime/sessions/session_1/rpc')
    expect(runtimeFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
    })
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
  resourceLimits: { memoryMb: 1024 },
  runtimeImage: { image: 'node:24' },
  metadata: {},
  status: 'active',
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
  sandboxPolicy: { network: 'enabled' },
  defaultEnvironmentId: 'env_1',
  metadata: {},
  status: 'active',
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
