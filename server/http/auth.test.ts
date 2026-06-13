import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectAuthRequired, setupOidcProvider, signIn, signInUser } from '../test/auth'

function accessTokenOf(authorization: string) {
  return authorization.slice('Bearer '.length)
}

async function jsonFetch(path: string, authorization?: string, init?: { method?: string; body?: unknown }) {
  return SELF.fetch(`https://example.com${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

describe('[CF] auth v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the OIDC discovery config publicly', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      methods: [{ type: 'oidc', issuer: 'https://oidc.test', clientId: 'ama-test' }],
    })
  })

  it('accepts an organization hint on the discovery config', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/config?organization=example-org')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { methods: unknown[] }
    expect(body.methods).toHaveLength(1)
  })

  it('creates an auth session from a valid access token', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/auth/sessions', undefined, {
      body: { accessToken: accessTokenOf(authorization) },
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      user: Record<string, unknown>
      organization: Record<string, unknown>
      project: Record<string, unknown>
    }
    expect(body).toMatchObject({
      user: {
        id: expect.stringMatching(/^user_e2e_/),
        email: expect.stringContaining('@e2e.example.com'),
      },
      organization: {
        id: expect.stringMatching(/^org_e2e_/),
        name: expect.stringContaining('E2E Organization'),
      },
      project: {
        id: expect.stringMatching(/^project_/),
        name: 'Default project',
      },
    })
    expect(body.project).not.toHaveProperty('organizationId')
  })

  it('rejects invalid access tokens with 401', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions', undefined, {
      body: { accessToken: 'invalid-token' },
    })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'oidc_error', message: 'OIDC token validation failed' },
    })
  })

  it('rejects session creation from a disallowed origin', async () => {
    const authorization = await signIn()
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: JSON.stringify({ accessToken: accessTokenOf(authorization) }),
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'forbidden', message: 'Request origin is not allowed' },
    })
  })

  it('rejects malformed session creation payloads', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions', undefined, { body: {} })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid request' },
    })
  })

  it('reads the current session context from a bearer token', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/auth/sessions/current', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string }; project: Record<string, unknown> }
    expect(body).toMatchObject({
      user: { id: expect.stringMatching(/^user_e2e_/) },
      organization: { id: expect.stringMatching(/^org_e2e_/) },
      project: { name: 'Default project' },
    })
    expect(body.project).not.toHaveProperty('organizationId')
  })

  it('requires authentication for the current session context', async () => {
    const res = await jsonFetch('/api/v1/auth/sessions/current')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('signs out by expiring the session cookie', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/auth/sessions/current', { method: 'DELETE' })
    expect(res.status).toBe(204)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('ama_session=;')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('HttpOnly')
  })
})

describe('[CF] projects v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/projects')
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists the auto-created default project without exposing organizationId', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>
      pagination: Record<string, unknown>
    }
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({
      id: expect.stringMatching(/^project_/),
      name: 'Default project',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(body.data[0]).not.toHaveProperty('organizationId')
    expect(body.pagination).toEqual({ limit: 50, nextCursor: null, hasMore: false })
  })

  it('creates and reads a project', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/projects', authorization, {
      body: { name: 'Control Plane' },
    })
    expect(createRes.status).toBe(201)
    const project = (await createRes.json()) as Record<string, unknown> & { id: string }
    expect(project).toMatchObject({ id: expect.stringMatching(/^project_/), name: 'Control Plane' })
    expect(project).not.toHaveProperty('organizationId')

    const readRes = await jsonFetch(`/api/v1/projects/${project.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: project.id, name: 'Control Plane' })
  })

  it('returns 404 for unknown projects', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects/project_missing', authorization)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'not_found', message: 'Project not found' },
    })
  })

  it('does not read projects across organizations', async () => {
    const tenantA = await signInUser('proj_tenant_a')
    const createRes = await jsonFetch('/api/v1/projects', tenantA, { body: { name: 'Tenant A project' } })
    const project = (await createRes.json()) as { id: string }

    const tenantB = await signInUser('proj_tenant_b')
    const res = await jsonFetch(`/api/v1/projects/${project.id}`, tenantB)
    expect(res.status).toBe(404)
  })

  it('paginates the project list with cursors', async () => {
    const authorization = await signInUser('proj_paging')
    for (const name of ['Project One', 'Project Two', 'Project Three']) {
      const res = await jsonFetch('/api/v1/projects', authorization, { body: { name } })
      expect(res.status).toBe(201)
    }

    const firstPageRes = await jsonFetch('/api/v1/projects?limit=2', authorization)
    expect(firstPageRes.status).toBe(200)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(2)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const secondPageRes = await jsonFetch(
      `/api/v1/projects?limit=2&cursor=${encodeURIComponent(firstPage.pagination.nextCursor as string)}`,
      authorization,
    )
    expect(secondPageRes.status).toBe(200)
    const secondPage = (await secondPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean }
    }
    expect(secondPage.data.length).toBeGreaterThan(0)
    const firstPageIds = new Set(firstPage.data.map((row) => row.id))
    for (const row of secondPage.data) {
      expect(firstPageIds.has(row.id)).toBe(false)
    }
  })

  it('rejects invalid list cursors', async () => {
    const authorization = await signIn()
    const res = await jsonFetch('/api/v1/projects?cursor=not-a-cursor', authorization)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid list cursor' },
    })
  })
})
