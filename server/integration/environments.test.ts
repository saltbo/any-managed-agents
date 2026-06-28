import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, setupOidcProvider, signIn } from './auth'

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

async function createCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Workspace credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'NPM token',
      type: 'api_key',
      connectorBinding: {},
      secret: { secretValue: 'raw-npm-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as { id: string; activeVersionId: string }
}

async function connectMcp(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'MCP credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      secret: { secretValue: 'raw-github-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const mcpCredential = (await credentialRes.json()) as { id: string; activeVersionId: string }
  const connectRes = await jsonFetch('/api/v1/connections', authorization, {
    method: 'POST',
    body: JSON.stringify({
      connectorId: 'github',
      credentialRef: { credentialId: mcpCredential.id, versionId: mcpCredential.activeVersionId },
    }),
  })
  expect(connectRes.status).toBe(201)
}

describe('[CF] /api/v1/environments [spec: environments/api-crud]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/environments', {
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

  it('requires authentication before creating environments', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Node workspace' }),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('rejects removed legacy fields (secretRefs, status)', async () => {
    const authorization = await signIn()
    for (const body of [
      { name: 'Legacy secrets', secretRefs: [{ name: 'NPM_TOKEN', ref: 'vaultver_abc' }] },
      { name: 'Legacy status', status: 'active' },
    ]) {
      const res = await jsonFetch('/api/v1/environments', authorization, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        error: { type: 'validation_error', message: 'Invalid request' },
      })
    }
  })

  it('creates, reads, updates, versions, and archives environments', async () => {
    const authorization = await signIn()
    const credential = await createCredential(authorization)

    const createRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Node workspace',
        description: 'Default Node.js environment.',
        packages: [{ name: 'tsx', version: 'latest' }],
        variables: { NODE_ENV: { description: 'Runtime mode' } },
        credentialRefs: [{ credentialId: credential.id, versionId: credential.activeVersionId }],
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 512 },
        runtimeConfig: { image: 'node:24' },
        metadata: { owner: 'platform' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      currentVersionId: string
      version: number
      archivedAt: string | null
      credentialRefs: Array<{ credentialId: string; versionId?: string }>
      status?: unknown
      secretRefs?: unknown
    }
    expect(created.version).toBe(1)
    expect(created.archivedAt).toBeNull()
    expect(created.status).toBeUndefined()
    expect(created.secretRefs).toBeUndefined()
    expect(created.credentialRefs).toEqual([{ credentialId: credential.id, versionId: credential.activeVersionId }])

    const readRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      version: 1,
      name: 'Node workspace',
      hostingMode: 'cloud',
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
      archivedAt: null,
    })

    const updateRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { version: number; currentVersionId: string }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)

    // Renames do not touch runtime configuration, so the version is kept.
    const renameRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed workspace' }),
    })
    expect(renameRes.status).toBe(200)
    await expect(renameRes.json()).resolves.toMatchObject({ name: 'Renamed workspace', version: 2 })

    const versionsRes = await jsonFetch(`/api/v1/environments/${created.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{ version: number; packages: Array<{ name: string }> }>
      pagination: Record<string, unknown>
    }
    expect(versions.data.map((version) => version.version)).toEqual([2, 1])
    expect(versions.data.find((version) => version.version === 1)?.packages).toEqual([
      { name: 'tsx', version: 'latest' },
    ])
    expect(versions.pagination).not.toHaveProperty('firstId')
    expect(versions.pagination).not.toHaveProperty('lastId')

    const versionItemRes = await jsonFetch(`/api/v1/environments/${created.id}/versions/1`, authorization)
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      environmentId: created.id,
      version: 1,
      packages: [{ name: 'tsx', version: 'latest' }],
      credentialRefs: [{ credentialId: credential.id, versionId: credential.activeVersionId }],
    })

    const missingVersionRes = await jsonFetch(`/api/v1/environments/${created.id}/versions/99`, authorization)
    expect(missingVersionRes.status).toBe(404)

    const invalidVersionRes = await jsonFetch(`/api/v1/environments/${created.id}/versions/not-a-number`, authorization)
    expect(invalidVersionRes.status).toBe(400)

    // Archive = PATCH {archived: true}; DELETE no longer exists.
    const deleteRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(404)

    const archiveRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({ archivedAt: expect.any(String) })

    const listRes = await jsonFetch('/api/v1/environments', authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))

    const archivedListRes = await jsonFetch('/api/v1/environments?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; archivedAt: string | null }> }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({ id: created.id, archivedAt: expect.any(String) }),
    )

    const auditRes = await jsonFetch('/api/v1/audit-records?action=environment.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: created.id, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'esbuild' }] }),
    })
    expect(archivedUpdateRes.status).toBe(409)
    await expect(archivedUpdateRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Archived environments cannot be updated' },
    })

    // Archiving an archived environment is idempotent.
    const reArchiveRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(reArchiveRes.status).toBe(200)

    const unarchiveRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ archivedAt: null })

    const unarchivedUpdateRes = await jsonFetch(`/api/v1/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updatable again' }),
    })
    expect(unarchivedUpdateRes.status).toBe(200)
  })

  it('lists environments with pagination, search, archived, and date filters [spec: environments/api-pagination]', async () => {
    const authorization = await signIn()
    const alphaRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha workspace' }),
    })
    const alpha = (await alphaRes.json()) as { id: string; createdAt: string }
    const betaRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta workspace' }),
    })
    const beta = (await betaRes.json()) as { id: string; createdAt: string }
    await jsonFetch(`/api/v1/environments/${alpha.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })

    const defaultListRes = await jsonFetch('/api/v1/environments?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ id: string; archivedAt: string | null }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([expect.objectContaining({ id: beta.id, archivedAt: null })])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const archivedListRes = await jsonFetch('/api/v1/environments?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string }> }
    expect(archivedList.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const searchRes = await jsonFetch('/api/v1/environments?archived=true&search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const dateRes = await jsonFetch(
      `/api/v1/environments?createdFrom=${encodeURIComponent(alpha.createdAt)}&createdTo=${encodeURIComponent(beta.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((environment) => environment.id)).toEqual([beta.id])

    await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gamma workspace' }),
    })
    const firstPageRes = await jsonFetch('/api/v1/environments?limit=1', authorization)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(
      `/api/v1/environments?limit=1&cursor=${firstPage.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data).toHaveLength(1)
    expect(nextPage.data.map((environment) => environment.id)).not.toEqual(
      firstPage.data.map((environment) => environment.id),
    )

    const invalidCursorRes = await jsonFetch('/api/v1/environments?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('validates credential references against the vault', async () => {
    const authorization = await signIn()
    const credential = await createCredential(authorization)

    const missingCredentialRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Missing credential workspace',
        credentialRefs: [{ credentialId: 'cred_missing' }],
      }),
    })
    expect(missingCredentialRes.status).toBe(400)
    await expect(missingCredentialRes.json()).resolves.toMatchObject({
      error: { details: { fields: { 'credentialRefs[0]': expect.any(String) } } },
    })

    const missingVersionRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Missing version workspace',
        credentialRefs: [{ credentialId: credential.id, versionId: 'credver_missing' }],
      }),
    })
    expect(missingVersionRes.status).toBe(400)
    await expect(missingVersionRes.json()).resolves.toMatchObject({
      error: { details: { fields: { 'credentialRefs[0]': expect.any(String) } } },
    })

    // A bare credential reference (no pinned version) is valid.
    const unpinnedRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unpinned credential workspace',
        credentialRefs: [{ credentialId: credential.id }],
      }),
    })
    expect(unpinnedRes.status).toBe(201)
    await expect(unpinnedRes.json()).resolves.toMatchObject({
      credentialRefs: [{ credentialId: credential.id }],
    })

    // Cross-tenant credentials are invisible.
    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })
    const crossTenantRes = await jsonFetch('/api/v1/environments', otherAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Cross tenant workspace',
        credentialRefs: [{ credentialId: credential.id }],
      }),
    })
    expect(crossTenantRes.status).toBe(400)
    await expect(crossTenantRes.json()).resolves.toMatchObject({
      error: { details: { fields: { 'credentialRefs[0]': expect.any(String) } } },
    })
  })

  it('validates network policy, mcp policy, and secret-free configuration objects [spec: environments/api-validation]', async () => {
    const authorization = await signIn()

    const invalidNetworkRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid network workspace',
        networkPolicy: { mode: 'restricted' },
      }),
    })
    expect(invalidNetworkRes.status).toBe(400)

    const unknownConnectorRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unknown connector workspace',
        mcpPolicy: { allowedConnectors: ['linear'] },
      }),
    })
    expect(unknownConnectorRes.status).toBe(400)
    await expect(unknownConnectorRes.json()).resolves.toMatchObject({
      error: { details: { fields: { mcpPolicy: expect.any(String) } } },
    })

    await connectMcp(authorization)
    const connectedRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Connected workspace',
        mcpPolicy: { allowedConnectors: ['github'], connectorApprovalModes: { github: 'require_approval' } },
      }),
    })
    expect(connectedRes.status).toBe(201)

    const secretMetadataRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Secret metadata workspace',
        metadata: { apiKey: 'raw-secret' },
      }),
    })
    expect(secretMetadataRes.status).toBe(400)
    await expect(secretMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const secretRuntimeRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Secret runtime workspace',
        runtimeConfig: { npmToken: 'raw-secret' },
      }),
    })
    expect(secretRuntimeRes.status).toBe(400)
    await expect(secretRuntimeRes.json()).resolves.toMatchObject({
      error: { details: { fields: { runtimeConfig: expect.any(String) } } },
    })
  })

  it('keeps cross-project environments invisible', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tenant workspace' }),
    })
    expect(createRes.status).toBe(201)
    const environment = (await createRes.json()) as { id: string }

    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })
    const crossReadRes = await jsonFetch(`/api/v1/environments/${environment.id}`, otherAuthorization)
    expect(crossReadRes.status).toBe(404)

    const crossUpdateRes = await jsonFetch(`/api/v1/environments/${environment.id}`, otherAuthorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(crossUpdateRes.status).toBe(404)
  })
})
