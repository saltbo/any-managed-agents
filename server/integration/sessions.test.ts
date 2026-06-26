import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { runtimeProviderModelCapability } from '@server/domain/runtime-catalog'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runtimeErrorMessage } from '../http/sessions'
import { defaultClaims, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

// ama is a wildcard runtime, so its required runner capability normalizes the
// provider segment to '*' regardless of the agent's vendor.
const DEFAULT_AMA_RUNNER_CAPABILITY = runtimeProviderModelCapability('ama', '*', '@cf/moonshotai/kimi-k2.6')

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

async function waitForSessionState(sessionId: string, authorization: string, state: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await jsonFetch(`/api/v1/sessions/${sessionId}`, authorization)
    const session = (await res.json()) as { state: string }
    if (session.state === state) {
      return session
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Session ${sessionId} did not reach ${state}`)
}

async function createEnvironment(authorization: string, data: Record<string, unknown> = {}) {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `AMA workspace ${crypto.randomUUID()}`,
      packages: [{ name: '@earendil-works/pi-agent-core', version: 'prebuilt' }],
      mcpPolicy: { allowedConnectors: ['github'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      runtimeConfig: { image: 'ama-tool-executor' },
      ...data,
    }),
  })
  if (res.status !== 201) {
    throw new Error(`Expected environment creation to return 201, got ${res.status}: ${await res.text()}`)
  }
  return (await res.json()) as { id: string; hostingMode?: string }
}

async function createAgent(authorization: string, data: Record<string, unknown> = {}) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Cloud session agent',
      instructions: 'Work through AMA runtime.',
      skills: ['ama@cloud-session'],
      mcpConnectors: ['github'],
      // Agents must pin a provider before a session can be created. The cloud
      // runtime ('ama') routes through the Workers AI binding, which only
      // recognizes the 'workers-ai' provider and supplies a default model when
      // none is pinned. The seeded global provider row backs the agent.providerId
      // FK and the cloud catalog check.
      providerId: 'workers-ai',
      ...data,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; currentVersionId: string; skills: string[] }
}

// Providers are a global vendor catalog now; seed an external vendor + model row
// directly (discovery owns these in production). Returns the row id callers pin.
async function createProviderModel(_authorization: string, model: string) {
  const slug = `external-${crypto.randomUUID().slice(0, 8)}`
  const { providerId } = await seedPlatformProvider({
    providerId: slug,
    slug,
    displayName: 'External gateway',
    modelId: model,
  })
  return { providerId, model }
}

async function registerRunner(authorization: string, environmentId: string, capabilities: string[]) {
  const res = await jsonFetch('/api/v1/runners', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Runtime support runner ${crypto.randomUUID()}`,
      environmentId,
      capabilities,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function heartbeatRunner(authorization: string, runnerId: string, capabilities: string[]) {
  const res = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, authorization, {
    method: 'PUT',
    body: JSON.stringify({ state: 'active', capabilities }),
  })
  expect(res.status).toBe(200)
}

// v1 lease flow: list available work, then claim one lease for it.
async function claimLease(authorization: string, runnerId: string) {
  const workRes = await jsonFetch('/api/v1/work-items?state=available', authorization)
  expect(workRes.status).toBe(200)
  const work = (await workRes.json()) as { data: Array<{ id: string }> }
  if (work.data.length === 0) {
    return null
  }
  for (const item of work.data) {
    const leaseRes = await jsonFetch('/api/v1/leases', authorization, {
      method: 'POST',
      body: JSON.stringify({ workItemId: item.id, runnerId }),
    })
    if (leaseRes.status === 201) {
      return (await leaseRes.json()) as { id: string; workItemId: string; runnerId: string }
    }
  }
  return null
}

async function readWorkItem(authorization: string, workItemId: string) {
  const res = await jsonFetch(`/api/v1/work-items/${workItemId}`, authorization)
  expect(res.status).toBe(200)
  return (await res.json()) as { id: string; payload: Record<string, unknown> }
}

async function connectMcp(authorization: string, connectorId: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `${connectorId} credentials` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
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
  const connectRes = await jsonFetch('/api/v1/connections', authorization, {
    method: 'POST',
    body: JSON.stringify({
      connectorId,
      credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
    }),
  })
  expect(connectRes.status).toBe(201)
  return credential
}

async function setProjectPolicy(authorization: string, policy: Record<string, unknown>) {
  const res = await jsonFetch('/api/v1/policies', authorization, {
    method: 'POST',
    body: JSON.stringify({ scope: { level: 'project' }, ...policy }),
  })
  expect([200, 201]).toContain(res.status)
}

describe('[CF] /api/v1/sessions', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a runner-capable environment when none is pinned [spec: sessions/create]', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, { mcpPolicy: { allowedConnectors: [] } })
    const agent = await createAgent(authorization, { mcpConnectors: [] })
    const runner = await registerRunner(authorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    await heartbeatRunner(authorization, runner.id, [DEFAULT_AMA_RUNNER_CAPABILITY])

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, runtime: 'ama', title: 'Unpinned session' }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({ environmentId: environment.id })
  })

  it('rejects an unpinned session when no runner environment is available [spec: sessions/create]', async () => {
    const authorization = await signIn()
    // An environment exists but has no active runner, so it is not a candidate.
    await createEnvironment(authorization, { mcpPolicy: { allowedConnectors: [] } })
    const agent = await createAgent(authorization, { mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, runtime: 'ama', title: 'Unpinned session' }),
    })
    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: expect.stringContaining('No environment has an active runner') },
    })
  })

  it('creates, reads, lists, connects, messages, stops, archives, and records events for a cloud session [spec: sessions/create] [spec: sessions/prompt] [spec: sessions/stop] [spec: sessions/archive] [spec: sessions/connection] [spec: sessions/events-query] [spec: sessions/events-redaction]', async () => {
    const authorization = await signIn()
    const githubCredential = await connectMcp(authorization, 'github')
    await connectMcp(authorization, 'linear')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        title: 'Ship the first task',
        metadata: { ticket: 'AMA-1' },
        resourceRefs: [{ type: 'repository', id: 'repo_1' }],
        env: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' },
        secretEnv: [
          {
            name: 'AK_AGENT_KEY',
            credentialRef: { credentialId: githubCredential.id, versionId: githubCredential.activeVersionId },
          },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      state: string
      agentVersionId: string
      agentSnapshot: { instructions: string; skills: string[]; mcpConnectors: string[]; providerId: string }
      environmentVersionId: string
      environmentSnapshot: {
        mcpPolicy: Record<string, unknown>
        packageManagerPolicy: Record<string, unknown>
      }
      startedAt: string
      title: string
      resourceRefs: Array<Record<string, unknown>>
      env: Record<string, string>
      secretEnv: Array<{ name: string; credentialRef: { credentialId: string; versionId: string } }>
      metadata: Record<string, unknown>
      runtimeMetadata: Record<string, unknown>
    }
    expect(created).toMatchObject({
      title: 'Ship the first task',
      state: 'idle',
      agentVersionId: agent.currentVersionId,
      agentSnapshot: {
        instructions: 'Work through AMA runtime.',
        skills: ['ama@cloud-session'],
        mcpConnectors: ['github'],
        providerId: 'workers-ai',
      },
      environmentSnapshot: {
        mcpPolicy: { allowedConnectors: ['github'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      },
      resourceRefs: [{ type: 'repository', id: 'repo_1' }],
      env: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' },
      secretEnv: [
        {
          name: 'AK_AGENT_KEY',
          credentialRef: { credentialId: githubCredential.id, versionId: githubCredential.activeVersionId },
        },
      ],
      metadata: {
        ticket: 'AMA-1',
        hostingMode: 'cloud',
        runtime: 'ama',
        runtimeDriver: 'ama-cloud',
      },
      runtimeMetadata: {
        hostingMode: 'cloud',
        runtime: 'ama',
        runtimeConfig: { image: 'ama-tool-executor' },
        provider: 'workers-ai',
        model: null,
        driver: 'ama-cloud',
        backend: 'ama-cloud',
        protocol: 'ama-runtime-rpc',
      },
    })
    // Internal placement and tenancy fields never leave the API (§1.7).
    const serialized = JSON.stringify(created)
    expect(serialized).not.toContain('durableObjectName')
    expect(serialized).not.toContain('sandboxId')
    expect(serialized).not.toContain('runtimeEndpointPath')
    expect(serialized).not.toContain('organizationId')
    expect(serialized).not.toContain('vaultRefs')
    expect(serialized).not.toContain('piRuntimeId')
    expect(created.environmentVersionId).toMatch(/^envver_/)
    expect(created.startedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/v1/sessions', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const readRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, state: 'idle' })

    const connectionRes = await jsonFetch(`/api/v1/sessions/${created.id}/connection`, authorization)
    expect(connectionRes.status).toBe(200)
    await expect(connectionRes.json()).resolves.toEqual({
      sessionId: created.id,
      transport: 'websocket',
      path: `/api/v1/sessions/${created.id}/socket`,
      state: 'idle',
      stateReason: null,
    })

    const taskRes = await jsonFetch(`/api/v1/runtime/sessions/${created.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        message: 'Inspect repository status',
      }),
    })
    expect(taskRes.status).toBe(200)
    const afterTaskRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    await expect(afterTaskRes.json()).resolves.toMatchObject({ id: created.id, state: 'idle' })

    const messageRes = await jsonFetch(`/api/v1/sessions/${created.id}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        content: 'What was my previous prompt?',
      }),
    })
    expect(messageRes.status).toBe(201)
    const message = (await messageRes.json()) as { id: string; delivery: string; state: string }
    expect(message).toMatchObject({
      sessionId: created.id,
      type: 'prompt',
      content: 'What was my previous prompt?',
      delivery: 'live',
      state: 'delivered',
      error: null,
    })

    const messageItemRes = await jsonFetch(`/api/v1/sessions/${created.id}/messages/${message.id}`, authorization)
    expect(messageItemRes.status).toBe(200)
    await expect(messageItemRes.json()).resolves.toMatchObject({ id: message.id, state: 'delivered' })

    const messageListRes = await jsonFetch(`/api/v1/sessions/${created.id}/messages`, authorization)
    expect(messageListRes.status).toBe(200)
    const messageList = (await messageListRes.json()) as { data: Array<{ id: string }> }
    expect(messageList.data).toContainEqual(expect.objectContaining({ id: message.id }))

    const afterCommandRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    await expect(afterCommandRes.json()).resolves.toMatchObject({ id: created.id, state: 'idle' })

    const stopRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'stopped' }),
    })
    expect(stopRes.status).toBe(200)
    const stopped = (await stopRes.json()) as { state: string; stoppedAt: string }
    expect(stopped.state).toBe('stopped')
    expect(stopped.stoppedAt).toEqual(expect.any(String))

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization)
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
    expect(events.data.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'turn_end',
        'message_update',
        'message_end',
        'tool_execution_start',
        'tool_execution_end',
      ]),
    )
    expect(events.data.every((event) => event.visibility === 'runtime')).toBe(true)
    const toolCallEvent = events.data.find(
      (event) => event.type === 'tool_execution_start' && event.payload.toolCallId === 'call_git_status',
    )
    const toolResultEvent = events.data.find(
      (event) => event.type === 'tool_execution_end' && event.payload.toolCallId === 'call_git_status',
    )
    expect(toolCallEvent).toMatchObject({ correlationId: 'tool:call_git_status' })
    expect(toolCallEvent?.parentEventId).toMatch(/^event_/)
    expect(toolResultEvent?.parentEventId).toBe(toolCallEvent?.parentEventId)
    expect(JSON.stringify(events.data)).not.toContain('raw-secret')
    expect(JSON.stringify(events.data)).toContain('Previous user prompt: Inspect repository status')
    expect(JSON.stringify(events.data)).not.toContain('raw-github-token')
    expect(JSON.stringify(events.data)).not.toContain('organizationId')

    const pagedEventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?limit=1`, authorization)
    const pagedEvents = (await pagedEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(pagedEvents.data).toEqual([expect.objectContaining({ sequence: 1, type: 'agent_start' })])
    expect(pagedEvents.pagination).toMatchObject({ hasMore: true, nextCursor: '1' })

    const cursorEventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?cursor=1&limit=2`, authorization)
    const cursorEvents = (await cursorEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(cursorEvents.data.map((event) => event.sequence)).toEqual([2, 3])
    expect(cursorEvents.pagination).toEqual({ limit: 2, hasMore: true, nextCursor: '3' })

    const descendingEventsRes = await jsonFetch(
      `/api/v1/sessions/${created.id}/events?order=desc&cursor=6&limit=2`,
      authorization,
    )
    const descendingEvents = (await descendingEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(descendingEvents.data.map((event) => event.sequence)).toEqual([5, 4])

    const filteredEventsRes = await jsonFetch(
      `/api/v1/sessions/${created.id}/events?cursor=1&type=tool_execution_end`,
      authorization,
    )
    const filteredEvents = (await filteredEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(filteredEvents.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tool_execution_end' })]),
    )

    // CSV export via content negotiation replaces /events/export (§1.2.6).
    const csvRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?cursor=2&limit=2`, authorization, {
      headers: { accept: 'text/csv' },
    })
    expect(csvRes.status).toBe(200)
    expect(csvRes.headers.get('content-type')).toContain('text/csv')
    expect(csvRes.headers.get('content-disposition')).toContain(`session-${created.id}-events.csv`)
    const csvText = await csvRes.text()
    const csvLines = csvText.trim().split('\n')
    expect(csvLines[0]).toBe(
      'id,sessionId,sequence,type,visibility,role,correlationId,parentEventId,createdAt,payload,metadata',
    )
    expect(csvLines).toHaveLength(3)
    expect(csvText).not.toContain('raw-secret')

    // SSE stream via content negotiation replaces /events/stream.
    const streamRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?cursor=4`, authorization, {
      headers: { accept: 'text/event-stream' },
    })
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')
    const streamText = await streamRes.text()
    const streamedEvents = streamText
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as { sequence: number })
    expect(streamedEvents[0]?.sequence).toBe(5)
    expect(streamText).not.toContain('raw-github-token')

    const descendingStreamRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?order=desc`, authorization, {
      headers: { accept: 'text/event-stream' },
    })
    expect(descendingStreamRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archived = (await archiveRes.json()) as { state: string; archivedAt: string | null }
    expect(archived.state).toBe('stopped')
    expect(archived.archivedAt).toEqual(expect.any(String))

    const liveListRes = await jsonFetch('/api/v1/sessions', authorization)
    const liveList = (await liveListRes.json()) as { data: Array<{ id: string }> }
    expect(liveList.data).not.toContainEqual(expect.objectContaining({ id: created.id }))

    const archivedListRes = await jsonFetch('/api/v1/sessions?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; archivedAt: string | null }> }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({ id: created.id, archivedAt: expect.any(String) }),
    )

    // Archived sessions reject edits but can be restored.
    const archivedEditRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'New title' }),
    })
    expect(archivedEditRes.status).toBe(409)

    const unarchiveRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ id: created.id, archivedAt: null })
  })

  it('updates title and metadata without disturbing runtime-managed metadata', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        title: 'Before rename',
        metadata: { ticket: 'AMA-1' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const patchRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'After rename', metadata: { ticket: 'AMA-2', extra: true } }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      title: 'After rename',
      metadata: expect.objectContaining({
        ticket: 'AMA-2',
        extra: true,
        hostingMode: 'cloud',
        runtime: 'ama',
      }),
    })

    const secretMetadataRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { apiKey: 'raw-secret-token' } }),
    })
    expect(secretMetadataRes.status).toBe(400)

    const emptyPatchRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({}),
    })
    expect(emptyPatchRes.status).toBe(400)
  })

  it('queues self-hosted sessions for runner lease support [spec: sessions/memory-store-resources]', async () => {
    const authorization = await signIn()
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization, {
      name: 'Self-hosted workspace',
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    })
    const runner = await registerRunner(authorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const agent = await createAgent(authorization, {
      name: 'Self-hosted session agent',
      instructions: 'Wait for a self-hosted runner.',
      skills: [],
      mcpConnectors: [],
    })
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Team memory', description: 'Review conventions' }),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { id: string }
    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${memoryStore.id}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Review for correctness first.' }),
    })
    expect(memoryRes.status).toBe(201)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        resourceRefs: [
          { type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban', ref: 'main' },
          { type: 'memory_store', storeId: memoryStore.id, access: 'read_write' },
        ],
        secretEnv: [
          {
            name: 'AK_AGENT_KEY',
            credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
          },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      state: string
      stateReason: string | null
      environmentSnapshot: { hostingMode: string }
      secretEnv: Array<{ name: string; credentialRef: Record<string, string> }>
      resourceRefs: Array<Record<string, unknown>>
      metadata: Record<string, unknown>
      runtimeMetadata: Record<string, unknown>
    }
    expect(created.resourceRefs).toContainEqual(
      expect.objectContaining({
        type: 'memory_store',
        storeId: memoryStore.id,
        name: 'Team memory',
        description: 'Review conventions',
        access: 'read_write',
        mountPath: `/workspace/.ama/memory-stores/${memoryStore.id}`,
        memories: [{ path: 'guides/review.md', content: 'Review for correctness first.' }],
      }),
    )
    expect(created).toMatchObject({
      state: 'pending',
      stateReason: 'waiting-for-runner',
      environmentSnapshot: { hostingMode: 'self_hosted' },
      secretEnv: [
        { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId } },
      ],
      metadata: {
        hostingMode: 'self_hosted',
        runtime: 'ama',
        runtimeDriver: 'ama-self-hosted',
        runnerState: 'queued',
        runnerProtocol: 'ama-runner-work',
      },
      runtimeMetadata: {
        hostingMode: 'self_hosted',
        runtime: 'ama',
        provider: 'workers-ai',
        model: null,
        driver: 'ama-self-hosted',
        backend: null,
        protocol: 'ama-runner-work',
      },
    })

    const connectionRes = await jsonFetch(`/api/v1/sessions/${created.id}/connection`, authorization)
    expect(connectionRes.status).toBe(200)
    await expect(connectionRes.json()).resolves.toMatchObject({
      sessionId: created.id,
      transport: 'websocket',
      path: `/api/v1/sessions/${created.id}/socket`,
      state: 'pending',
      stateReason: 'waiting-for-runner',
    })

    const workItemsRes = await jsonFetch(`/api/v1/work-items?sessionId=${created.id}`, authorization)
    expect(workItemsRes.status).toBe(200)
    await expect(workItemsRes.json()).resolves.toMatchObject({
      data: [
        {
          sessionId: created.id,
          environmentId: environment.id,
          type: 'session.start',
          state: 'available',
        },
      ],
    })

    const workRow = await env.DB.prepare('SELECT payload FROM work_items WHERE session_id = ?')
      .bind(created.id)
      .first<{ payload: string }>()
    expect(workRow).toBeTruthy()
    const storedPayload = JSON.parse(workRow!.payload) as {
      resourceRefs: Array<Record<string, unknown>>
      runtimeEnv: Record<string, string>
      runtimeSecretEnv: Array<{ name: string; credentialRef: Record<string, string> }>
      provider: string
      agentSnapshot: { instructions: string }
    }
    expect(storedPayload.resourceRefs).toEqual([
      {
        type: 'github_repository',
        owner: 'saltbo',
        repo: 'agent-kanban',
        ref: 'main',
        mountPath: '/workspace/repos/saltbo/agent-kanban',
      },
      {
        type: 'memory_store',
        storeId: memoryStore.id,
        name: 'Team memory',
        description: 'Review conventions',
        access: 'read_write',
        mountPath: `/workspace/.ama/memory-stores/${memoryStore.id}`,
        memories: [{ path: 'guides/review.md', content: 'Review for correctness first.' }],
      },
    ])
    expect(storedPayload.agentSnapshot.instructions).toContain('Attached memory stores:')
    expect(storedPayload.agentSnapshot.instructions).toContain('Team memory')
    expect(storedPayload.agentSnapshot.instructions).not.toContain('Review for correctness first.')
    expect(storedPayload.provider).toBe('workers-ai')
    expect(storedPayload.runtimeEnv).not.toHaveProperty('AK_AGENT_KEY')
    expect(storedPayload.runtimeSecretEnv).toEqual([
      { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId } },
    ])

    await heartbeatRunner(authorization, runner.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const lease = await claimLease(authorization, runner.id)
    expect(lease).toBeTruthy()
    const workItem = await readWorkItem(authorization, lease!.workItemId)
    const payload = workItem.payload as {
      runtimeEnv: Record<string, string>
      runtimeSecretEnv: Array<Record<string, unknown>>
    }
    // Lease materialization resolves the vault value into the runner env.
    expect(payload.runtimeEnv.AK_AGENT_KEY).toBe('raw-github-token')
  })

  it('normalizes GitHub repository resource refs and rejects unsafe workspace inputs', async () => {
    const authorization = await signIn()
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        resourceRefs: [
          {
            type: 'github_repository',
            owner: 'saltbo',
            repo: 'any-managed-agents',
            ref: 'feature/session-resources',
            mountPath: 'repos/ama',
            credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
          },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({
      resourceRefs: [
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'any-managed-agents',
          ref: 'feature/session-resources',
          mountPath: '/workspace/repos/ama',
          credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
        },
      ],
    })

    const unsafePathRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        resourceRefs: [
          {
            type: 'github_repository',
            owner: 'saltbo',
            repo: 'any-managed-agents',
            mountPath: '../escape',
          },
        ],
      }),
    })
    expect(unsafePathRes.status).toBe(400)
    await expect(unsafePathRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'resourceRefs.0.mountPath': expect.any(String) } },
      },
    })

    const embeddedCredentialUrlRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        resourceRefs: [
          {
            type: 'repository',
            cloneUrl: 'https://token:secret@github.com/saltbo/any-managed-agents.git',
          },
        ],
      }),
    })
    expect(embeddedCredentialUrlRes.status).toBe(400)

    const duplicateMountRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        resourceRefs: [
          { type: 'github_repository', owner: 'saltbo', repo: 'one', mountPath: 'repos/shared' },
          { type: 'github_repository', owner: 'saltbo', repo: 'two', mountPath: '/workspace/repos/shared' },
        ],
      }),
    })
    expect(duplicateMountRes.status).toBe(400)
  })

  it('validates secret environment references without exposing raw secrets [spec: sessions/create-explicit-inputs]', async () => {
    const authorization = await signIn()
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const missingRefRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        secretEnv: [{ name: 'AK_AGENT_KEY', credentialRef: { credentialId: 'cred_missing' } }],
      }),
    })
    expect(missingRefRes.status).toBe(400)
    await expect(missingRefRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'secretEnv.0.credentialRef.credentialId': expect.any(String) } },
      },
    })

    const wrongVersionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        secretEnv: [
          { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id, versionId: 'credver_missing' } },
        ],
      }),
    })
    expect(wrongVersionRes.status).toBe(400)
    await expect(wrongVersionRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'secretEnv.0.credentialRef.versionId': expect.any(String) } },
      },
    })

    const duplicateNameRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        secretEnv: [
          { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id } },
          { name: 'AK_AGENT_KEY', credentialRef: { credentialId: credential.id } },
        ],
      }),
    })
    expect(duplicateNameRes.status).toBe(400)
    const duplicateNameText = await duplicateNameRes.text()
    expect(JSON.parse(duplicateNameText)).toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'secretEnv.1.name': expect.any(String) } },
      },
    })
    expect(duplicateNameText).not.toContain('raw-github-token')
  })

  it('preserves canonical session environment snapshots for read contracts', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization, {
      name: `Canonical snapshot workspace ${crypto.randomUUID()}`,
      hostingMode: 'cloud',
      runtimeConfig: { image: 'ama-runtime', timeoutSeconds: 120 },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    })
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const readRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    const body = await readRes.json()
    expect(body).toMatchObject({
      environmentSnapshot: {
        hostingMode: 'cloud',
        runtimeConfig: { image: 'ama-runtime', timeoutSeconds: 120 },
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      },
      runtimeMetadata: { runtime: 'ama' },
    })
  })

  it('serializes stored canonical runtime event rows as AMA session events [spec: sessions/events-canonical]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; projectId: string }

    // The cloud ama session stores its events in the Session DO; seed through the
    // ingest endpoint (which routes to that store) rather than D1 directly.
    const ingestStartRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'tool_execution_start',
            payload: { toolCallId: 'call_pi', toolName: 'sandbox.exec', args: { command: 'npm test' } },
          },
        ],
      }),
    })
    expect(ingestStartRes.status).toBe(201)

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?type=tool_execution_start`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_execution_start',
          payload: expect.objectContaining({
            toolCallId: 'call_pi',
            toolName: 'sandbox.exec',
            args: { command: 'npm test' },
          }),
        }),
      ]),
    )

    const ingestErrorRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'runtime.error',
            payload: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 1 } },
          },
        ],
      }),
    })
    expect(ingestErrorRes.status).toBe(201)

    const runtimeErrorEventsRes = await jsonFetch(
      `/api/v1/sessions/${created.id}/events?type=runtime.error`,
      authorization,
    )
    const runtimeErrorEvents = (await runtimeErrorEventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    expect(runtimeErrorEvents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.error',
          payload: expect.objectContaining({ message: 'Runtime failed safely', code: 'runtime_exit' }),
        }),
      ]),
    )
  })

  it('accepts batch event ingest from an authenticated project user', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const ingestRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          { type: 'turn_end', payload: { message: { role: 'assistant', content: 'done' }, toolResults: [] } },
          { type: 'runtime.error', payload: { message: 'Bridge failed', code: 'runtime_exit' } },
        ],
      }),
    })
    expect(ingestRes.status).toBe(201)
    await expect(ingestRes.json()).resolves.toEqual({ accepted: 2 })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?type=turn_end`, authorization)
    const events = (await eventsRes.json()) as { data: Array<{ type: string; metadata: Record<string, unknown> }> }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'turn_end', metadata: expect.objectContaining({ source: 'api' }) }),
      ]),
    )

    const emptyBatchRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    })
    expect(emptyBatchRes.status).toBe(400)
  })

  it('archives a cloud ama session event log to R2 on stop', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          { type: 'turn_end', payload: { message: { role: 'assistant', content: 'archived run' }, toolResults: [] } },
        ],
      }),
    })

    const stopRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'stopped' }),
    })
    expect(stopRes.status).toBe(200)

    // The cloud loop owns this session's events in the Session DO; stopping it
    // snapshots the whole log to one R2 archive object (sessions/{id}/events.jsonl).
    const archived = await env.SESSION_EVENTS.get(`sessions/${created.id}/events.jsonl`)
    expect(archived).toBeTruthy()
    const events = (await archived!.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string })
    expect(events.some((event) => event.type === 'turn_end')).toBe(true)
    expect(events.some((event) => event.type === 'session_stop')).toBe(true)
  })

  it('streams backfill history and live events over the browser WebSocket', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    // A historical event the backfill request must replay.
    await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'message_start', payload: { role: 'assistant' } }] }),
    })

    // The connection resource advertises the WebSocket transport + path.
    const connection = (await (await jsonFetch(`/api/v1/sessions/${created.id}/connection`, authorization)).json()) as {
      transport: string
      path: string
    }
    expect(connection.transport).toBe('websocket')

    const socketRes = await SELF.fetch(`https://example.com${connection.path}`, {
      headers: { authorization, Upgrade: 'websocket' },
    })
    expect(socketRes.status).toBe(101)
    const ws = socketRes.webSocket as WebSocket
    const frames: Array<Record<string, unknown>> = []
    let onFrame: (() => void) | null = null
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
      frames.push(JSON.parse(data))
      onFrame?.()
    })
    ws.accept()

    async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (frames.some(predicate)) {
          return frames.find(predicate) as Record<string, unknown>
        }
        await new Promise<void>((resolve) => {
          onFrame = resolve
          setTimeout(resolve, 20)
        })
      }
      throw new Error(`expected frame never arrived; got ${JSON.stringify(frames)}`)
    }

    ws.send(JSON.stringify({ type: 'backfill', requestId: 'r1', limit: 100 }))
    const backfill = await waitForFrame((frame) => frame.type === 'backfill')
    expect((backfill.events as Array<{ type: string }>).some((event) => event.type === 'message_start')).toBe(true)

    // A live append fans out to the open socket without polling.
    await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'message_end', payload: { content: 'live frame' } }] }),
    })
    const live = await waitForFrame(
      (frame) => frame.type === 'event' && (frame.event as { type: string }).type === 'message_end',
    )
    expect((live.event as { type: string }).type).toBe('message_end')

    ws.close()
  })

  it('accepts self-hosted sessions when cloud sandbox startup is disabled [spec: environments/self-hosted]', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, {
      name: 'Self-hosted no sandbox workspace',
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    })
    const agent = await createAgent(authorization, {
      name: 'Self-hosted no sandbox agent',
      instructions: 'Wait for runner attachment.',
      skills: [],
      mcpConnectors: [],
    })

    const queuedRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(queuedRes.status).toBe(201)
    await expect(queuedRes.json()).resolves.toMatchObject({
      state: 'pending',
      stateReason: 'waiting-for-runner',
    })
    await registerRunner(authorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    await setProjectPolicy(authorization, { sandboxPolicy: { enabled: false } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({
      state: 'pending',
      stateReason: 'waiting-for-runner',
      environmentSnapshot: { hostingMode: 'self_hosted' },
      runtimeMetadata: { runtime: 'ama' },
    })
  })

  it('keeps a stopped session from writing successful completion events after cancellation [spec: sessions/stop] [spec: runtime/stop]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        title: 'Cancellation boundary',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; state: string }
    expect(created.state).toBe('idle')

    const runtimeRequest = jsonFetch(`/api/v1/runtime/sessions/${created.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        message: 'Wait for cancellation before completing',
      }),
    })
    await waitForSessionState(created.id, authorization, 'running')

    const stopRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'stopped' }),
    })
    const stopBody = await stopRes.clone().json()
    expect(stopRes.status, JSON.stringify(stopBody)).toBe(200)
    expect(stopBody).toMatchObject({ id: created.id, state: 'stopped' })

    const runtimeRes = await runtimeRequest
    expect([200, 409]).toContain(runtimeRes.status)

    const readRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, state: 'stopped' })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    const successfulAssistantCompletions = events.data.filter((event) => {
      const message = (event.payload as { message?: { role?: string; stopReason?: string } }).message
      return event.type === 'message_end' && message?.role === 'assistant' && message.stopReason === 'stop'
    })
    expect(successfulAssistantCompletions).toEqual([])
    expect(JSON.stringify(events.data)).not.toContain('AMA runtime processed: Wait for cancellation before completing')
  })

  it('creates a session and dispatches an initial prompt through the API [spec: sessions/initial-prompt]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
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
      state: string
      metadata: Record<string, unknown>
    }
    expect(created).toMatchObject({
      state: 'idle',
      metadata: expect.objectContaining({
        externalRunId: 'tftt-banking-bonus-2026-05-26',
        source: 'tftt-cron',
        hostingMode: 'cloud',
        runtime: 'ama',
        runtimeBackend: 'ama-cloud',
        runtimeProtocol: 'ama-runtime-rpc',
      }),
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ sequence: number; type: string; payload: Record<string, unknown> }>
    }
    expect(events.data.map((event) => event.sequence)).toEqual(events.data.map((_, index) => index + 1))
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message_end',
          payload: expect.objectContaining({
            message: expect.objectContaining({
              role: 'user',
              content: [
                expect.objectContaining({ type: 'text', text: 'Research current Canadian banking bonus offers.' }),
              ],
            }),
          }),
        }),
        expect.objectContaining({
          type: 'message_end',
          payload: expect.objectContaining({
            message: expect.objectContaining({ role: 'assistant' }),
          }),
        }),
        expect.objectContaining({
          type: 'usage.recorded',
          payload: expect.objectContaining({
            provider: 'cloudflare-workers-ai',
            promptTokens: expect.any(Number),
            completionTokens: expect.any(Number),
          }),
        }),
      ]),
    )

    const auditRes = await jsonFetch('/api/v1/audit-records?action=session.initial_prompt', authorization)
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

  it('includes enabled agent memory in session initial prompts [spec: sessions/initial-prompt]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization, { memoryPolicy: { enabled: true } })

    const memoryRes = await jsonFetch(`/api/v1/agents/${agent.id}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({
        content: 'Previously decided to inspect stale proposals before creating new work.',
      }),
    })
    expect(memoryRes.status).toBe(200)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        initialPrompt: 'Run the maintainer heartbeat.',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = await eventsRes.json()
    const serialized = JSON.stringify(events)
    expect(serialized).toContain('Agent memory for this agent')
    expect(serialized).toContain('Previously decided to inspect stale proposals')
    expect(serialized).toContain('Run the maintainer heartbeat')
  })

  it('validates initial prompt input and redacts runtime failure reasons', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const invalidRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
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

  it('lists sessions with pagination, state, search, and date filters [spec: sessions/list]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const firstRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    const first = (await firstRes.json()) as { id: string; agentId: string; createdAt: string }
    const secondRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    const second = (await secondRes.json()) as { id: string; agentId: string; createdAt: string }

    const pagedRes = await jsonFetch('/api/v1/sessions?limit=1', authorization)
    const paged = (await pagedRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/v1/sessions?limit=1&cursor=${paged.pagination.nextCursor}`, authorization)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((session) => session.id)).not.toEqual(paged.data.map((session) => session.id))

    const stateRes = await jsonFetch('/api/v1/sessions?state=idle', authorization)
    const stateList = (await stateRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(stateList.data.map((session) => session.state)).toEqual(['idle', 'idle'])

    const searchRes = await jsonFetch(`/api/v1/sessions?search=${agent.id}`, authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))

    const dateRes = await jsonFetch(
      `/api/v1/sessions?createdFrom=${encodeURIComponent(first.createdAt)}&createdTo=${encodeURIComponent(second.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((session) => session.id)).toEqual(expect.arrayContaining([first.id, second.id]))
  })

  it('filters sessions by metadata label selector [spec: sessions/list]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const firstRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        metadata: { labels: { maintainerId: 'maintainer_a' } },
      }),
    })
    const first = (await firstRes.json()) as { id: string }
    const secondRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        metadata: { labels: { maintainerId: 'maintainer_b' } },
      }),
    })
    const second = (await secondRes.json()) as { id: string }

    const filteredRes = await jsonFetch('/api/v1/sessions?labelSelector=maintainerId%3Dmaintainer_a', authorization)
    expect(filteredRes.status).toBe(200)
    const filtered = (await filteredRes.json()) as { data: Array<{ id: string; metadata: Record<string, unknown> }> }
    expect(filtered.data.map((session) => session.id)).toContain(first.id)
    expect(filtered.data.map((session) => session.id)).not.toContain(second.id)
    expect(filtered.data[0]?.metadata).toMatchObject({ labels: { maintainerId: 'maintainer_a' } })
  })

  it('enforces auth and project tenancy for session lifecycle [spec: sessions/auth-tenancy]', async () => {
    const unauthenticatedRes = await SELF.fetch('https://example.com/api/v1/sessions')
    expect(unauthenticatedRes.status).toBe(401)

    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
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
      jsonFetch(`/api/v1/sessions/${created.id}`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.id}/connection`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.id}/events`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.id}/messages`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.id}`, otherCookie, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'stopped' }),
      }),
      jsonFetch(`/api/v1/sessions/${created.id}`, otherCookie, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
      jsonFetch(`/api/v1/sessions/${created.id}/events`, otherCookie, {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'turn_end', payload: {} }] }),
      }),
    ])
    expect(crossProjectReads.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404, 404])
  })

  it('blocks disabled sandbox startup before creating a runtime [spec: audit/runtime-policy]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    await setProjectPolicy(authorization, { sandboxPolicy: { enabled: false } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(403)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox runtime is disabled by governance policy.',
        details: { category: 'sandbox', resourceType: 'sandbox', ruleId: 'sandboxPolicy.enabled' },
      },
    })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=session.create', authorization)
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

  it('records model-originated sandbox policy denials before executor dispatch', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    await setProjectPolicy(authorization, { sandboxPolicy: { blockedCommands: ['git'] } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { id: string }

    const runtimeRes = await jsonFetch(`/api/v1/runtime/sessions/${session.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', message: 'Inspect repository status' }),
    })
    expect(runtimeRes.status).toBe(500)

    // A governance denial fails the turn but leaves the session usable.
    const readRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(readRes.json()).resolves.toMatchObject({
      id: session.id,
      state: 'idle',
      stateReason: 'policy-denied',
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${session.id}/events`, authorization)
    const events = (await eventsRes.json()) as { data: Array<{ type: string; payload: Record<string, unknown> }> }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'policy.decision',
          payload: expect.objectContaining({
            category: 'sandbox_command',
            ruleId: 'sandboxPolicy.blockedCommands',
            command: 'git status',
          }),
        }),
        expect.objectContaining({
          type: 'runtime.error',
          payload: expect.objectContaining({
            message: 'Sandbox command is blocked by policy.',
          }),
        }),
      ]),
    )
  })

  it('records safe runtime errors without leaking secrets', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    const created = (await createRes.json()) as { id: string }

    const taskRes = await jsonFetch(`/api/v1/runtime/sessions/${created.id}/rpc`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        message: 'Trigger failure',
        simulateError: true,
        errorMessage: 'Provider failed with token=raw-secret-token',
      }),
    })
    expect(taskRes.status).toBe(500)
    await expect(taskRes.json()).resolves.toMatchObject({
      error: {
        type: 'internal_error',
        message: '[REDACTED]',
      },
    })

    const readRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      state: 'error',
      stateReason: '[REDACTED]',
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.id}/events?type=runtime.error`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as { data: Array<{ payload: Record<string, unknown> }> }
    expect(events.data).toHaveLength(1)
    expect(events.data[0]?.payload).toMatchObject({ message: '[REDACTED]' })
    expect(JSON.stringify(events.data)).not.toContain('token=raw-secret-token')
  })

  it('rereads stored snapshots after agent and environment updates', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    const created = (await createRes.json()) as { id: string }

    await jsonFetch(`/api/v1/environments/${environment.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    await jsonFetch(`/api/v1/agents/${agent.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'Updated instructions.' }),
    })

    const rereadRes = await jsonFetch(`/api/v1/sessions/${created.id}`, authorization)
    expect(rereadRes.status).toBe(200)
    await expect(rereadRes.json()).resolves.toMatchObject({
      id: created.id,
      agentSnapshot: {
        instructions: 'Work through AMA runtime.',
        version: 1,
        skills: ['ama@cloud-session'],
        mcpConnectors: ['github'],
      },
      environmentSnapshot: {
        packages: [{ name: '@earendil-works/pi-agent-core', version: 'prebuilt' }],
        mcpPolicy: { allowedConnectors: ['github'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
      },
    })
  })

  it('rejects cloud sessions when the session runtime cannot run the exact agent provider model [spec: sessions/reject-dependencies]', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { providerId, model, mcpConnectors: [] })

    // Cloud validation checks the GLOBAL catalog (provider_models) via findModel.
    // Drop the model row out of band (the agent pinned it at save time) so the
    // exact (provider, model) the agent pins is no longer in the catalog.
    await env.DB.prepare('DELETE FROM provider_models WHERE provider_id = ? AND model_id = ?')
      .bind(providerId, model)
      .run()

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })

    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'ama',
          provider: providerId,
          model,
        },
      },
    })
  })

  it('rejects cloud sessions for runtimes without a cloud driver before allocating runtime state', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'codex' }),
    })

    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'codex',
          provider: 'workers-ai',
          model: null,
        },
      },
    })
  })

  it('queues self-hosted external runtime sessions and requires exact runner model support on lease claim', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, {
      hostingMode: 'self_hosted',
      mcpPolicy: {},
    })
    const agent = await createAgent(authorization, { providerId, model, mcpConnectors: [] })

    const wrongCapability = runtimeProviderModelCapability('codex', providerId, 'gpt-5.3-codex-mini')
    const wrongRunner = await registerRunner(authorization, environment.id, [wrongCapability])

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'codex' }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { id: string; state: string; stateReason: string | null }
    expect(session).toMatchObject({ state: 'pending', stateReason: 'waiting-for-runner' })

    const exactCapability = runtimeProviderModelCapability('codex', '*', model)
    const exactRunner = await registerRunner(authorization, environment.id, [exactCapability])

    await heartbeatRunner(authorization, wrongRunner.id, [wrongCapability])
    // Runners enumerate their host models, so model-specific declarations are
    // authoritative: a runner declaring only other model ids must not take
    // the work.
    const wrongLease = await claimLease(authorization, wrongRunner.id)
    expect(wrongLease).toBeNull()

    await heartbeatRunner(authorization, exactRunner.id, [exactCapability])
    const exactLease = await claimLease(authorization, exactRunner.id)
    expect(exactLease).toBeTruthy()
  })

  it('rejects sessions when the agent provider was disabled after the agent was saved', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, { hostingMode: 'self_hosted', mcpPolicy: {} })
    const agent = await createAgent(authorization, { providerId, model, mcpConnectors: [] })

    // The vendor is disabled out of band (global catalog) after the agent saved.
    await env.DB.prepare('UPDATE providers SET enabled = 0 WHERE id = ?').bind(providerId).run()

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'codex' }),
    })
    expect(createRes.status).toBe(403)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Provider is disabled for this project.',
      },
    })
  })

  it('rejects ama runtime sessions for configured external providers even without a pinned model', async () => {
    const authorization = await signIn()
    // Cloud validation with no pinned model checks the GLOBAL catalog via
    // findBySlug(provider). Seed a provider whose row id (what the agent pins)
    // differs from its slug, so the agent saves but the catalog lookup by slug
    // misses and the session is rejected.
    const providerId = `external-${crypto.randomUUID().slice(0, 8)}`
    await seedPlatformProvider({ providerId, slug: `${providerId}-slug`, displayName: 'External gateway' })
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { providerId, model: null, mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: { resourceType: 'runtime_catalog', runtime: 'ama', provider: providerId },
      },
    })
  })

  it('leases model-specific work to runners that only declare the bare runtime capability', async () => {
    // TRANSITIONAL coverage: runners deployed before host model enumeration
    // declare the bare runtime plus one hardcoded model. They must keep
    // claiming work for other models until the fleet updates.
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, {
      hostingMode: 'self_hosted',
      mcpPolicy: {},
    })
    const agent = await createAgent(authorization, { providerId, model, mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'codex' }),
    })
    expect(createRes.status).toBe(201)

    const legacyCapabilities = ['codex', runtimeProviderModelCapability('codex', '*', 'gpt-5.3-codex-mini')]
    const legacyRunner = await registerRunner(authorization, environment.id, legacyCapabilities)
    await heartbeatRunner(authorization, legacyRunner.id, legacyCapabilities)

    const lease = await claimLease(authorization, legacyRunner.id)
    expect(lease).toBeTruthy()
  })

  it('lists session approvals with explicit states', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id, runtime: 'ama' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const approvalsRes = await jsonFetch(`/api/v1/sessions/${created.id}/approvals`, authorization)
    expect(approvalsRes.status).toBe(200)
    await expect(approvalsRes.json()).resolves.toEqual({
      data: [],
      pagination: { limit: 0, nextCursor: null, hasMore: false },
    })

    const missingApprovalRes = await jsonFetch(
      `/api/v1/sessions/${created.id}/approvals/approval_missing`,
      authorization,
    )
    expect(missingApprovalRes.status).toBe(404)

    const decideMissingRes = await jsonFetch(
      `/api/v1/sessions/${created.id}/approvals/approval_missing`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'approve' }),
      },
    )
    expect(decideMissingRes.status).toBe(404)
  })
})
