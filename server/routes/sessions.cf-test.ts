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
      runtimeImage: { image: 'ama-pi-runtime' },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function createAgent(cookie: string, environmentId: string) {
  const res = await jsonFetch('/api/agents', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Pi session agent',
      instructions: 'Work through Pi.',
      defaultEnvironmentId: environmentId,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; currentVersionId: string }
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
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie, environment.id)

    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      status: string
      agentVersionId: string
      agentSnapshot: { instructions: string }
      environmentVersionId: string
      sandboxId: string
      piRuntimeId: string
      piProcessId: string
      runtimeEndpointPath: string
      startedAt: string
      metadata: Record<string, unknown>
      modelConfig: Record<string, unknown>
    }
    expect(created).toMatchObject({
      status: 'idle',
      agentVersionId: agent.currentVersionId,
      agentSnapshot: { instructions: 'Work through Pi.' },
      sandboxId: created.id.toLowerCase(),
      piRuntimeId: `pi_${created.id}`,
      piProcessId: `proc_${created.id}`,
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
      metadata: { runtime: 'pi', protocol: 'pi-rpc-jsonl', runtimeMode: 'test', bridge: 'fake' },
      modelConfig: { provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' },
    })
    expect(created.environmentVersionId).toMatch(/^envver_/)
    expect(created.startedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/sessions', cookie)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))

    const readRes = await jsonFetch(`/api/sessions/${created.id}`, cookie)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, status: 'idle' })

    const reconnectRes = await jsonFetch(`/api/sessions/${created.id}/reconnect`, cookie)
    expect(reconnectRes.status).toBe(200)
    await expect(reconnectRes.json()).resolves.toMatchObject({
      id: created.id,
      runtimeEndpointPath: `/runtime/sessions/${created.id}/rpc`,
    })

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
    }
    expect(events.data.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(events.data.map((event) => event.type)).toEqual(['lifecycle', 'sandbox', 'lifecycle'])
    expect(events.data).toEqual([
      expect.objectContaining({
        visibility: 'audit',
        payload: { status: 'pending', reason: 'session_created' },
        metadata: {},
        parentEventId: null,
        correlationId: null,
      }),
      expect.objectContaining({
        visibility: 'debug',
        payload: {
          sandboxId: created.sandboxId,
          piRuntimeId: created.piRuntimeId,
          runtimeEndpointPath: created.runtimeEndpointPath,
        },
        metadata: {},
      }),
      expect.objectContaining({
        visibility: 'audit',
        payload: { status: 'stopped', sandboxId: created.sandboxId, piRuntimeId: created.piRuntimeId },
        metadata: {},
      }),
    ])

    const archiveRes = await jsonFetch(`/api/sessions/${created.id}`, cookie, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const archivedListRes = await jsonFetch('/api/sessions?includeArchived=true', cookie)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))
  })

  it('enforces auth and project tenancy for session lifecycle', async () => {
    const unauthenticatedRes = await SELF.fetch('https://example.com/api/sessions')
    expect(unauthenticatedRes.status).toBe(401)

    const cookie = await signIn()
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie, environment.id)
    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id }),
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

  it('rereads stored snapshots after agent and environment updates', async () => {
    const cookie = await signIn()
    const environment = await createEnvironment(cookie)
    const agent = await createAgent(cookie, environment.id)

    const createRes = await jsonFetch('/api/sessions', cookie, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id }),
    })
    const created = (await createRes.json()) as {
      id: string
      agentSnapshot: { instructions: string; version: number }
      environmentSnapshot: { packages: Array<{ name: string; version?: string }> }
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
      agentSnapshot: { instructions: 'Work through Pi.', version: 1 },
      environmentSnapshot: {
        packages: [{ name: '@earendil-works/pi-coding-agent', version: 'prebuilt' }],
      },
    })
  })
})
