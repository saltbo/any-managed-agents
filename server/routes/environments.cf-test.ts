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

describe('[CF] /api/environments', () => {
  beforeEach(async () => {
    await setupFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication before creating project-scoped environments', async () => {
    const res = await SELF.fetch('https://example.com/api/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Node workspace' }),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('creates, reads, updates, versions, and archives project-scoped environments without raw secrets', async () => {
    const cookie = await signIn()
    const createRes = await jsonFetch('/api/environments', cookie, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Node workspace',
        packages: [{ name: 'tsx', version: 'latest' }],
        variables: { NODE_ENV: { description: 'Runtime mode', required: true } },
        secretRefs: [{ name: 'NPM_TOKEN', ref: 'vault_secret_123' }],
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 512 },
        runtimeImage: { image: 'node:24' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      currentVersionId: string
      version: number
      secretRefs: unknown[]
    }
    expect(created.version).toBe(1)
    expect(JSON.stringify(created)).not.toContain('raw-secret')

    const readRes = await jsonFetch(`/api/environments/${created.id}`, cookie)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      packages: [{ name: 'tsx', version: 'latest' }],
      secretRefs: [{ name: 'NPM_TOKEN', ref: 'vault_secret_123' }],
    })

    const updateRes = await jsonFetch(`/api/environments/${created.id}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { version: number; currentVersionId: string }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)

    const versionsRes = await jsonFetch(`/api/environments/${created.id}/versions`, cookie)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{ version: number; packages: Array<{ name: string }> }>
    }
    expect(versions.data.map((version) => version.version)).toEqual([2, 1])
    expect(versions.data.find((version) => version.version === 1)?.packages).toEqual([
      { name: 'tsx', version: 'latest' },
    ])

    const archiveRes = await jsonFetch(`/api/environments/${created.id}`, cookie, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const listRes = await jsonFetch('/api/environments', cookie)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/environments?includeArchived=true', cookie)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))

    const archivedReadRes = await jsonFetch(`/api/environments/${created.id}`, cookie)
    expect(archivedReadRes.status).toBe(200)
  })

  it('lists environments with pagination, search, status, and date filters', async () => {
    const cookie = await signIn()
    const alphaRes = await jsonFetch('/api/environments', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha workspace' }),
    })
    const alpha = (await alphaRes.json()) as { id: string; createdAt: string }
    const betaRes = await jsonFetch('/api/environments', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta workspace' }),
    })
    const beta = (await betaRes.json()) as { id: string; createdAt: string }
    await jsonFetch(`/api/environments/${alpha.id}`, cookie, { method: 'DELETE' })

    const pagedRes = await jsonFetch('/api/environments?includeArchived=true&limit=1', cookie)
    const paged = (await pagedRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)
    expect(paged.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/environments?includeArchived=true&limit=1&cursor=${paged.pagination.nextCursor}`,
      cookie,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((environment) => environment.id)).not.toEqual(
      paged.data.map((environment) => environment.id),
    )

    const searchRes = await jsonFetch('/api/environments?includeArchived=true&search=Alpha', cookie)
    const search = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(search.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const statusRes = await jsonFetch('/api/environments?includeArchived=true&status=archived', cookie)
    const status = (await statusRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(status.data).toContainEqual(expect.objectContaining({ id: alpha.id, status: 'archived' }))
    expect(status.data.every((environment) => environment.status === 'archived')).toBe(true)

    const dateRes = await jsonFetch(
      `/api/environments?includeArchived=true&createdFrom=${encodeURIComponent(alpha.createdAt)}&createdTo=${encodeURIComponent(beta.createdAt)}`,
      cookie,
    )
    const date = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(date.data.map((environment) => environment.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]))
  })

  it('returns 404 for cross-project environment access', async () => {
    const cookie = await signIn()
    const createRes = await jsonFetch('/api/environments', cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tenant environment' }),
    })
    const environment = (await createRes.json()) as { id: string }
    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })

    const crossProjectRead = await jsonFetch(`/api/environments/${environment.id}`, otherCookie)
    expect(crossProjectRead.status).toBe(404)
  })
})
