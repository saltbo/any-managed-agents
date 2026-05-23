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
      name: 'Node workspace',
      packages: [{ name: 'tsx', version: 'latest' }],
      variables: { NODE_ENV: { description: 'Runtime mode' } },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; currentVersionId: string; version: number }
}

describe('[CF] /api/agents', () => {
  beforeEach(async () => {
    await setupFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'validation_error',
        message: 'Invalid request',
      },
    })
  })

  it('requires authentication before creating project-scoped agents', async () => {
    const createRes = await SELF.fetch('https://example.com/api/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Research assistant',
        model: '@cf/moonshotai/kimi-k2.6',
        systemPrompt: 'Answer with citations.',
      }),
    })

    expect(createRes.status).toBe(401)
    expect(await createRes.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('creates, reads, updates, versions, and archives project-scoped agents', async () => {
    const cookie = await signIn()
    const environment = await createEnvironment(cookie)

    const createRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Research assistant',
        instructions: 'Answer with citations.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        allowedTools: ['web.search'],
        sandboxPolicy: { network: 'enabled', filesystem: 'workspace' },
        defaultEnvironmentId: environment.id,
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; currentVersionId: string; version: number }
    expect(created.version).toBe(1)

    const readRes = await jsonFetch(`/api/agents/${created.id}`, cookie)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      version: 1,
      allowedTools: ['web.search'],
      defaultEnvironmentId: environment.id,
    })

    const updateRes = await jsonFetch(`/api/agents/${created.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'Answer briefly.' }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { version: number; currentVersionId: string }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)

    const versionsRes = await jsonFetch(`/api/agents/${created.id}/versions`, cookie)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as { data: Array<{ version: number; instructions: string }> }
    expect(versions.data.map((version) => version.version)).toEqual([2, 1])
    expect(versions.data.find((version) => version.version === 1)?.instructions).toBe('Answer with citations.')

    const archiveRes = await jsonFetch(`/api/agents/${created.id}`, cookie, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const listRes = await jsonFetch('/api/agents', cookie)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))

    const archivedListRes = await jsonFetch('/api/agents?includeArchived=true', cookie)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))

    const archivedReadRes = await jsonFetch(`/api/agents/${created.id}`, cookie)
    expect(archivedReadRes.status).toBe(200)
  })

  it('keeps session snapshots stable after agent and environment updates', async () => {
    const cookie = await signIn()
    const environment = await createEnvironment(cookie)
    const agentRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Snapshot agent',
        instructions: 'Original instructions.',
        defaultEnvironmentId: environment.id,
      }),
    })
    const agent = (await agentRes.json()) as { id: string }

    const sessionRes = await jsonFetch(`/api/agents/${agent.id}/sessions`, cookie, { method: 'POST' })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as {
      agentVersionId: string
      agentSnapshot: { version: number; instructions: string }
      environmentVersionId: string
      environmentSnapshot: { version: number; packages: Array<{ name: string }> }
    }
    expect(session.agentSnapshot).toMatchObject({ version: 1, instructions: 'Original instructions.' })
    expect(session.environmentSnapshot.version).toBe(1)

    await jsonFetch(`/api/environments/${environment.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    await jsonFetch(`/api/agents/${agent.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'New instructions.' }),
    })

    expect(session.agentSnapshot).toMatchObject({ version: 1, instructions: 'Original instructions.' })
    expect(session.environmentSnapshot.packages).toEqual([{ name: 'tsx', version: 'latest' }])
  })

  it('rejects new sessions for archived agents and archived default environments', async () => {
    const cookie = await signIn()
    const environment = await createEnvironment(cookie)
    const agentRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Archived session agent', defaultEnvironmentId: environment.id }),
    })
    const agent = (await agentRes.json()) as { id: string }

    await jsonFetch(`/api/environments/${environment.id}`, cookie, { method: 'DELETE' })
    const archivedEnvironmentSessionRes = await jsonFetch(`/api/agents/${agent.id}/sessions`, cookie, {
      method: 'POST',
    })
    expect(archivedEnvironmentSessionRes.status).toBe(409)
    await expect(archivedEnvironmentSessionRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Default environment is archived or unavailable' },
    })

    const noEnvironmentAgentRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Archived agent' }),
    })
    const noEnvironmentAgent = (await noEnvironmentAgentRes.json()) as { id: string }
    await jsonFetch(`/api/agents/${noEnvironmentAgent.id}`, cookie, { method: 'DELETE' })

    const archivedAgentSessionRes = await jsonFetch(`/api/agents/${noEnvironmentAgent.id}/sessions`, cookie, {
      method: 'POST',
    })
    expect(archivedAgentSessionRes.status).toBe(409)
    await expect(archivedAgentSessionRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Archived agents cannot create sessions' },
    })
  })

  it('rejects invalid model, blocked tools, invalid sandbox policy, and cross-project reads', async () => {
    const cookie = await signIn()
    const invalidModelRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid model', model: 'blocked-model' }),
    })
    expect(invalidModelRes.status).toBe(400)
    await expect(invalidModelRes.json()).resolves.toMatchObject({
      error: { details: { fields: { model: expect.any(String) } } },
    })

    const blockedToolRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Blocked tool', allowedTools: ['secrets.read'] }),
    })
    expect(blockedToolRes.status).toBe(400)
    await expect(blockedToolRes.json()).resolves.toMatchObject({
      error: { details: { fields: { allowedTools: expect.any(String) } } },
    })

    const invalidPolicyRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid policy', sandboxPolicy: { network: 'maybe' } }),
    })
    expect(invalidPolicyRes.status).toBe(400)

    const invalidEnvironmentRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid environment', defaultEnvironmentId: 'env_missing' }),
    })
    expect(invalidEnvironmentRes.status).toBe(400)
    await expect(invalidEnvironmentRes.json()).resolves.toMatchObject({
      error: { details: { fields: { defaultEnvironmentId: expect.any(String) } } },
    })

    const validEnvironment = await createEnvironment(cookie)
    const validAgentRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Valid environment agent', defaultEnvironmentId: validEnvironment.id }),
    })
    const validAgent = (await validAgentRes.json()) as { id: string }
    await jsonFetch(`/api/environments/${validEnvironment.id}`, cookie, { method: 'DELETE' })
    const archivedEnvironmentUpdateRes = await jsonFetch(`/api/agents/${validAgent.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ defaultEnvironmentId: validEnvironment.id }),
    })
    expect(archivedEnvironmentUpdateRes.status).toBe(400)
    await expect(archivedEnvironmentUpdateRes.json()).resolves.toMatchObject({
      error: { details: { fields: { defaultEnvironmentId: expect.any(String) } } },
    })

    const createRes = await jsonFetch('/api/agents', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tenant agent' }),
    })
    const agent = (await createRes.json()) as { id: string }
    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })

    const crossProjectRead = await jsonFetch(`/api/agents/${agent.id}`, otherCookie)
    expect(crossProjectRead.status).toBe(404)
  })
})
