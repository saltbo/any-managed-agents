import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expectAuthRequired, setupOidcProvider, signInUser } from './auth'

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

async function createTenant(
  authorization: string,
  overrides?: Partial<{
    issuer: string
    externalTenantId: string
    environmentId: string
    capabilities: string[]
    metadata: Record<string, unknown>
  }>,
) {
  return jsonFetch('/api/v1/auth/federated-tenants', authorization, {
    body: {
      issuer: 'https://ak.example.com',
      // The (issuer, externalTenantId) pair is globally unique, so default to a
      // fresh external id per call to keep cases isolated within shared storage.
      externalTenantId: `org_external_${crypto.randomUUID()}`,
      capabilities: ['session:poll', 'session:claim'],
      metadata: { platform: 'agent-kanban' },
      ...overrides,
    },
  })
}

describe('[CF] federated tenants v1', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const listRes = await jsonFetch('/api/v1/auth/federated-tenants')
    expect(listRes.status).toBe(401)
    expectAuthRequired(await listRes.json())

    const createRes = await jsonFetch('/api/v1/auth/federated-tenants', undefined, {
      body: { issuer: 'https://ak.example.com', externalTenantId: 'org_external_123' },
    })
    expect(createRes.status).toBe(401)
  })

  it('creates a federated tenant with a normalized issuer', async () => {
    const authorization = await signInUser('fedt_create')
    const res = await createTenant(authorization, {
      issuer: 'https://ak.example.com/',
      externalTenantId: 'org_external_123',
    })
    expect(res.status).toBe(201)
    const tenant = (await res.json()) as Record<string, unknown>
    expect(tenant).toMatchObject({
      id: expect.stringMatching(/^ftn_/),
      issuer: 'https://ak.example.com',
      externalTenantId: 'org_external_123',
      projectId: expect.stringMatching(/^project_/),
      environmentId: null,
      capabilities: ['session:poll', 'session:claim'],
      enabled: true,
      metadata: { platform: 'agent-kanban' },
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    expect(tenant).not.toHaveProperty('organizationId')
  })

  it('rejects a duplicate issuer and external tenant pair with 409', async () => {
    const authorization = await signInUser('fedt_conflict')
    const externalTenantId = `org_external_${crypto.randomUUID()}`
    const first = await createTenant(authorization, { externalTenantId })
    expect(first.status).toBe(201)

    const second = await createTenant(authorization, { externalTenantId, capabilities: ['session:poll'] })
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toMatchObject({
      error: { type: 'conflict' },
    })
  })

  it('lists federated tenants for the current project with the pagination envelope', async () => {
    const authorization = await signInUser('fedt_list')
    const createRes = await createTenant(authorization)
    const tenant = (await createRes.json()) as { id: string }

    const listRes = await jsonFetch('/api/v1/auth/federated-tenants', authorization)
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as {
      data: Array<{ id: string }>
      pagination: Record<string, unknown>
    }
    expect(body.data.map((row) => row.id)).toEqual([tenant.id])
    expect(body.pagination).toEqual({ limit: 50, nextCursor: null, hasMore: false })
  })

  it('reads a federated tenant by id', async () => {
    const authorization = await signInUser('fedt_read')
    const createRes = await createTenant(authorization)
    const tenant = (await createRes.json()) as { id: string; externalTenantId: string }

    const readRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: tenant.id,
      issuer: 'https://ak.example.com',
      externalTenantId: tenant.externalTenantId,
    })
  })

  it('returns 404 for unknown federated tenants', async () => {
    const authorization = await signInUser('fedt_missing')
    const res = await jsonFetch('/api/v1/auth/federated-tenants/ftn_missing', authorization)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'not_found', message: 'Federated tenant not found' },
    })
  })

  it('updates enabled, capabilities, environmentId, and metadata', async () => {
    const authorization = await signInUser('fedt_update')
    const createRes = await createTenant(authorization)
    const tenant = (await createRes.json()) as { id: string; updatedAt: string }

    const patchRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization, {
      method: 'PATCH',
      body: {
        enabled: false,
        capabilities: ['session:poll'],
        environmentId: 'env_abc123',
        metadata: { platform: 'agent-kanban', note: 'paused for review' },
      },
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: tenant.id,
      enabled: false,
      capabilities: ['session:poll'],
      environmentId: 'env_abc123',
      metadata: { platform: 'agent-kanban', note: 'paused for review' },
    })

    const readRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization)
    await expect(readRes.json()).resolves.toMatchObject({ enabled: false, environmentId: 'env_abc123' })
  })

  it('clears environmentId with an explicit null', async () => {
    const authorization = await signInUser('fedt_env_clear')
    const createRes = await createTenant(authorization, { environmentId: 'env_abc123' })
    const tenant = (await createRes.json()) as { id: string }

    const patchRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization, {
      method: 'PATCH',
      body: { environmentId: null },
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({ id: tenant.id, environmentId: null })
  })

  it('rejects unknown update fields', async () => {
    const authorization = await signInUser('fedt_strict')
    const createRes = await createTenant(authorization)
    const tenant = (await createRes.json()) as { id: string }

    const patchRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization, {
      method: 'PATCH',
      body: { issuer: 'https://other.example.com' },
    })
    expect(patchRes.status).toBe(400)
    await expect(patchRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error' },
    })
  })

  it('deletes a federated tenant for real', async () => {
    const authorization = await signInUser('fedt_delete')
    const createRes = await createTenant(authorization)
    const tenant = (await createRes.json()) as { id: string }

    const deleteRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)

    const readRes = await jsonFetch(`/api/v1/auth/federated-tenants/${tenant.id}`, authorization)
    expect(readRes.status).toBe(404)

    const listRes = await jsonFetch('/api/v1/auth/federated-tenants', authorization)
    const body = (await listRes.json()) as { data: unknown[] }
    expect(body.data).toEqual([])
  })

  it('does not expose federated tenants across projects', async () => {
    const tenantA = await signInUser('fedt_tenant_a')
    const createRes = await createTenant(tenantA, { externalTenantId: 'org_external_isolated' })
    const created = (await createRes.json()) as { id: string }

    const tenantB = await signInUser('fedt_tenant_b')
    const readRes = await jsonFetch(`/api/v1/auth/federated-tenants/${created.id}`, tenantB)
    expect(readRes.status).toBe(404)

    const listRes = await jsonFetch('/api/v1/auth/federated-tenants', tenantB)
    const body = (await listRes.json()) as { data: unknown[] }
    expect(body.data).toEqual([])

    const deleteRes = await jsonFetch(`/api/v1/auth/federated-tenants/${created.id}`, tenantB, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(404)
  })
})
