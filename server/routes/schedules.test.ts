import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider, signIn } from '../test/auth'

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
      name: `Scheduled workspace ${crypto.randomUUID()}`,
      runtimeConfig: { image: 'ama-tool-executor' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Scheduled agent ${crypto.randomUUID()}`,
      instructions: 'Run scheduled work.',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createRuntimeSecret(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `Scheduled runtime secrets ${crypto.randomUUID()}` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'AK agent session key',
      type: 'session_env_secret',
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-ak-agent-key' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as { activeVersionId: string }
}

async function createTrigger(
  authorization: string,
  agentId: string,
  environmentId: string,
  data: Record<string, unknown> = {},
) {
  const res = await jsonFetch('/api/scheduled-agent-triggers', authorization, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      environmentId,
      runtime: 'ama',
      name: `Scheduled trigger ${crypto.randomUUID()}`,
      promptTemplate: 'Run scheduled work.',
      schedule: { type: 'interval', intervalSeconds: 3600 },
      nextDueAt: '2026-05-26T12:00:00.000Z',
      ...data,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as {
    id: string
    name: string
    nextDueAt: string
    status: string
    metadata: Record<string, unknown>
    resourceRefs: Record<string, unknown>[]
    runtimeEnv: Record<string, unknown>
    runtimeSecretEnv: Array<{ name: string; ref: string }>
    schedule: { intervalSeconds: number; windowSeconds: number }
  }
}

describe('[CF] /api/scheduled-agent-triggers', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, lists, reads, updates, archives, and audits scheduled trigger resources', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const first = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Alpha heartbeat',
      metadata: { lane: 'alpha' },
    })
    const second = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Beta heartbeat',
      metadata: { lane: 'beta' },
      schedule: { intervalSeconds: 7200, windowSeconds: 300 },
      status: 'paused',
    })

    const listRes = await jsonFetch('/api/scheduled-agent-triggers?limit=1', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ id: string; name: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(list.data).toHaveLength(1)
    expect(list.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(
      `/api/scheduled-agent-triggers?limit=1&cursor=${list.pagination.nextCursor}`,
      authorization,
    )
    expect(nextPageRes.status).toBe(200)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((trigger) => trigger.id)).not.toEqual(list.data.map((trigger) => trigger.id))

    const searchRes = await jsonFetch('/api/scheduled-agent-triggers?search=Alpha', authorization)
    expect(searchRes.status).toBe(200)
    await expect(searchRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: first.id, name: 'Alpha heartbeat' })],
    })

    const statusRes = await jsonFetch('/api/scheduled-agent-triggers?status=paused', authorization)
    expect(statusRes.status).toBe(200)
    await expect(statusRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: second.id, status: 'paused' })],
    })

    const readRes = await jsonFetch(`/api/scheduled-agent-triggers/${second.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: second.id,
      schedule: { intervalSeconds: 7200, windowSeconds: 300 },
      metadata: { lane: 'beta' },
    })

    const patchRes = await jsonFetch(`/api/scheduled-agent-triggers/${second.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Beta heartbeat updated',
        status: 'active',
        schedule: { intervalSeconds: 1800, windowSeconds: 60 },
        nextDueAt: '2026-05-26T13:00:00.000Z',
        metadata: { lane: 'beta', updated: true },
      }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: second.id,
      name: 'Beta heartbeat updated',
      status: 'active',
      nextDueAt: '2026-05-26T13:00:00.000Z',
      schedule: { intervalSeconds: 1800, windowSeconds: 60 },
      metadata: { lane: 'beta', updated: true },
    })

    const invalidPatchRes = await jsonFetch(`/api/scheduled-agent-triggers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ schedule: { intervalSeconds: 30 } }),
    })
    expect(invalidPatchRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/scheduled-agent-triggers/${first.id}`, authorization, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)
    const archivedReadRes = await jsonFetch(`/api/scheduled-agent-triggers/${first.id}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({
      id: first.id,
      status: 'archived',
      archivedAt: expect.any(String),
    })

    const auditRes = await jsonFetch('/api/audit-records?action=scheduled_trigger', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; resourceId: string }> }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'scheduled_trigger.create', resourceId: first.id }),
        expect.objectContaining({ action: 'scheduled_trigger.update', resourceId: second.id }),
        expect.objectContaining({ action: 'scheduled_trigger.archive', resourceId: first.id }),
      ]),
    )
  })

  it('rejects secret-like metadata keys on create and update before storing trigger metadata', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)

    const createRes = await jsonFetch('/api/scheduled-agent-triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Rejected secret metadata heartbeat',
        promptTemplate: 'Should not persist.',
        schedule: { intervalSeconds: 3600 },
        metadata: { private_key: 'raw-private-key-value' },
      }),
    })
    expect(createRes.status).toBe(400)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            metadata: 'Secret material must be stored in vault references.',
          },
        },
      },
    })

    const searchRejectedRes = await jsonFetch(
      '/api/scheduled-agent-triggers?search=Rejected secret metadata',
      authorization,
    )
    expect(searchRejectedRes.status).toBe(200)
    await expect(searchRejectedRes.json()).resolves.toMatchObject({ data: [] })

    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Safe metadata heartbeat',
      metadata: { owner: 'platform' },
    })
    const updateRes = await jsonFetch(`/api/scheduled-agent-triggers/${trigger.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: {
          nested: {
            privateKey: 'raw-private-key-value',
          },
        },
      }),
    })
    expect(updateRes.status).toBe(400)
    await expect(updateRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            metadata: 'Secret material must be stored in vault references.',
          },
        },
      },
    })

    const readRes = await jsonFetch(`/api/scheduled-agent-triggers/${trigger.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: trigger.id,
      metadata: { owner: 'platform' },
    })
  })

  it('creates one session per due trigger occurrence and dedupes duplicate dispatches', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const runtimeSecret = await createRuntimeSecret(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'
    const heartbeatAt = '2026-05-26T12:01:00.000Z'

    const createRes = await jsonFetch('/api/scheduled-agent-triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Banking bonus heartbeat',
        promptTemplate: 'Research current Canadian banking bonus offers.',
        resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban' }],
        runtimeEnv: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
        runtimeSecretEnv: [{ name: 'AK_AGENT_KEY', ref: runtimeSecret.activeVersionId }],
        schedule: { type: 'interval', intervalSeconds: 3600 },
        nextDueAt: dueAt,
        metadata: { externalRunGroup: 'banking-bonus' },
      }),
    })
    expect(createRes.status).toBe(201)
    const trigger = (await createRes.json()) as {
      id: string
      nextDueAt: string
      status: string
      schedule: { intervalSeconds: number }
    }
    expect(trigger).toMatchObject({
      status: 'active',
      nextDueAt: dueAt,
      resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban' }],
      runtimeEnv: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
      runtimeSecretEnv: [{ name: 'AK_AGENT_KEY', ref: runtimeSecret.activeVersionId }],
      schedule: { intervalSeconds: 3600 },
    })

    const dispatchRes = await jsonFetch('/api/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(dispatchRes.status).toBe(200)
    const dispatch = (await dispatchRes.json()) as {
      claimed: number
      sessionCreated: number
      skipped: number
      runs: Array<{
        runId: string
        sessionId: string
        scheduledFor: string
        status: string
        errorMessage: string | null
      }>
    }
    expect(dispatch).toMatchObject({
      claimed: 1,
      sessionCreated: 1,
      skipped: 0,
      runs: [expect.objectContaining({ scheduledFor: dueAt, status: 'session_created' })],
    })
    const sessionId = dispatch.runs[0]?.sessionId
    expect(sessionId).toMatch(/^session_/)

    const duplicateDispatchRes = await jsonFetch('/api/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(duplicateDispatchRes.status).toBe(200)
    await expect(duplicateDispatchRes.json()).resolves.toMatchObject({
      claimed: 0,
      sessionCreated: 0,
      runs: [],
    })

    const sessionRes = await jsonFetch(`/api/sessions/${sessionId}`, authorization)
    expect(sessionRes.status).toBe(200)
    const session = await sessionRes.json()
    expect(session).toMatchObject({
      id: sessionId,
      resourceRefs: [
        {
          type: 'github_repository',
          owner: 'saltbo',
          repo: 'agent-kanban',
          mountPath: '/workspace/repos/saltbo/agent-kanban',
        },
      ],
      runtimeEnv: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
      runtimeSecretEnv: [{ name: 'AK_AGENT_KEY', ref: runtimeSecret.activeVersionId }],
      metadata: expect.objectContaining({
        source: 'scheduled-agent-trigger',
        scheduledTriggerId: trigger.id,
        scheduledRunId: dispatch.runs[0]?.runId,
        scheduledFor: dueAt,
        correlationId: `schedule:${trigger.id}:${dueAt}`,
        externalRunGroup: 'banking-bonus',
      }),
    })

    const runsRes = await jsonFetch(`/api/scheduled-agent-triggers/${trigger.id}/runs`, authorization)
    expect(runsRes.status).toBe(200)
    const runs = (await runsRes.json()) as {
      data: Array<{
        sessionId: string
        status: string
        scheduledFor: string
        correlationId: string
        idempotencyKey: string
      }>
    }
    expect(runs.data).toHaveLength(1)
    expect(runs.data[0]).toMatchObject({
      sessionId,
      status: 'session_created',
      scheduledFor: dueAt,
      correlationId: `schedule:${trigger.id}:${dueAt}`,
      idempotencyKey: `${trigger.id}:${dueAt}`,
    })

    const filteredRunsRes = await jsonFetch(
      `/api/scheduled-agent-triggers/${trigger.id}/runs?status=session_created&search=${encodeURIComponent(trigger.id)}&limit=1`,
      authorization,
    )
    expect(filteredRunsRes.status).toBe(200)
    await expect(filteredRunsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ sessionId, status: 'session_created' })],
      pagination: expect.objectContaining({ hasMore: false }),
    })

    const eventsRes = await jsonFetch(`/api/sessions/${sessionId}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = await eventsRes.text()
    expect(events).toContain('Research current Canadian banking bonus offers.')

    const auditRes = await jsonFetch('/api/audit-records?action=scheduled_trigger.dispatch', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as {
      data: Array<{ actorType: string; actorUserId: string | null; sessionId: string | null; outcome: string }>
    }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorType: 'system',
          actorUserId: null,
          sessionId,
          outcome: 'success',
        }),
      ]),
    )
  })

  it('does not dispatch paused or archived triggers', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'

    const pausedRes = await jsonFetch('/api/scheduled-agent-triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Paused heartbeat',
        promptTemplate: 'Do not run.',
        schedule: { intervalSeconds: 3600 },
        nextDueAt: dueAt,
        status: 'paused',
      }),
    })
    expect(pausedRes.status).toBe(201)
    const paused = (await pausedRes.json()) as { id: string }

    const activeRes = await jsonFetch('/api/scheduled-agent-triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Archived heartbeat',
        promptTemplate: 'Do not run either.',
        schedule: { intervalSeconds: 3600 },
        nextDueAt: dueAt,
      }),
    })
    expect(activeRes.status).toBe(201)
    const active = (await activeRes.json()) as { id: string }
    const archiveRes = await jsonFetch(`/api/scheduled-agent-triggers/${active.id}`, authorization, {
      method: 'DELETE',
    })
    expect(archiveRes.status).toBe(204)

    const dispatchRes = await jsonFetch('/api/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    await expect(dispatchRes.json()).resolves.toMatchObject({ claimed: 0, sessionCreated: 0 })

    const pausedRunsRes = await jsonFetch(`/api/scheduled-agent-triggers/${paused.id}/runs`, authorization)
    await expect(pausedRunsRes.json()).resolves.toMatchObject({ data: [] })
    const archivedRunsRes = await jsonFetch(`/api/scheduled-agent-triggers/${active.id}/runs`, authorization)
    await expect(archivedRunsRes.json()).resolves.toMatchObject({ data: [] })
  })
})
