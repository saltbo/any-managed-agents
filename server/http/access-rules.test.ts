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

describe('[CF] v1 access rules', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates wildcard rules when provider and model scopes are omitted [spec: governance/access-rule-api]', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/access-rules', authorization, {
      method: 'POST',
      body: JSON.stringify({ effect: 'deny', reason: 'Project-wide model access is paused.' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }
    expect(created).toMatchObject({
      providerId: '*',
      modelId: '*',
      teamId: null,
      effect: 'deny',
      reason: 'Project-wide model access is paused.',
    })
    expect(JSON.stringify(created)).not.toContain('organizationId')

    const listRes = await jsonFetch('/api/v1/access-rules', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ id: created.id }))

    const readRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, effect: 'deny' })
  })

  it('creates scoped team rules and updates effect, reason, and metadata', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/access-rules', authorization, {
      method: 'POST',
      body: JSON.stringify({
        providerId: 'workers-ai',
        modelId: '@cf/moonshotai/kimi-k2.6',
        teamId: 'team_platform',
        effect: 'allow',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }
    expect(created).toMatchObject({
      providerId: 'workers-ai',
      modelId: '@cf/moonshotai/kimi-k2.6',
      teamId: 'team_platform',
      effect: 'allow',
      reason: null,
    })

    const patchRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ effect: 'deny', reason: 'Under review.', metadata: { source: 'console' } }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: created.id,
      providerId: 'workers-ai',
      effect: 'deny',
      reason: 'Under review.',
      metadata: { source: 'console' },
    })

    const clearReasonRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ reason: null }),
    })
    expect(clearReasonRes.status).toBe(200)
    await expect(clearReasonRes.json()).resolves.toMatchObject({ id: created.id, effect: 'deny', reason: null })
  })

  it('deletes rules for real and 404s afterwards', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/access-rules', authorization, {
      method: 'POST',
      body: JSON.stringify({ effect: 'deny' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const deleteRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const goneRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization)
    expect(goneRes.status).toBe(404)

    const patchGoneRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ effect: 'allow' }),
    })
    expect(patchGoneRes.status).toBe(404)

    const deleteGoneRes = await jsonFetch(`/api/v1/access-rules/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteGoneRes.status).toBe(404)
  })
})
