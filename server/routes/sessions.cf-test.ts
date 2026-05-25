import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, setupFlareAuth, signIn } from '../test/auth'

async function jsonFetch(path: string, cookie: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      cookie,
      ...init.headers,
    },
  })
}

async function createEnvironment(cookie: string) {
  const res = await jsonFetch('/api/environments', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pi workspace',
      packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
      secretRefs: [{ name: 'CLOUDFLARE_API_KEY', ref: 'wrangler_secret:AMA_WORKERS_AI_API_KEY' }],
      mcpPolicy: { allowedConnectors: ['github'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      runtimeImage: { image: 'ama-pi-runtime' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(cookie: string) {
  const res = await jsonFetch('/api/agents', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pi session agent',
      instructions: 'Work through Pi.',
      allowedTools: ['mcp:github.repo.read'],
      mcpConnectors: ['github'],
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; currentVersionId: string }
}

async function connectMcp(cookie: string, connectorId: string) {
  const vaultRes = await jsonFetch('/api/vaults', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: `${connectorId} credentials` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: `${connectorId} token`,
      type: 'api_key',
      connectorBinding: { connectorId, name: 'token' },
      secret: { provider: 'cloudflare-secrets', secretValue: `raw-${connectorId}-token` },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as { id: string; activeVersionId: string }
  const connectRes = await jsonFetch('/api/mcp/connections', cookie, {
    method: 'POST',
    body: JSON.stringify({
      connectorId,
      credentialId: credential.id,
      credentialVersionId: credential.activeVersionId,
    }),
  })
  expect([200, 201]).toContain(connectRes.status)
}

describe('[CF] /api/sessions', () => {
  beforeEach(async () => {
    await setupFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, reads, lists, reconnects, stops, archives, and records events for a Pi-backed session', async () => {
    const cookie = await signIn()
    await connectMcp(cookie, 'github')
    await connectMcp(cookie, 'linear')
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie)

    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        title: 'Ship the first task',
        metadata: { ticket: 'AMA-1' },
        resourceRefs: [{ type: 'repository', id: 'repo_1' }],
        vaultRefs: [{ type: 'credential', id: 'cred_1' }],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      status: string
      agentVersionId: string
      agentSnapshot: { instructions: string; mcpConnectors: string[] }
      environmentVersionId: string
      environmentSnapshot: {
        mcpPolicy: Record<string, unknown>
        packageManagerPolicy: Record<string, unknown>
      }
      sandboxId: string
      piRuntimeId: string
      piProcessId: string
      runtimeEndpointPath: string
      startedAt: string
      title: string
      resourceRefs: Array<Record<string, unknown>>
      vaultRefs: Array<Record<string, unknown>>
      metadata: Record<string, unknown>
      modelConfig: Record<string, unknown>
    }
    expect(created).toMatchObject({
      title: 'Ship the first task',
      status: 'idle',
      agentVersionId: agent.currentVersionId,
      agentSnapshot: { instructions: 'Work through Pi.', mcpConnectors: ['github'] },
      environmentSnapshot: {
        mcpPolicy: { allowedConnectors: ['github'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      },
      sandboxId: created.id.toLowerCase(),
      piRuntimeId: `pi_${created.id}`,
      piProcessId: `proc_${created.id}`,
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
      resourceRefs: [{ type: 'repository', id: 'repo_1' }],
      vaultRefs: [{ type: 'credential', id: 'cred_1' }],
      metadata: {
        ticket: 'AMA-1',
        runtime: 'pi',
        protocol: 'pi-rpc-jsonl',
        runtimeMode: 'test',
        bridge: 'fake',
        mcpConnectors: ['github'],
      },
      modelConfig: { provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' },
    })
    expect(created.environmentVersionId).toMatch(/^envver_/)
    expect(created.startedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/sessions', cookie)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const readRes = await jsonFetch(`/api/sessions/${created.id}`, cookie)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, status: 'idle' })

    const reconnectRes = await jsonFetch(`/api/sessions/${created.id}/reconnect`, cookie)
    expect(reconnectRes.status).toBe(200)
    await expect(reconnectRes.json()).resolves.toMatchObject({
      id: created.id,
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
    })

    const taskRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, cookie, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        message: 'Inspect repository status',
        toolCalls: [
          {
            id: 'call_git_status',
            name: 'sandbox.exec',
            input: { command: 'git status', token: 'raw-github-token' },
            output: { stdout: 'clean', apiKey: 'secret-key' },
            durationMs: 42,
          },
          {
            id: 'call_failed_tool',
            name: 'mcp.github.repo.read',
            input: { repository: 'saltbo/any-managed-agents', password: 'secret-password' },
            error: { type: 'tool_error', message: 'Repository not found', secret: 'raw-secret-token' },
            approvalState: 'approved',
            durationMs: 7,
          },
        ],
      }),
    })
    expect(taskRes.status).toBe(200)
    await expect(taskRes.json()).resolves.toMatchObject({
      sandboxId: created.id.toLowerCase(),
      path: '/rpc',
      proxy: 'pi',
    })
    const afterTaskRes = await jsonFetch(`/api/sessions/${created.id}`, cookie)
    await expect(afterTaskRes.json()).resolves.toMatchObject({ id: created.id, status: 'idle' })

    const stopRes = await jsonFetch(`/api/sessions/${created.id}/stop`, cookie, { method: 'POST' })
    expect(stopRes.status).toBe(200)
    const stopped = (await stopRes.json()) as { status: string; stoppedAt: string }
    expect(stopped.status).toBe('stopped')
    expect(stopped.stoppedAt).toEqual(expect.any(String))

    const eventsRes = await jsonFetch(`/api/sessions/${created.id}/events`, cookie)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{
        sequence: number
        type: string
        visibility: string
        payload: Record<string, unknown>
        metadata: Record<string, unknown>
        parentEventId: string | null
        correlationId: string | null
      }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(events.data.map((event) => event.sequence)).toEqual(events.data.map((_, index) => index + 1))
    expect(events.pagination).toMatchObject({ limit: 100, hasMore: false, nextCursor: null })
    expect(events.data.map((event) => event.type)).toEqual([
      'tool_execution_start',
      'tool_execution_end',
      'tool_execution_start',
      'tool_execution_end',
      'message_end',
      'usage',
    ])
    expect(events.data.every((event) => event.visibility === 'runtime')).toBe(true)
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message_end',
          payload: { type: 'message_end', message: { role: 'assistant', content: 'Message accepted by Pi runtime.' } },
        }),
        expect.objectContaining({
          type: 'tool_execution_end',
          payload: expect.objectContaining({
            type: 'tool_execution_end',
            toolCall: expect.objectContaining({
              id: 'call_git_status',
              name: 'sandbox.exec',
              durationMs: 42,
              output: { stdout: 'clean', apiKey: '[REDACTED]' },
            }),
          }),
        }),
        expect.objectContaining({
          type: 'tool_execution_end',
          payload: expect.objectContaining({
            type: 'tool_execution_end',
            toolCall: expect.objectContaining({
              id: 'call_failed_tool',
              name: 'mcp.github.repo.read',
              durationMs: 7,
              error: { type: 'tool_error', message: 'Repository not found', secret: '[REDACTED]' },
            }),
          }),
        }),
      ]),
    )
    const toolCallEvent = events.data.find(
      (event) =>
        event.type === 'tool_execution_start' &&
        (event.payload.toolCall as { id?: string } | undefined)?.id === 'call_git_status',
    )
    const toolResultEvent = events.data.find(
      (event) =>
        event.type === 'tool_execution_end' &&
        (event.payload.toolCall as { id?: string } | undefined)?.id === 'call_git_status',
    )
    expect(toolCallEvent).toMatchObject({
      correlationId: null,
      parentEventId: null,
      payload: expect.objectContaining({
        type: 'tool_execution_start',
        toolCall: expect.objectContaining({ input: { command: 'git status', token: '[REDACTED]' } }),
      }),
    })
    expect(toolResultEvent).toMatchObject({
      correlationId: null,
      parentEventId: null,
    })
    expect(JSON.stringify(events.data)).not.toContain('raw-secret')
    expect(JSON.stringify(events.data)).not.toContain('raw-github-token')
    expect(JSON.stringify(events.data)).not.toContain('secret-password')
    expect(JSON.stringify(events.data)).not.toContain('flareauth-access-token')

    const pagedEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?limit=1`, cookie)
    const pagedEvents = (await pagedEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(pagedEvents.data).toEqual([expect.objectContaining({ sequence: 1, type: 'tool_execution_start' })])
    expect(pagedEvents.pagination).toMatchObject({ hasMore: true, nextCursor: '1' })

    const cursorEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?cursor=1&limit=2`, cookie)
    const cursorEvents = (await cursorEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: {
        limit: number
        hasMore: boolean
        nextCursor: string | null
        firstId: string | null
        lastId: string | null
      }
    }
    expect(cursorEvents.data.map((event) => event.sequence)).toEqual([2, 3])
    expect(cursorEvents.pagination).toMatchObject({
      limit: 2,
      hasMore: true,
      nextCursor: '3',
      firstId: '2',
      lastId: '3',
      firstSequence: 2,
      lastSequence: 3,
    })

    const descendingEventsRes = await jsonFetch(
      `/api/sessions/${created.id}/events?order=desc&cursor=6&limit=2`,
      cookie,
    )
    const descendingEvents = (await descendingEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(descendingEvents.data.map((event) => event.sequence)).toEqual([5, 4])

    const latestEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?order=desc&limit=2`, cookie)
    const latestEvents = (await latestEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(latestEvents.data.map((event) => event.sequence)).toEqual([6, 5])

    const filteredEventsRes = await jsonFetch(
      `/api/sessions/${created.id}/events?cursor=1&type=tool_execution_end`,
      cookie,
    )
    const filteredEvents = (await filteredEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(filteredEvents.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ sequence: 2, type: 'tool_execution_end' })]),
    )

    const exportRes = await jsonFetch(`/api/sessions/${created.id}/events/export?cursor=2&limit=2`, cookie)
    expect(exportRes.status).toBe(200)
    expect(exportRes.headers.get('content-type')).toContain('application/x-ndjson')
    const exported = (await exportRes.text()).trim().split('\n').map(JSON.parse) as Array<{ sequence: number }>
    expect(exported.map((event) => event.sequence)).toEqual([3, 4])

    const descendingExportRes = await jsonFetch(
      `/api/sessions/${created.id}/events/export?order=desc&cursor=6&limit=2`,
      cookie,
    )
    expect(descendingExportRes.status).toBe(200)
    const descendingExported = (await descendingExportRes.text()).trim().split('\n').map(JSON.parse) as Array<{
      sequence: number
    }>
    expect(descendingExported.map((event) => event.sequence)).toEqual([5, 4])

    const streamRes = await jsonFetch(`/api/sessions/${created.id}/events/stream?cursor=4`, cookie)
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('application/x-ndjson')
    const streamed = (await streamRes.text()).trim().split('\n').map(JSON.parse) as Array<{ sequence: number }>
    expect(streamed.map((event) => event.sequence)).toEqual([5, 6])

    const descendingStreamRes = await jsonFetch(`/api/sessions/${created.id}/events/stream?order=desc`, cookie)
    expect(descendingStreamRes.status).toBe(400)

    const inactiveRuntimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, cookie)
    expect(inactiveRuntimeRes.status).toBe(409)
    await expect(inactiveRuntimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Session runtime is not active',
      },
    })

    const archiveRes = await jsonFetch(`/api/sessions/${created.id}`, cookie, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const archivedRuntimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, cookie)
    expect(archivedRuntimeRes.status).toBe(409)
    await expect(archivedRuntimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Session runtime is not active',
      },
    })

    const archivedListRes = await jsonFetch('/api/sessions?includeArchived=true', cookie)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))
  })

  it('lists sessions with pagination, status, search, and date filters', async () => {
    const cookie = await signIn()
    await connectMcp(cookie, 'github')
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie)

    const firstRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const first = (await firstRes.json()) as { id: string; agentId: string; createdAt: string }
    const secondRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const second = (await secondRes.json()) as { id: string; agentId: string; createdAt: string }

    const pagedRes = await jsonFetch('/api/sessions?limit=1', cookie)
    const paged = (await pagedRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/sessions?limit=1&cursor=${paged.pagination.nextCursor}`, cookie)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((session) => session.id)).not.toEqual(paged.data.map((session) => session.id))

    const statusRes = await jsonFetch('/api/sessions?status=idle', cookie)
    const statusList = (await statusRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(statusList.data.map((session) => session.status)).toEqual(['idle', 'idle'])

    const searchRes = await jsonFetch(`/api/sessions?search=${agent.id}`, cookie)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))

    const dateRes = await jsonFetch(
      `/api/sessions?createdFrom=${encodeURIComponent(first.createdAt)}&createdTo=${encodeURIComponent(second.createdAt)}`,
      cookie,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('enforces auth and project tenancy for session lifecycle', async () => {
    const unauthenticatedRes = await SELF.fetch('https://example.com/api/sessions')
    expect(unauthenticatedRes.status).toBe(401)

    const cookie = await signIn()
    await connectMcp(cookie, 'github')
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie)
    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const created = (await createRes.json()) as { id: string }

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })
    const crossProjectReads = await Promise.all([
      jsonFetch(`/api/sessions/${created.id}`, otherCookie),
      jsonFetch(`/api/sessions/${created.id}/reconnect`, otherCookie),
      jsonFetch(`/api/sessions/${created.id}/events`, otherCookie),
      jsonFetch(`/api/sessions/${created.id}/stop`, otherCookie, { method: 'POST' }),
      jsonFetch(`/api/sessions/${created.id}`, otherCookie, { method: 'DELETE' }),
      jsonFetch(`/runtime/sessions/${created.id}/rpc`, otherCookie),
    ])
    expect(crossProjectReads.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404])

    const runtimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, cookie)
    expect(runtimeRes.status).toBe(200)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      sandboxId: created.id.toLowerCase(),
      path: '/rpc',
      proxy: 'pi',
    })
  })

  it('records safe runtime errors without leaking secrets', async () => {
    const cookie = await signIn()
    await connectMcp(cookie, 'github')
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie)
    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const created = (await createRes.json()) as { id: string }

    const taskRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, cookie, {
      method: 'POST',
      body: JSON.stringify({
        message: 'Trigger failure',
        simulateError: true,
        errorMessage: 'Provider failed with token=raw-secret-token',
      }),
    })
    expect(taskRes.status).toBe(200)

    const readRes = await jsonFetch(`/api/sessions/${created.id}`, cookie)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      status: 'error',
      statusReason: '[REDACTED]',
    })

    const eventsRes = await jsonFetch(`/api/sessions/${created.id}/events?type=error`, cookie)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as { data: Array<{ payload: Record<string, unknown> }> }
    expect(events.data).toHaveLength(1)
    expect(events.data[0]?.payload).toMatchObject({ type: 'error', message: '[REDACTED]' })
    expect(JSON.stringify(events.data)).not.toContain('token=raw-secret-token')
  })

  it('rereads stored snapshots after agent and environment updates', async () => {
    const cookie = await signIn()
    await connectMcp(cookie, 'github')
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie)

    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const created = (await createRes.json()) as {
      id: string
      agentSnapshot: { instructions: string; version: number; mcpConnectors: string[] }
      environmentSnapshot: {
        packages: Array<{ name: string; version?: string }>
        mcpPolicy: Record<string, unknown>
        packageManagerPolicy: Record<string, unknown>
      }
    }

    await jsonFetch(`/api/environments/${environment.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    await jsonFetch(`/api/agents/${agent.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'Updated instructions.' }),
    })

    const rereadRes = await jsonFetch(`/api/sessions/${created.id}`, cookie)
    expect(rereadRes.status).toBe(200)
    await expect(rereadRes.json()).resolves.toMatchObject({
      id: created.id,
      agentSnapshot: { instructions: 'Work through Pi.', version: 1, mcpConnectors: ['github'] },
      environmentSnapshot: {
        packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
        mcpPolicy: { allowedConnectors: ['github'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      },
    })
  })
})
