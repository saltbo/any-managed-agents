import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runtimeProviderModelCapability } from '../runtime/catalog'
import { defaultClaims, expectAuthRequired, setupOidcProvider, signIn, signInFederatedRunner } from '../test/auth'

const DEFAULT_AMA_RUNNER_CAPABILITY = runtimeProviderModelCapability('ama', 'workers-ai', '@cf/moonshotai/kimi-k2.6')

function objectValue(value: unknown) {
  expect(value).toBeTruthy()
  expect(typeof value).toBe('object')
  return value as Record<string, unknown>
}

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

async function createSelfHostedEnvironment(authorization: string) {
  const res = await jsonFetch('/api/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Self-hosted workspace ${crypto.randomUUID()}`,
      hostingMode: 'self_hosted',
      runtime: 'ama',
      networkPolicy: { mode: 'unrestricted' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Runner-backed agent ${crypto.randomUUID()}`,
      instructions: 'Use AMA-owned self-hosted runner work.',
      allowedTools: ['sandbox.exec'],
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createSelfHostedSession(authorization: string, agentId: string, environmentId: string) {
  const res = await jsonFetch('/api/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      environmentId,
      initialPrompt: 'Run the first queued self-hosted task.',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; status: string; statusReason: string; sandboxId: string | null }
}

async function openRunnerSessionChannel(authorization: string, runnerId: string, leaseId: string) {
  const res = await SELF.fetch(`https://example.com/api/runners/${runnerId}/leases/${leaseId}/channel`, {
    headers: { authorization, upgrade: 'websocket' },
  })
  expect(res.status).toBe(101)
  expect(res.webSocket).toBeTruthy()
  const socket = res.webSocket as WebSocket
  socket.accept()
  return socket
}

function collectMessages(socket: WebSocket) {
  const messages: Array<Record<string, unknown>> = []
  socket.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as Record<string, unknown>)
  })
  return messages
}

