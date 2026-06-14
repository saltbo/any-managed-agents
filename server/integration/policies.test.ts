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

describe('[CF] v1 policies', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, lists, reads, replaces, and deletes scoped policies [spec: governance/policy-api]', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({
        scope: { level: 'project' },
        toolPolicy: { blockedTools: ['sandbox.exec'] },
        metadata: { source: 'console' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; scope: { level: string }; toolPolicy: unknown }
    expect(created).toMatchObject({
      scope: { level: 'project' },
      toolPolicy: { blockedTools: ['sandbox.exec'] },
      mcpPolicy: {},
      sandboxPolicy: {},
      metadata: { source: 'console' },
    })
    expect(JSON.stringify(created)).not.toContain('organizationId')

    const listRes = await jsonFetch('/api/v1/policies', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: Record<string, unknown> }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination).toMatchObject({ hasMore: false, nextCursor: null })

    const readRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, scope: { level: 'project' } })

    // PUT is a full replacement: omitted policy objects reset to {}.
    const replaceRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ mcpPolicy: { defaultEffect: 'deny' } }),
    })
    expect(replaceRes.status).toBe(200)
    await expect(replaceRes.json()).resolves.toMatchObject({
      id: created.id,
      toolPolicy: {},
      mcpPolicy: { defaultEffect: 'deny' },
      metadata: {},
    })

    const deleteRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const goneRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization)
    expect(goneRes.status).toBe(404)
  })

  it('rejects duplicate scopes with 409 and validates team scope payloads', async () => {
    const authorization = await signIn()

    const firstRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'project' } }),
    })
    expect(firstRes.status).toBe(201)

    const duplicateRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'project' } }),
    })
    expect(duplicateRes.status).toBe(409)
    await expect(duplicateRes.json()).resolves.toMatchObject({ error: { type: 'conflict' } })

    const missingTeamRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'team' } }),
    })
    expect(missingTeamRes.status).toBe(400)
    await expect(missingTeamRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { 'scope.teamId': expect.any(String) } } },
    })

    const strayTeamRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'organization', teamId: 'team_platform' } }),
    })
    expect(strayTeamRes.status).toBe(400)

    const teamRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'team', teamId: 'team_platform' } }),
    })
    expect(teamRes.status).toBe(201)
    await expect(teamRes.json()).resolves.toMatchObject({ scope: { level: 'team', teamId: 'team_platform' } })

    const duplicateTeamRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'team', teamId: 'team_platform' } }),
    })
    expect(duplicateTeamRes.status).toBe(409)
  })

  it('keeps the policy scope immutable on replace', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'project' } }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const sameScopeRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ scope: { level: 'project' }, toolPolicy: { defaultEffect: 'deny' } }),
    })
    expect(sameScopeRes.status).toBe(200)

    const movedScopeRes = await jsonFetch(`/api/v1/policies/${created.id}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ scope: { level: 'organization' } }),
    })
    expect(movedScopeRes.status).toBe(400)
    await expect(movedScopeRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { scope: expect.any(String) } } },
    })
  })
})
