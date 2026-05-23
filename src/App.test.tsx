import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ error: { message: 'Authentication required' } }, 401),
    )

    render(<App />)

    expect(await screen.findByText('Continue with FlareAuth')).toBeTruthy()
    expect(screen.getByText('Sign in through FlareAuth to open the control plane.')).toBeTruthy()
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
})