async function waitForMessages(messages: Array<Record<string, unknown>>, count: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (messages.length >= count) {
      return messages
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return messages
}

describe('[CF] /api/runners', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('registers a runner, records heartbeats, leases queued self-hosted work, uploads events, and completes work', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)

    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local runner',
        environmentId: environment.id,
        capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
        credentialSecretRef: 'cloudflare-secret:self-hosted-runner-token',
        maxConcurrent: 2,
        metadata: { pool: 'default' },
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as {
      id: string
      status: string
      environmentId: string
      capabilities: string[]
      credentialSecretRef?: string
    }
    expect(runner).toMatchObject({
      status: 'offline',
      environmentId: environment.id,
      capabilities: ['node', 'git', 'sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })
    expect(runner.credentialSecretRef).toBeUndefined()
    expect(JSON.stringify(runner)).not.toContain('self-hosted-runner-token')

    const heartbeatRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['node', 'git', 'sandbox.exec', 'workspace', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(heartbeatRes.status).toBe(200)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      id: runner.id,
      status: 'active',
      currentLoad: 0,
      lastHeartbeatAt: expect.any(String),
    })

    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    expect(session).toMatchObject({
      status: 'pending',
      statusReason: 'waiting-for-runner',
      sandboxId: null,
    })

    const workListRes = await jsonFetch(`/api/runners/work-items?sessionId=${session.id}`, authorization)
    expect(workListRes.status).toBe(200)
    const workList = (await workListRes.json()) as {
      data: Array<{ id: string; status: string; payload: Record<string, unknown> }>
    }
    expect(workList.data).toEqual([
      expect.objectContaining({
        status: 'available',
        payload: expect.objectContaining({
          protocol: 'ama-runner-work',
          type: 'session.start',
          sessionId: session.id,
          hostingMode: 'self_hosted',
          runtime: 'ama',
          runtimeConfig: {},
          runtimeDriver: 'ama-self-hosted',
          provider: 'workers-ai',
          model: '@cf/moonshotai/kimi-k2.6',
          requiredRunnerCapability: DEFAULT_AMA_RUNNER_CAPABILITY,
        }),
      }),
    ])
    expect(JSON.stringify(workList.data)).not.toContain('runtimeOwner')

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as {
      id: string
      status: string
      workItem: { id: string; status: string; attempts: number; sessionId: string }
    }
    expect(lease).toMatchObject({
      status: 'active',
      workItem: {
        status: 'leased',
        attempts: 1,
        sessionId: session.id,
      },
    })

    const claimedSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(claimedSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'pending',
      statusReason: 'waiting-for-runner',
    })

    const channel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const channelMessages = collectMessages(channel)
    await expect(waitForMessages(channelMessages, 1)).resolves.toEqual([
      expect.objectContaining({ type: 'session.channel.accepted', sessionId: session.id }),
    ])

    const runningSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(runningSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'running',
      statusReason: null,
    })

    const eventsRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'tool_execution_start',
            payload: {
              toolCallId: 'call_1',
              toolName: 'sandbox.exec',
              args: { command: 'npm test', token: 'raw-secret-value' },
            },
            metadata: { runnerId: runner.id },
          },
          {
            type: 'usage.recorded',
            payload: {
              provider: 'workers-ai',
              model: '@cf/moonshotai/kimi-k2.6',
              inputTokens: 10,
              outputTokens: 4,
            },
          },
          {
            type: 'runtime.error',
            payload: {
              error: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 2 } },
            },
          },
        ],
      }),
    })
    expect(eventsRes.status).toBe(202)
    await expect(eventsRes.json()).resolves.toEqual({ accepted: 3 })

    const renewRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({
      id: lease.id,
      status: 'active',
      renewedAt: expect.any(String),
    })

    const completeRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)
    await expect(completeRes.json()).resolves.toMatchObject({
      id: lease.id,
      status: 'completed',
      result: { ok: true },
      workItem: { status: 'succeeded' },
    })

    const completedSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(completedSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'idle',
      statusReason: null,
    })

    const commandRes = await jsonFetch(`/api/sessions/${session.id}/commands`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', message: 'Resume through queued runner work.' }),
    })
    expect(commandRes.status).toBe(202)
    await expect(commandRes.json()).resolves.toMatchObject({
      runtime: 'self-hosted-runner',
      accepted: true,
      sessionId: session.id,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(channelMessages).toEqual([
      expect.objectContaining({ type: 'session.channel.accepted', sessionId: session.id }),
    ])
    const queuedCommandSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(queuedCommandSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'pending',
      statusReason: 'waiting-for-runner',
    })
    const resumedWorkRes = await jsonFetch(`/api/runners/work-items?sessionId=${session.id}`, authorization)
    const resumedWork = (await resumedWorkRes.json()) as { data: Array<{ status: string; payload: Record<string, unknown> }> }
    expect(resumedWork.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'available',
          payload: expect.objectContaining({
            type: 'session.start',
            sessionId: session.id,
            resume: true,
            initialPrompt: 'Resume through queued runner work.',
          }),
        }),
      ]),
    )
    channel.close()

    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    expect(sessionEventsRes.status).toBe(200)
    const sessionEvents = (await sessionEventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }>
    }
    expect(sessionEvents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_execution_start',
          metadata: expect.objectContaining({
            source: 'self-hosted-runner',
            runnerId: runner.id,
            leaseId: lease.id,
            runtime: 'ama',
            provider: 'workers-ai',
            model: '@cf/moonshotai/kimi-k2.6',
          }),
        }),
        expect.objectContaining({
          type: 'usage.recorded',
          payload: expect.objectContaining({
            provider: 'workers-ai',
            model: '@cf/moonshotai/kimi-k2.6',
            inputTokens: 10,
            outputTokens: 4,
          }),
        }),
        expect.objectContaining({
          type: 'runtime.error',
          payload: expect.objectContaining({
            message: 'Runtime failed safely',
            code: 'runtime_exit',
            details: { exitCode: 2 },
          }),
        }),
      ]),
    )
    expect(JSON.stringify(sessionEvents.data)).not.toContain('raw-secret-value')
  })

  it('accepts FlareAuth runner tokens and rejects missing, invalid, or mismatched runner tokens', async () => {
    const operatorAuthorization = await signIn()
    const runnerAuthorization = operatorAuthorization.replace('e2e:', 'e2e-runner:')
    const runnerControlPlaneRes = await jsonFetch('/api/environments', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runner token forbidden environment',
        hostingMode: 'self_hosted',
        runtime: 'ama',
        networkPolicy: { mode: 'unrestricted' },
      }),
    })
    expect(runnerControlPlaneRes.status).toBe(403)
    await expect(runnerControlPlaneRes.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this resource' },
    })

    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const agent = await createAgent(operatorAuthorization)
    const bearerRunnerRes = await jsonFetch('/api/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runner token bearer mode bypass',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
        authMode: 'bearer',
      }),
    })
    expect(bearerRunnerRes.status).toBe(400)
    await expect(bearerRunnerRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: { authMode: 'Runner device-login tokens can only register OIDC-authenticated runners.' },
        },
      },
    })

    const runnerRes = await jsonFetch('/api/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'OIDC device runner',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as { id: string; authMode: string }
    expect(runner.authMode).toBe('oidc')

    const readWithOperatorRes = await jsonFetch(`/api/runners/${runner.id}`, operatorAuthorization)
    expect(readWithOperatorRes.status).toBe(403)
    const updateWithOperatorRes = await jsonFetch(`/api/runners/${runner.id}`, operatorAuthorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draining' }),
    })
    expect(updateWithOperatorRes.status).toBe(403)

    const missingAuthRes = await SELF.fetch(`https://example.com/api/runners/${runner.id}/heartbeats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    })
    expect(missingAuthRes.status).toBe(401)
    expectAuthRequired(await missingAuthRes.json())

    const invalidAuthRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, 'Bearer invalid-token', {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    expect(invalidAuthRes.status).toBe(401)
    expectAuthRequired(await invalidAuthRes.json())

    const forbiddenHeartbeat = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    expect(forbiddenHeartbeat.status).toBe(403)
    await expect(forbiddenHeartbeat.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this runner' },
    })

    const heartbeatRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(heartbeatRes.status).toBe(200)

    const session = await createSelfHostedSession(operatorAuthorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const forbiddenEvents = await jsonFetch(
      `/api/runners/${runner.id}/leases/${lease.id}/events`,
      operatorAuthorization,
      {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'tool_execution_start', payload: { toolCallId: 'call_1' } }] }),
      },
    )
    expect(forbiddenEvents.status).toBe(403)

    const missingChannelAuth = await SELF.fetch(
      `https://example.com/api/runners/${runner.id}/leases/${lease.id}/channel`,
      {
        headers: { upgrade: 'websocket' },
      },
    )
    expect(missingChannelAuth.status).toBe(401)
    expectAuthRequired(await missingChannelAuth.json())

    const invalidChannelAuth = await SELF.fetch(
      `https://example.com/api/runners/${runner.id}/leases/${lease.id}/channel`,
      {
        headers: { authorization: 'Bearer invalid-token', upgrade: 'websocket' },
      },
    )
    expect(invalidChannelAuth.status).toBe(401)
    expectAuthRequired(await invalidChannelAuth.json())

    const forbiddenChannelAuth = await SELF.fetch(
      `https://example.com/api/runners/${runner.id}/leases/${lease.id}/channel`,
      {
        headers: { authorization: operatorAuthorization, upgrade: 'websocket' },
      },
    )
    expect(forbiddenChannelAuth.status).toBe(403)
    await expect(forbiddenChannelAuth.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this runner' },
    })

    const channelRes = await SELF.fetch(`https://example.com/api/runners/${runner.id}/leases/${lease.id}/channel`, {
      headers: { authorization: runnerAuthorization, upgrade: 'websocket' },
    })
    expect(channelRes.status).toBe(101)
    const channel = channelRes.webSocket as WebSocket
    channel.accept()
    channel.close()

    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, operatorAuthorization)
    expect(await sessionEventsRes.text()).not.toContain('e2e-runner:')
  })

  it('binds external tenants to projects and accepts only scoped federated runner operations', async () => {
    const operatorAuthorization = await signIn()
    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const projectsRes = await jsonFetch('/api/projects', operatorAuthorization)
    expect(projectsRes.status).toBe(200)
    const projectList = (await projectsRes.json()) as { data: Array<{ id: string }> }
    const projectId = projectList.data[0]?.id
    expect(projectId).toMatch(/^project_/)

    const externalTenantId = `ak-org-${crypto.randomUUID()}`
    const runnerId = `runner_${crypto.randomUUID().replaceAll('-', '')}`
    const federatedAuthorization = signInFederatedRunner(externalTenantId, runnerId, environment.id)

    const unboundRes = await jsonFetch('/api/runners', federatedAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Unbound federated runner' }),
    })
    expect(unboundRes.status).toBe(401)
    expectAuthRequired(await unboundRes.json())

    const bindingRes = await jsonFetch(`/api/projects/${projectId}/external-bindings`, operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        issuer: 'https://ak.e2e.example.com',
        externalTenantId,
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
        metadata: { platform: 'agent-kanban' },
      }),
    })
    expect(bindingRes.status).toBe(201)
    await expect(bindingRes.json()).resolves.toMatchObject({
      issuer: 'https://ak.e2e.example.com',
      externalTenantId,
      projectId,
      environmentId: environment.id,
    })

    const bearerRunnerRes = await jsonFetch('/api/runners', federatedAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Federated bearer bypass', authMode: 'bearer' }),
    })
    expect(bearerRunnerRes.status).toBe(400)
    await expect(bearerRunnerRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: { authMode: 'Federated runner tokens can only register federated runners.' },
        },
      },
    })

    const runnerRes = await jsonFetch('/api/runners', federatedAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Federated AK runner', capabilities: ['ignored-by-token'] }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as {
      id: string
      authMode: string
      projectId: string
      environmentId: string
      capabilities: string[]
    }
    expect(runner).toMatchObject({
      id: runnerId,
      authMode: 'federated',
      projectId,
      environmentId: environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })
    expect(JSON.stringify(runner)).not.toContain('ignored-by-token')

    const restartedRunnerRes = await jsonFetch('/api/runners', federatedAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Federated AK runner restarted', maxConcurrent: 3 }),
    })
    expect(restartedRunnerRes.status).toBe(201)
    await expect(restartedRunnerRes.json()).resolves.toMatchObject({
      id: runnerId,
      name: 'Federated AK runner restarted',
      maxConcurrent: 3,
      authMode: 'federated',
      projectId,
      environmentId: environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })

    const heartbeatRes = await jsonFetch(`/api/runners/${runnerId}/heartbeats`, federatedAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['attempted-escalation'],
      }),
    })
    expect(heartbeatRes.status).toBe(200)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      id: runnerId,
      status: 'active',
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })

    const otherRunnerRes = await jsonFetch('/api/runners', operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Project bearer runner',
        environmentId: environment.id,
        authMode: 'bearer',
      }),
    })
    expect(otherRunnerRes.status).toBe(201)
    const otherRunner = (await otherRunnerRes.json()) as { id: string }
    const forbiddenReadRes = await jsonFetch(`/api/runners/${otherRunner.id}`, federatedAuthorization)
    expect(forbiddenReadRes.status).toBe(403)
    await expect(forbiddenReadRes.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this runner' },
    })

    const forbiddenControlPlaneRes = await jsonFetch('/api/projects', federatedAuthorization)
    expect(forbiddenControlPlaneRes.status).toBe(403)
    await expect(forbiddenControlPlaneRes.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this resource' },
    })
  })

  it('binds external tenants to a non-default project in the same organization', async () => {
    const operatorAuthorization = await signIn()
    const createProjectRes = await jsonFetch('/api/projects', operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Secondary project' }),
    })
    expect(createProjectRes.status).toBe(201)
    const project = (await createProjectRes.json()) as { id: string }
    const externalTenantId = `ak-org-${crypto.randomUUID()}`

    const bindingRes = await jsonFetch(`/api/projects/${project.id}/external-bindings`, operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        issuer: 'https://ak-secondary.e2e.example.com',
        externalTenantId,
        capabilities: ['sandbox.exec'],
        metadata: { platform: 'agent-kanban' },
      }),
    })
    expect(bindingRes.status).toBe(201)
    await expect(bindingRes.json()).resolves.toMatchObject({
      issuer: 'https://ak-secondary.e2e.example.com',
      externalTenantId,
      projectId: project.id,
    })

    const listRes = await jsonFetch(`/api/projects/${project.id}/external-bindings`, operatorAuthorization)
    expect(listRes.status).toBe(200)
    await expect(listRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ externalTenantId, projectId: project.id })],
    })
  })

  it('accepts introspected FlareAuth token-exchange access tokens for federated runner registration', async () => {
    const operatorAuthorization = await signIn()
    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const projectsRes = await jsonFetch('/api/projects', operatorAuthorization)
    const projectList = (await projectsRes.json()) as { data: Array<{ id: string }> }
    const projectId = projectList.data[0]?.id
    const externalTenantId = `ak-org-fatx-${crypto.randomUUID()}`
    const runnerId = `runner_${crypto.randomUUID().replaceAll('-', '')}`
    const token = `fatx_${crypto.randomUUID().replaceAll('-', '')}`

    ;(env as unknown as { OIDC_ISSUER: string }).OIDC_ISSUER = 'https://oidc.test/api/auth'
    ;(env as unknown as { OIDC_INTROSPECTION_CLIENT_ID: string; OIDC_INTROSPECTION_CLIENT_SECRET: string }).OIDC_INTROSPECTION_CLIENT_ID =
      'ama-introspection'
    ;(env as unknown as { OIDC_INTROSPECTION_CLIENT_ID: string; OIDC_INTROSPECTION_CLIENT_SECRET: string }).OIDC_INTROSPECTION_CLIENT_SECRET =
      'ama-introspection-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.pathname === '/api/auth/oauth2/userinfo') {
          return new Response('userinfo unavailable', { status: 401 })
        }
        if (url.pathname === '/api/auth/oauth2/introspect') {
          expect(init?.method).toBe('POST')
          expect((init?.headers as Record<string, string>).authorization).toBe(
            `Basic ${btoa('ama-introspection:ama-introspection-secret')}`,
          )
          const form = new URLSearchParams(String(init?.body))
          expect(form.get('token')).toBe(token)
          return Response.json({
            active: true,
            iss: 'https://ak.example.com',
            sub: `${externalTenantId}:${runnerId}`,
            client_id: 'ak-runner-client',
            scope: 'runner:connect',
            external_tenant_id: externalTenantId,
            ama_runner_id: runnerId,
            ama_environment_id: environment.id,
            runner_capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const bindingRes = await jsonFetch(`/api/projects/${projectId}/external-bindings`, operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        issuer: 'https://ak.example.com',
        externalTenantId,
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(bindingRes.status).toBe(201)

    const runnerAuthorization = `Bearer ${token}`
    const runnerRes = await jsonFetch('/api/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'FlareAuth token-exchange runner' }),
    })
    expect(runnerRes.status).toBe(201)
    await expect(runnerRes.json()).resolves.toMatchObject({
      id: runnerId,
      authMode: 'federated',
      projectId,
      environmentId: environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })

    const forbiddenControlPlaneRes = await jsonFetch('/api/projects', runnerAuthorization)
    expect(forbiddenControlPlaneRes.status).toBe(403)
  })

  it('rejects runner credential secret references that are not safe references', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)

    const rawSecretRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Raw credential runner',
        environmentId: environment.id,
        credentialSecretRef: 'raw-runner-token',
      }),
    })
    expect(rawSecretRes.status).toBe(400)
    const rawSecretBody = await rawSecretRes.json()
    expect(rawSecretBody).toMatchObject({
      error: { type: 'validation_error' },
    })
    expect(JSON.stringify(rawSecretBody)).not.toContain('raw-runner-token')
    const rejectedCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM runners WHERE name = ?')
      .bind('Raw credential runner')
      .first<{ count: number }>()
    expect(rejectedCount?.count).toBe(0)

    const paddedRefRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Padded credential runner',
        environmentId: environment.id,
        credentialSecretRef: ' cloudflare-secret:runner-token ',
      }),
    })
    expect(paddedRefRes.status).toBe(400)

    const safeRefRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Safe credential runner',
        environmentId: environment.id,
        credentialSecretRef: 'cloudflare-secret:runner-token',
      }),
    })
    expect(safeRefRes.status).toBe(201)
    const runner = (await safeRefRes.json()) as { id: string; credentialSecretRef?: string }
    expect(runner.credentialSecretRef).toBeUndefined()
    const persisted = await env.DB.prepare(
      'SELECT credential_secret_ref AS credentialSecretRef FROM runners WHERE id = ?',
    )
      .bind(runner.id)
      .first<{ credentialSecretRef: string | null }>()
    expect(persisted?.credentialSecretRef).toBe('cloudflare-secret:runner-token')
  })

  it('dispatches runtime tool calls over the accepted runner session channel', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Channel runner',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }
    const channel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const channelMessages = collectMessages(channel)
    await waitForMessages(channelMessages, 1)

    const rpcRes = await jsonFetch(`/runtime/sessions/${session.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        toolCalls: [
          {
            id: 'call_channel_1',
            name: 'sandbox.exec',
            input: { command: 'printf ok' },
          },
        ],
      }),
    })
    expect(rpcRes.status).toBe(200)
    await expect(rpcRes.json()).resolves.toMatchObject({ runtime: 'self-hosted-runner', accepted: true })
    await expect(waitForMessages(channelMessages, 2)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session.command',
          sessionId: session.id,
          leaseId: lease.id,
        }),
      ]),
    )

    const command = channelMessages.find((message) => message.type === 'session.command')
    const commandId = String(objectValue(command?.command).id)
    channel.send(
      JSON.stringify({
        type: 'runner.event',
        event: {
          type: 'tool_execution_end',
          payload: {
            toolCallId: 'call_channel_1',
            toolName: 'sandbox.exec',
            stdout: 'ok',
            stderr: '',
            result: { exitCode: 0, stdout: 'ok', stderr: '' },
            isError: false,
            timing: { durationMs: 12 },
            commandId,
          },
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))

    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    const sessionEvents = (await sessionEventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }>
    }
    expect(sessionEvents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_execution_end',
          metadata: expect.objectContaining({
            source: 'self-hosted-runner',
            runnerId: runner.id,
            leaseId: lease.id,
            channelId: expect.stringMatching(/^channel_/),
          }),
        }),
      ]),
    )
    expect(JSON.stringify(sessionEvents.data)).toContain('ok')
    channel.close()
  })

  it('acknowledges accepted runner channel events and rejects invalid channel payloads', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ack runner',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }
    const channel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const channelMessages = collectMessages(channel)
    await waitForMessages(channelMessages, 1)

    channel.send(
      JSON.stringify({
        type: 'runner.event',
        eventId: 'runner_event_ack_1',
        event: {
          type: 'tool_execution_end',
          payload: {
            toolCallId: 'call_ack_1',
            toolName: 'sandbox.exec',
            result: { exitCode: 0, stdout: 'ack-ok', stderr: '' },
            isError: false,
          },
        },
      }),
    )
    await expect(waitForMessages(channelMessages, 2)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'runner.event.accepted', eventId: 'runner_event_ack_1' }),
      ]),
    )

    channel.send(
      JSON.stringify({
        type: 'runner.event',
        eventId: 'runner_event_bad_1',
        event: {
          type: 'tool_execution_end',
        },
      }),
    )
    await expect(waitForMessages(channelMessages, 3)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session.channel.error',
          eventId: 'runner_event_bad_1',
          message: 'Runner session channel failed',
        }),
      ]),
    )

    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    expect(sessionEventsRes.status).toBe(200)
    const sessionEvents = (await sessionEventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown>; metadata: Record<string, unknown> }>
    }
    expect(sessionEvents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_execution_end',
          payload: expect.objectContaining({
            toolCallId: 'call_ack_1',
            toolName: 'sandbox.exec',
            result: { exitCode: 0, stdout: 'ack-ok', stderr: '' },
            isError: false,
          }),
          metadata: expect.objectContaining({
            source: 'self-hosted-runner',
            runnerId: runner.id,
            leaseId: lease.id,
            channelId: expect.stringMatching(/^channel_/),
          }),
        }),
      ]),
    )
    expect(JSON.stringify(sessionEvents.data)).not.toContain('runner_event_bad_1')
    channel.close()
  })

  it('does not dispatch runtime commands to an open channel after lease ownership expires', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Expired ownership runner',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        status: 'active',
        currentLoad: 0,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }
    const channel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const channelMessages = collectMessages(channel)
    await waitForMessages(channelMessages, 1)

    await env.DB.prepare('UPDATE runner_work_leases SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', lease.id)
      .run()

    const rpcRes = await jsonFetch(`/runtime/sessions/${session.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        toolCalls: [{ id: 'call_expired_ownership', name: 'sandbox.exec', input: { command: 'printf stale' } }],
      }),
    })
    expect(rpcRes.status).toBe(409)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(channelMessages).toEqual([
      expect.objectContaining({ type: 'session.channel.accepted', sessionId: session.id }),
    ])

    const channelRow = await env.DB.prepare(
      'SELECT status, close_reason AS closeReason FROM runner_session_channels WHERE lease_id = ?',
    )
      .bind(lease.id)
      .first<{ status: string; closeReason: string }>()
    expect(channelRow).toMatchObject({ status: 'stale', closeReason: 'stale-ownership' })
    const sessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'pending',
      statusReason: 'waiting-for-runner-recovery',
    })
  })

  it('marks broken channels for recovery and rejects stale channel results', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Reconnect runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0, capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY] }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    const lease = (await claimRes.json()) as { id: string }
    const firstChannel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const firstMessages = collectMessages(firstChannel)
    await waitForMessages(firstMessages, 1)
    firstChannel.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const recoverySessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(recoverySessionRes.json()).resolves.toMatchObject({
      status: 'pending',
      statusReason: 'waiting-for-runner-recovery',
    })

    const secondChannel = await openRunnerSessionChannel(authorization, runner.id, lease.id)
    const secondMessages = collectMessages(secondChannel)
    await waitForMessages(secondMessages, 1)
    const reconnectedSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(reconnectedSessionRes.json()).resolves.toMatchObject({ status: 'running', statusReason: null })

    await env.DB.prepare('UPDATE runner_work_leases SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', lease.id)
      .run()
    secondChannel.send(
      JSON.stringify({
        type: 'runner.event',
        event: {
          type: 'tool_execution_end',
          payload: { toolCallId: 'stale_call', toolName: 'sandbox.exec', result: { stdout: 'stale' }, isError: false },
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const replacementRunnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Replacement runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const replacementRunner = (await replacementRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${replacementRunner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0, capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY] }),
    })
    const replacementClaimRes = await jsonFetch(`/api/runners/${replacementRunner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    const replacementLease = (await replacementClaimRes.json()) as { id: string }
    const replacementChannel = await openRunnerSessionChannel(authorization, replacementRunner.id, replacementLease.id)
    replacementChannel.send(
      JSON.stringify({
        type: 'runner.event',
        event: {
          type: 'tool_execution_end',
          payload: { toolCallId: 'fresh_call', toolName: 'sandbox.exec', result: { stdout: 'fresh' }, isError: false },
        },
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    const sessionEventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    const body = await sessionEventsRes.text()
    expect(body).toContain('fresh')
    expect(body).not.toContain('stale_call')
    secondChannel.close()
    replacementChannel.close()
  })

  it('does not accept a runner channel for a session that is no longer waiting', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Archived session runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0, capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY] }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({ leaseDurationSeconds: 90 }),
    })
    const lease = (await claimRes.json()) as { id: string }
    await env.DB.prepare('UPDATE sessions SET status = ?, archived_at = ?, updated_at = ? WHERE id = ?')
      .bind('stopped', new Date().toISOString(), new Date().toISOString(), session.id)
      .run()

    const channelRes = await SELF.fetch(`https://example.com/api/runners/${runner.id}/leases/${lease.id}/channel`, {
      headers: { authorization, upgrade: 'websocket' },
    })
    expect(channelRes.status).toBe(409)
    const archivedSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(archivedSessionRes.json()).resolves.toMatchObject({ status: 'stopped' })
  })

  it('skips queued work when runner capabilities do not exactly match the required runtime provider model', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const exactCapability = runtimeProviderModelCapability('codex', 'provider_codex', 'gpt-5.3-codex')
    const nearCapability = runtimeProviderModelCapability('codex', 'provider_codex', 'gpt-5.3-codex-mini')

    const wrongRunnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Near-match runner',
        environmentId: environment.id,
        capabilities: [nearCapability],
      }),
    })
    expect(wrongRunnerRes.status).toBe(201)
    const wrongRunner = (await wrongRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${wrongRunner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', capabilities: [nearCapability] }),
    })

    const exactRunnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Exact-match runner',
        environmentId: environment.id,
        capabilities: [exactCapability],
      }),
    })
    expect(exactRunnerRes.status).toBe(201)
    const exactRunner = (await exactRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${exactRunner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', capabilities: [exactCapability] }),
    })

    const environmentRow = await env.DB.prepare('SELECT project_id AS projectId FROM environments WHERE id = ?')
      .bind(environment.id)
      .first<{ projectId: string }>()
    expect(environmentRow?.projectId).toEqual(expect.any(String))

    const timestamp = new Date().toISOString()
    const workId = `work_${crypto.randomUUID().replaceAll('-', '')}`
    await env.DB.prepare(
      `INSERT INTO runner_work_items (
        id, organization_id, project_id, session_id, environment_id, runner_id, lease_id,
        type, status, priority, attempts, max_attempts, payload, result, error,
        available_at, lease_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
    )
      .bind(
        workId,
        defaultClaims().org_id,
        environmentRow?.projectId,
        environment.id,
        'session.start',
        'available',
        0,
        0,
        3,
        JSON.stringify({ requiredRunnerCapability: exactCapability }),
        timestamp,
        timestamp,
        timestamp,
      )
      .run()

    const wrongLeaseRes = await jsonFetch(`/api/runners/${wrongRunner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(wrongLeaseRes.status).toBe(204)

    const exactLeaseRes = await jsonFetch(`/api/runners/${exactRunner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(exactLeaseRes.status).toBe(201)
    await expect(exactLeaseRes.json()).resolves.toMatchObject({
      workItem: {
        id: workId,
        status: 'leased',
      },
    })
  })

  it('does not treat session start work without an exact runtime provider model capability as wildcard work', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)

    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Wildcard guard runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY] }),
    })

    const environmentRow = await env.DB.prepare('SELECT project_id AS projectId FROM environments WHERE id = ?')
      .bind(environment.id)
      .first<{ projectId: string }>()
    const timestamp = new Date().toISOString()
    await env.DB.prepare(
      `INSERT INTO runner_work_items (
        id, organization_id, project_id, session_id, environment_id, runner_id, lease_id,
        type, status, priority, attempts, max_attempts, payload, result, error,
        available_at, lease_expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)`,
    )
      .bind(
        `work_${crypto.randomUUID().replaceAll('-', '')}`,
        defaultClaims().org_id,
        environmentRow?.projectId,
        environment.id,
        'session.start',
        'available',
        0,
        0,
        3,
        JSON.stringify({ protocol: 'ama-runner-work', type: 'session.start' }),
        timestamp,
        timestamp,
        timestamp,
      )
      .run()

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(204)
  })

  it('returns expired runner leases to available work predictably', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Expiry runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string; workItem: { id: string } }
    await env.DB.prepare('UPDATE runner_work_leases SET expires_at = ? WHERE id = ?')
      .bind('2000-01-01T00:00:00.000Z', lease.id)
      .run()

    const listRes = await jsonFetch(`/api/runners/work-items?sessionId=${session.id}`, authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string; status: string; leaseId: string | null }> }
    expect(list.data).toEqual([
      expect.objectContaining({
        id: lease.workItem.id,
        status: 'available',
        leaseId: null,
      }),
    ])
    const releasedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(releasedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 0 })

    const reclaimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(reclaimRes.status).toBe(201)
    const readSessionRes = await jsonFetch(`/api/sessions/${session.id}`, authorization)
    await expect(readSessionRes.json()).resolves.toMatchObject({
      id: session.id,
      status: 'pending',
      statusReason: 'waiting-for-runner',
    })
  })

  it('does not let disabled runners heartbeat themselves active or claim work', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Disabled runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const disableRes = await jsonFetch(`/api/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const heartbeatRes = await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    expect(heartbeatRes.status).toBe(409)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Disabled runners cannot heartbeat until re-enabled by an operator',
      },
    })

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(409)
  })

  it('rejects stale leases that no longer own the work item', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Ownership runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active' }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const claimRes = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string; workItem: { id: string } }
    await env.DB.prepare('UPDATE runner_work_items SET lease_id = ? WHERE id = ?')
      .bind('lease_other', lease.workItem.id)
      .run()

    const eventsRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [{ type: 'tool_execution_start', payload: { toolCallId: 'call_1', toolName: 'sandbox.exec' } }],
      }),
    })
    expect(eventsRes.status).toBe(409)

    const renewRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(409)

    const completeRes = await jsonFetch(`/api/runners/${runner.id}/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(409)
    const leaseRow = await env.DB.prepare('SELECT status FROM runner_work_leases WHERE id = ?').bind(lease.id).first()
    expect(leaseRow?.status).toBe('active')
  })

  it('keeps runner capacity bounded when concurrent claims race', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Capacity runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
        maxConcurrent: 1,
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0 }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const [first, second] = await Promise.all([
      jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    ])
    expect([first.status, second.status].sort()).toEqual([201, 204])
    const leases = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM runner_work_leases WHERE runner_id = ? AND status = ?',
    )
      .bind(runner.id, 'active')
      .first<{ count: number }>()
    expect(leases?.count).toBe(1)
    const updatedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(updatedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 1 })
  })

  it('increments runner load from the database value across multiple claims', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runnerRes = await jsonFetch('/api/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Two slot capacity runner',
        environmentId: environment.id,
        capabilities: [DEFAULT_AMA_RUNNER_CAPABILITY],
        maxConcurrent: 2,
      }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    await jsonFetch(`/api/runners/${runner.id}/heartbeats`, authorization, {
      method: 'POST',
      body: JSON.stringify({ status: 'active', currentLoad: 0 }),
    })
    await createSelfHostedSession(authorization, agent.id, environment.id)
    await createSelfHostedSession(authorization, agent.id, environment.id)

    const first = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const second = await jsonFetch(`/api/runners/${runner.id}/leases`, authorization, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const updatedRunnerRes = await jsonFetch(`/api/runners/${runner.id}`, authorization)
    await expect(updatedRunnerRes.json()).resolves.toMatchObject({ currentLoad: 2 })
  })

  it('accepts federated runner tokens only when the external tenant is bound to the project', async () => {
    const operatorAuthorization = await signIn()
    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const projectsRes = await jsonFetch('/api/projects', operatorAuthorization)
    expect(projectsRes.status).toBe(200)
    const projectsBody = (await projectsRes.json()) as { data: Array<{ id: string }> }
    const projectId = projectsBody.data[0].id

    const bindingRes = await jsonFetch(`/api/projects/${projectId}/external-bindings`, operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        issuer: 'https://ak.e2e.example.com',
        externalTenantId: 'ak_org_1',
        environmentId: environment.id,
        capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
      }),
    })
    expect(bindingRes.status).toBe(201)

    const runnerAuthorization = signInFederatedRunner('ak_org_1', 'runner_federated_1', environment.id)
    const forbiddenControlPlaneRes = await jsonFetch('/api/agents', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runner token forbidden agent',
        instructions: 'Must not be created',
      }),
    })
    expect(forbiddenControlPlaneRes.status).toBe(403)
    await expect(forbiddenControlPlaneRes.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Runner token is not authorized for this resource' },
    })

    const runnerRes = await jsonFetch('/api/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Federated AK runner',
      }),
    })
    expect(runnerRes.status).toBe(201)
    await expect(runnerRes.json()).resolves.toMatchObject({
      id: 'runner_federated_1',
      authMode: 'federated',
      environmentId: environment.id,
      capabilities: ['sandbox.exec', DEFAULT_AMA_RUNNER_CAPABILITY],
    })

    const unboundRunnerRes = await jsonFetch('/api/runners', signInFederatedRunner('ak_org_missing', 'runner_missing'), {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unbound federated runner',
      }),
    })
    expect(unboundRunnerRes.status).toBe(401)
  })
})
