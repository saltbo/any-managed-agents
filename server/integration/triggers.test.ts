import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider, signIn } from './auth'

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
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Trigger workspace ${crypto.randomUUID()}`,
      runtimeConfig: { image: 'ama-tool-executor' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Trigger agent ${crypto.randomUUID()}`,
      instructions: 'Run scheduled work.',
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createRuntimeCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `Trigger runtime secrets ${crypto.randomUUID()}` }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'AK agent session key',
      type: 'session_env_secret',
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-ak-agent-key' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as { id: string; activeVersionId: string }
}

async function createTrigger(
  authorization: string,
  agentId: string,
  environmentId: string,
  data: Record<string, unknown> = {},
) {
  const res = await jsonFetch('/api/v1/triggers', authorization, {
    method: 'POST',
    body: JSON.stringify({
      agentId,
      environmentId,
      runtime: 'ama',
      name: `Trigger ${crypto.randomUUID()}`,
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
    enabled: boolean
    archivedAt: string | null
    metadata: Record<string, unknown>
    resourceRefs: Record<string, unknown>[]
    env: Record<string, string>
    secretEnv: Array<{ name: string; credentialRef: { credentialId: string; versionId?: string } }>
    schedule: { intervalSeconds: number; windowSeconds: number }
  }
}

describe('[CF] /api/v1/triggers', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, lists, reads, updates, pauses, archives, restores, and audits triggers [spec: triggers/api-crud]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const first = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Alpha heartbeat',
      metadata: { lane: 'alpha' },
    })
    expect(first.enabled).toBe(true)
    expect(first.archivedAt).toBeNull()
    expect(first).not.toHaveProperty('status')
    expect(first).not.toHaveProperty('organizationId')
    const second = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Beta heartbeat',
      metadata: { lane: 'beta' },
      schedule: { intervalSeconds: 7200, windowSeconds: 300 },
      enabled: false,
    })
    expect(second.enabled).toBe(false)

    const listRes = await jsonFetch('/api/v1/triggers?limit=1', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ id: string; name: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(list.data).toHaveLength(1)
    expect(list.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/v1/triggers?limit=1&cursor=${list.pagination.nextCursor}`, authorization)
    expect(nextPageRes.status).toBe(200)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((trigger) => trigger.id)).not.toEqual(list.data.map((trigger) => trigger.id))

    const searchRes = await jsonFetch('/api/v1/triggers?search=Alpha', authorization)
    expect(searchRes.status).toBe(200)
    await expect(searchRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: first.id, name: 'Alpha heartbeat' })],
    })

    const pausedRes = await jsonFetch('/api/v1/triggers?enabled=false', authorization)
    expect(pausedRes.status).toBe(200)
    await expect(pausedRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: second.id, enabled: false })],
    })

    const readRes = await jsonFetch(`/api/v1/triggers/${second.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: second.id,
      schedule: { intervalSeconds: 7200, windowSeconds: 300 },
      metadata: { lane: 'beta' },
    })

    const patchRes = await jsonFetch(`/api/v1/triggers/${second.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Beta heartbeat updated',
        enabled: true,
        schedule: { intervalSeconds: 1800, windowSeconds: 60 },
        nextDueAt: '2026-05-26T13:00:00.000Z',
        metadata: { lane: 'beta', updated: true },
      }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: second.id,
      name: 'Beta heartbeat updated',
      enabled: true,
      nextDueAt: '2026-05-26T13:00:00.000Z',
      schedule: { intervalSeconds: 1800, windowSeconds: 60 },
      metadata: { lane: 'beta', updated: true },
    })

    const invalidPatchRes = await jsonFetch(`/api/v1/triggers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ schedule: { intervalSeconds: 30 } }),
    })
    expect(invalidPatchRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/v1/triggers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({
      id: first.id,
      archivedAt: expect.any(String),
    })

    const archivedReadRes = await jsonFetch(`/api/v1/triggers/${first.id}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({
      id: first.id,
      archivedAt: expect.any(String),
    })

    const defaultListRes = await jsonFetch('/api/v1/triggers', authorization)
    const defaultList = (await defaultListRes.json()) as { data: Array<{ id: string }> }
    expect(defaultList.data).not.toContainEqual(expect.objectContaining({ id: first.id }))

    const archivedListRes = await jsonFetch('/api/v1/triggers?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: first.id }))

    const updateArchivedRes = await jsonFetch(`/api/v1/triggers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Cannot touch this' }),
    })
    expect(updateArchivedRes.status).toBe(409)
    await expect(updateArchivedRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Archived triggers cannot be updated' },
    })

    const restoreRes = await jsonFetch(`/api/v1/triggers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)
    await expect(restoreRes.json()).resolves.toMatchObject({ id: first.id, archivedAt: null })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=trigger', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; resourceId: string }> }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'trigger.create', resourceId: first.id }),
        expect.objectContaining({ action: 'trigger.update', resourceId: second.id }),
        expect.objectContaining({ action: 'trigger.archive', resourceId: first.id }),
      ]),
    )
  })

  it('rejects secret-like metadata keys on create and update before storing trigger metadata', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
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

    const searchRejectedRes = await jsonFetch('/api/v1/triggers?search=Rejected secret metadata', authorization)
    expect(searchRejectedRes.status).toBe(200)
    await expect(searchRejectedRes.json()).resolves.toMatchObject({ data: [] })

    const envCreateRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Rejected secret env heartbeat',
        promptTemplate: 'Should not persist either.',
        schedule: { intervalSeconds: 3600 },
        env: { AK_API_TOKEN: 'raw-token-value' },
      }),
    })
    expect(envCreateRes.status).toBe(400)
    await expect(envCreateRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            env: 'Environment variables must not contain raw secret material.',
          },
        },
      },
    })

    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Safe metadata heartbeat',
      metadata: { owner: 'platform' },
    })
    const updateRes = await jsonFetch(`/api/v1/triggers/${trigger.id}`, authorization, {
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

    const readRes = await jsonFetch(`/api/v1/triggers/${trigger.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: trigger.id,
      metadata: { owner: 'platform' },
    })
  })

  it('creates one session per due trigger occurrence and exposes run resources [spec: triggers/dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const credential = await createRuntimeCredential(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'
    const heartbeatAt = '2026-05-26T12:01:00.000Z'

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Banking bonus heartbeat',
        promptTemplate: 'Research current Canadian banking bonus offers.',
        resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban' }],
        env: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
        secretEnv: [
          {
            name: 'AK_AGENT_KEY',
            credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
          },
        ],
        schedule: { type: 'interval', intervalSeconds: 3600 },
        nextDueAt: dueAt,
        metadata: { externalRunGroup: 'banking-bonus' },
      }),
    })
    expect(createRes.status).toBe(201)
    const trigger = (await createRes.json()) as {
      id: string
      nextDueAt: string
      enabled: boolean
      schedule: { intervalSeconds: number }
    }
    expect(trigger).toMatchObject({
      enabled: true,
      nextDueAt: dueAt,
      resourceRefs: [{ type: 'github_repository', owner: 'saltbo', repo: 'agent-kanban' }],
      env: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
      secretEnv: [
        {
          name: 'AK_AGENT_KEY',
          credentialRef: { credentialId: credential.id, versionId: credential.activeVersionId },
        },
      ],
      schedule: { intervalSeconds: 3600 },
    })

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(dispatchRes.status).toBe(200)
    const dispatch = (await dispatchRes.json()) as {
      claimed: number
      sessionCreated: number
      skipped: number
      runs: Array<{ runId: string; sessionId: string; scheduledFor: string }>
    }
    expect(dispatch).toMatchObject({
      claimed: 1,
      sessionCreated: 1,
      skipped: 0,
    })
    const sessionId = dispatch.runs[0]?.sessionId
    expect(sessionId).toBeTruthy()

    const duplicateDispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(duplicateDispatchRes.status).toBe(200)
    await expect(duplicateDispatchRes.json()).resolves.toMatchObject({
      claimed: 0,
      sessionCreated: 0,
      runs: [],
    })

    const runsRes = await jsonFetch(`/api/v1/triggers/${trigger.id}/runs`, authorization)
    expect(runsRes.status).toBe(200)
    const runs = (await runsRes.json()) as {
      data: Array<{
        id: string
        sessionId: string
        state: string
        scheduledFor: string
        correlationId: string
        idempotencyKey: string
      }>
    }
    expect(runs.data).toHaveLength(1)
    expect(runs.data[0]).toMatchObject({
      sessionId,
      state: 'session_created',
      scheduledFor: dueAt,
      correlationId: `schedule:${trigger.id}:${dueAt}`,
      idempotencyKey: `${trigger.id}:${dueAt}`,
    })
    expect(runs.data[0]).not.toHaveProperty('status')

    const runItemRes = await jsonFetch(`/api/v1/triggers/${trigger.id}/runs/${runs.data[0].id}`, authorization)
    expect(runItemRes.status).toBe(200)
    await expect(runItemRes.json()).resolves.toMatchObject({
      id: runs.data[0].id,
      triggerId: trigger.id,
      sessionId,
      state: 'session_created',
    })

    const missingRunRes = await jsonFetch(`/api/v1/triggers/${trigger.id}/runs/trigrun_missing`, authorization)
    expect(missingRunRes.status).toBe(404)

    const filteredRunsRes = await jsonFetch(
      `/api/v1/triggers/${trigger.id}/runs?state=session_created&search=${encodeURIComponent(trigger.id)}&limit=1`,
      authorization,
    )
    expect(filteredRunsRes.status).toBe(200)
    await expect(filteredRunsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ sessionId, state: 'session_created' })],
      pagination: expect.objectContaining({ hasMore: false }),
    })

    const failedRunsRes = await jsonFetch(`/api/v1/triggers/${trigger.id}/runs?state=failed`, authorization)
    expect(failedRunsRes.status).toBe(200)
    await expect(failedRunsRes.json()).resolves.toMatchObject({ data: [] })
  })

  it('does not dispatch paused or archived triggers [spec: triggers/inactive]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'

    const paused = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Paused heartbeat',
      promptTemplate: 'Do not run.',
      nextDueAt: dueAt,
      enabled: false,
    })

    const archived = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Archived heartbeat',
      promptTemplate: 'Do not run either.',
      nextDueAt: dueAt,
    })
    const archiveRes = await jsonFetch(`/api/v1/triggers/${archived.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    await expect(dispatchRes.json()).resolves.toMatchObject({ claimed: 0, sessionCreated: 0 })

    const pausedRunsRes = await jsonFetch(`/api/v1/triggers/${paused.id}/runs`, authorization)
    await expect(pausedRunsRes.json()).resolves.toMatchObject({ data: [] })
    const archivedRunsRes = await jsonFetch(`/api/v1/triggers/${archived.id}/runs`, authorization)
    await expect(archivedRunsRes.json()).resolves.toMatchObject({ data: [] })
  })
})
