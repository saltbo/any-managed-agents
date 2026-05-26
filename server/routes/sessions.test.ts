import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, setupOidcProvider, signIn } from '../test/auth'
import { runtimeErrorMessage } from './sessions'

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

async function createEnvironment(authorization: string) {
  const res = await jsonFetch('/api/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Pi workspace ${crypto.randomUUID()}`,
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

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/agents', authorization, {
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

async function connectMcp(authorization: string, connectorId: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `${connectorId} credentials` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
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
  const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
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
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, reads, lists, reconnects, stops, archives, and records events for a Pi-backed session', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    await connectMcp(authorization, 'linear')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/sessions', authorization, {
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

    const listRes = await jsonFetch('/api/sessions', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const readRes = await jsonFetch(`/api/sessions/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, status: 'idle' })

    const reconnectRes = await jsonFetch(`/api/sessions/${created.id}/reconnect`, authorization)
    expect(reconnectRes.status).toBe(200)
    await expect(reconnectRes.json()).resolves.toMatchObject({
      id: created.id,
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
    })

    const taskRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, authorization, {
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
    const afterTaskRes = await jsonFetch(`/api/sessions/${created.id}`, authorization)
    await expect(afterTaskRes.json()).resolves.toMatchObject({ id: created.id, status: 'idle' })

    const stopRes = await jsonFetch(`/api/sessions/${created.id}/stop`, authorization, { method: 'POST' })
    expect(stopRes.status).toBe(200)
    const stopped = (await stopRes.json()) as { status: string; stoppedAt: string }
    expect(stopped.status).toBe('stopped')
    expect(stopped.stoppedAt).toEqual(expect.any(String))

    const eventsRes = await jsonFetch(`/api/sessions/${created.id}/events`, authorization)
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
    expect(JSON.stringify(events.data)).not.toContain('oidc-access-token')

    const pagedEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?limit=1`, authorization)
    const pagedEvents = (await pagedEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(pagedEvents.data).toEqual([expect.objectContaining({ sequence: 1, type: 'tool_execution_start' })])
    expect(pagedEvents.pagination).toMatchObject({ hasMore: true, nextCursor: '1' })

    const cursorEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?cursor=1&limit=2`, authorization)
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
      authorization,
    )
    const descendingEvents = (await descendingEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(descendingEvents.data.map((event) => event.sequence)).toEqual([5, 4])

    const latestEventsRes = await jsonFetch(`/api/sessions/${created.id}/events?order=desc&limit=2`, authorization)
    const latestEvents = (await latestEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(latestEvents.data.map((event) => event.sequence)).toEqual([6, 5])

    const filteredEventsRes = await jsonFetch(
      `/api/sessions/${created.id}/events?cursor=1&type=tool_execution_end`,
      authorization,
    )
    const filteredEvents = (await filteredEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(filteredEvents.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ sequence: 2, type: 'tool_execution_end' })]),
    )

    const exportRes = await jsonFetch(`/api/sessions/${created.id}/events/export?cursor=2&limit=2`, authorization)
    expect(exportRes.status).toBe(200)
    expect(exportRes.headers.get('content-type')).toContain('application/x-ndjson')
    const exportedText = await exportRes.text()
    const exported = exportedText.trim().split('\n').map(JSON.parse) as Array<{ sequence: number }>
    expect(exported.map((event) => event.sequence)).toEqual([3, 4])
    expect(exportedText).toContain('[REDACTED]')
    expect(exportedText).not.toContain('raw-secret')
    expect(exportedText).not.toContain('secret-password')

    const descendingExportRes = await jsonFetch(
      `/api/sessions/${created.id}/events/export?order=desc&cursor=6&limit=2`,
      authorization,
    )
    expect(descendingExportRes.status).toBe(200)
    const descendingExported = (await descendingExportRes.text()).trim().split('\n').map(JSON.parse) as Array<{
      sequence: number
    }>
    expect(descendingExported.map((event) => event.sequence)).toEqual([5, 4])

    const streamRes = await jsonFetch(`/api/sessions/${created.id}/events/stream?cursor=4`, authorization)
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('application/x-ndjson')
    const streamed = (await streamRes.text()).trim().split('\n').map(JSON.parse) as Array<{ sequence: number }>
    expect(streamed.map((event) => event.sequence)).toEqual([5, 6])

    const redactedStreamRes = await jsonFetch(`/api/sessions/${created.id}/events/stream?limit=4`, authorization)
    expect(redactedStreamRes.status).toBe(200)
    const streamedText = await redactedStreamRes.text()
    expect(streamedText).toContain('[REDACTED]')
    expect(streamedText).not.toContain('raw-github-token')
    expect(streamedText).not.toContain('secret-password')

    const descendingStreamRes = await jsonFetch(`/api/sessions/${created.id}/events/stream?order=desc`, authorization)
    expect(descendingStreamRes.status).toBe(400)

    const inactiveRuntimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, authorization)
    expect(inactiveRuntimeRes.status).toBe(409)
    await expect(inactiveRuntimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Session runtime is not active',
      },
    })

    const archiveRes = await jsonFetch(`/api/sessions/${created.id}`, authorization, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const archivedRuntimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, authorization)
    expect(archivedRuntimeRes.status).toBe(409)
    await expect(archivedRuntimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Session runtime is not active',
      },
    })

    const archivedListRes = await jsonFetch('/api/sessions?includeArchived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))
  })

  it('creates a session and dispatches an initial prompt through the API', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        title: 'Scheduled banking bonus research',
        metadata: {
          externalRunId: 'tftt-banking-bonus-2026-05-26',
          source: 'tftt-cron',
        },
        initialPrompt: 'Research current Canadian banking bonus offers.',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      status: string
      metadata: Record<string, unknown>
      runtimeEndpointPath: string
    }
    expect(created).toMatchObject({
      status: 'idle',
      metadata: expect.objectContaining({
        externalRunId: 'tftt-banking-bonus-2026-05-26',
        source: 'tftt-cron',
        runtime: 'pi',
        protocol: 'pi-rpc-jsonl',
      }),
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
    })

    const eventsRes = await jsonFetch(`/api/sessions/${created.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ sequence: number; type: string; payload: Record<string, unknown> }>
    }
    expect(events.data.map((event) => event.sequence)).toEqual(events.data.map((_, index) => index + 1))
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message_end',
          payload: {
            type: 'message_end',
            message: { role: 'assistant', content: 'Received: Research current Canadian banking bonus offers.' },
          },
        }),
        expect.objectContaining({
          type: 'usage',
          payload: expect.objectContaining({ type: 'usage', provider: 'workers-ai' }),
        }),
      ]),
    )

    const auditRes = await jsonFetch('/api/audit-records?action=session.initial_prompt', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<Record<string, unknown>> }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'session.initial_prompt',
          outcome: 'success',
          sessionId: created.id,
        }),
      ]),
    )
  })

  it('validates initial prompt input and redacts runtime failure status reasons', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const invalidRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        initialPrompt: '',
      }),
    })
    expect(invalidRes.status).toBe(400)
    await expect(invalidRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error' },
    })

    expect(
      runtimeErrorMessage({ type: 'response', success: false, error: { message: 'token=raw-secret-token' } }),
    ).toBe('[REDACTED]')
  })

  it('lists sessions with pagination, status, search, and date filters', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const firstRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const first = (await firstRes.json()) as { id: string; agentId: string; createdAt: string }
    const secondRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const second = (await secondRes.json()) as { id: string; agentId: string; createdAt: string }

    const pagedRes = await jsonFetch('/api/sessions?limit=1', authorization)
    const paged = (await pagedRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/sessions?limit=1&cursor=${paged.pagination.nextCursor}`, authorization)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((session) => session.id)).not.toEqual(paged.data.map((session) => session.id))

    const statusRes = await jsonFetch('/api/sessions?status=idle', authorization)
    const statusList = (await statusRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(statusList.data.map((session) => session.status)).toEqual(['idle', 'idle'])

    const searchRes = await jsonFetch(`/api/sessions?search=${agent.id}`, authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))

    const dateRes = await jsonFetch(
      `/api/sessions?createdFrom=${encodeURIComponent(first.createdAt)}&createdTo=${encodeURIComponent(second.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('enforces auth and project tenancy for session lifecycle', async () => {
    const unauthenticatedRes = await SELF.fetch('https://example.com/api/sessions')
    expect(unauthenticatedRes.status).toBe(401)

    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/sessions', authorization, {
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

    const runtimeRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, authorization)
    expect(runtimeRes.status).toBe(200)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      sandboxId: created.id.toLowerCase(),
      path: '/rpc',
      proxy: 'pi',
    })
  })

  it('blocks disabled sandbox startup before creating a runtime', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const policyRes = await jsonFetch('/api/governance/policy', authorization, {
      method: 'PUT',
      body: JSON.stringify({ sandboxPolicy: { enabled: false } }),
    })
    expect(policyRes.status).toBe(200)

    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(createRes.status).toBe(403)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox runtime is disabled by governance policy.',
        details: { category: 'sandbox', resourceType: 'sandbox', ruleId: 'sandboxPolicy.enabled' },
      },
    })

    const auditRes = await jsonFetch('/api/audit-records?action=session.create', authorization)
    expect(auditRes.status).toBe(200)
    const auditRecords = (await auditRes.json()) as { data: Array<Record<string, unknown>> }
    expect(auditRecords.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'session.create',
          outcome: 'denied',
          policyCategory: 'sandbox',
          metadata: expect.objectContaining({
            decision: expect.objectContaining({ rule: 'sandboxPolicy.enabled' }),
          }),
        }),
      ]),
    )
  })

  it('blocks sandbox command policy violations and records redacted policy events', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const policyRes = await jsonFetch('/api/governance/policy', authorization, {
      method: 'PUT',
      body: JSON.stringify({ sandboxPolicy: { blockedCommands: ['curl'] } }),
    })
    expect(policyRes.status).toBe(200)

    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { id: string }

    const runtimeRes = await jsonFetch(`/runtime/sessions/${session.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        message: 'Fetch data',
        toolCalls: [
          {
            name: 'sandbox.exec',
            input: { command: '  curl https://example.com?token=raw-secret-token' },
          },
        ],
      }),
    })
    expect(runtimeRes.status).toBe(403)
    const denied = await runtimeRes.json()
    expect(denied).toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox command is blocked by policy.',
        details: {
          category: 'sandbox_command',
          resourceType: 'sandbox_command',
          ruleId: 'sandboxPolicy.blockedCommands',
        },
      },
    })
    expect(JSON.stringify(denied)).not.toContain('raw-secret-token')

    const directCommandRes = await jsonFetch(`/runtime/sessions/${session.id}/sandbox/exec`, authorization, {
      method: 'POST',
      body: JSON.stringify({ command: 'curl https://example.com?token=raw-secret-token' }),
    })
    expect(directCommandRes.status).toBe(403)
    await expect(directCommandRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox command is blocked by policy.',
        details: { category: 'sandbox_command', resourceType: 'sandbox_command' },
      },
    })

    const malformedCommandRes = await jsonFetch(`/runtime/sessions/${session.id}/sandbox/exec`, authorization, {
      method: 'POST',
      body: JSON.stringify({ argv: ['curl', 'https://example.com'] }),
    })
    expect(malformedCommandRes.status).toBe(403)
    await expect(malformedCommandRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox command is not allowed by policy.',
        details: { category: 'sandbox_command', resourceType: 'sandbox_command' },
      },
    })

    const eventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    const events = (await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }
    expect(events.data).toContainEqual(
      expect.objectContaining({
        type: 'policy_denied',
        payload: expect.objectContaining({
          type: 'policy_denied',
          category: 'sandbox_command',
          ruleId: 'sandboxPolicy.blockedCommands',
          command: '[REDACTED]',
        }),
      }),
    )
    expect(JSON.stringify(events)).not.toContain('raw-secret-token')
  })

  it('blocks sandbox network policy violations and records safe event details', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environmentRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Restricted workspace',
        mcpPolicy: { allowedConnectors: ['github'] },
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }
    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Offline override agent',
        allowedTools: ['mcp:github.repo.read'],
        mcpConnectors: ['github'],
        sandboxPolicy: { network: 'enabled' },
      }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { id: string }

    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { id: string }

    const toolCallRes = await jsonFetch(`/runtime/sessions/${session.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        message: 'Fetch metadata',
        toolCalls: [
          {
            name: 'sandbox.fetch',
            input: { url: 'https://metadata.google.internal/latest', apiKey: 'raw-secret-token' },
          },
        ],
      }),
    })
    expect(toolCallRes.status).toBe(403)
    await expect(toolCallRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox network host is not allowed by policy.',
        details: {
          category: 'sandbox_network',
          resourceType: 'sandbox_network',
          resourceId: 'metadata.google.internal',
        },
      },
    })

    const runtimeRes = await jsonFetch(`/runtime/sessions/${session.id}/sandbox/fetch`, authorization, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://metadata.google.internal/latest', token: 'raw-secret-token' }),
    })
    expect(runtimeRes.status).toBe(403)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox network host is not allowed by policy.',
        details: {
          category: 'sandbox_network',
          resourceType: 'sandbox_network',
          resourceId: 'metadata.google.internal',
          ruleId: 'environment.networkPolicy.allowedHosts',
        },
      },
    })

    const eventsRes = await jsonFetch(`/api/sessions/${session.id}/events`, authorization)
    const events = (await eventsRes.json()) as { data: Array<Record<string, unknown>> }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'policy_denied',
          payload: expect.objectContaining({
            type: 'policy_denied',
            category: 'sandbox_network',
            host: 'metadata.google.internal',
          }),
        }),
      ]),
    )
    expect(JSON.stringify(events)).not.toContain('raw-secret-token')
  })

  it('blocks offline sandbox network policy before proxying', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environmentRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Offline workspace',
        mcpPolicy: { allowedConnectors: ['github'] },
        networkPolicy: { mode: 'offline' },
      }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }
    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Offline override agent',
        allowedTools: ['mcp:github.repo.read'],
        mcpConnectors: ['github'],
        sandboxPolicy: { network: 'enabled' },
      }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { id: string }

    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { id: string }

    const runtimeRes = await jsonFetch(`/runtime/sessions/${session.id}/sandbox/fetch`, authorization, {
      method: 'POST',
      body: JSON.stringify({ url: 'https://registry.npmjs.org/package' }),
    })
    expect(runtimeRes.status).toBe(403)
    await expect(runtimeRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox network access is disabled by policy.',
        details: { category: 'sandbox_network', resourceType: 'sandbox_network' },
      },
    })
  })

  it('records safe runtime errors without leaking secrets', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    const created = (await createRes.json()) as { id: string }

    const taskRes = await jsonFetch(`/runtime/sessions/${created.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        message: 'Trigger failure',
        simulateError: true,
        errorMessage: 'Provider failed with token=raw-secret-token',
      }),
    })
    expect(taskRes.status).toBe(200)

    const readRes = await jsonFetch(`/api/sessions/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      status: 'error',
      statusReason: '[REDACTED]',
    })

    const eventsRes = await jsonFetch(`/api/sessions/${created.id}/events?type=error`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as { data: Array<{ payload: Record<string, unknown> }> }
    expect(events.data).toHaveLength(1)
    expect(events.data[0]?.payload).toMatchObject({ type: 'error', message: '[REDACTED]' })
    expect(JSON.stringify(events.data)).not.toContain('token=raw-secret-token')
  })

  it('rereads stored snapshots after agent and environment updates', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/sessions', authorization, {
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

    await jsonFetch(`/api/environments/${environment.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    await jsonFetch(`/api/agents/${agent.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'Updated instructions.' }),
    })

    const rereadRes = await jsonFetch(`/api/sessions/${created.id}`, authorization)
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
