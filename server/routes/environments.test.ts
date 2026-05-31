import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, setupOidcProvider, signIn } from '../test/auth'

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

async function createCredentialVersion(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Environment credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'NPM token',
      type: 'api_key',
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-npm-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  return (await credentialRes.json()) as { activeVersionId: string }
}

async function connectMcp(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'MCP credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'api_key',
      connectorBinding: { connectorId: 'github', name: 'token' },
      secret: { provider: 'cloudflare-secrets', secretValue: 'raw-github-token' },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const mcpCredential = (await credentialRes.json()) as { id: string; activeVersionId: string }
  const res = await jsonFetch('/api/mcp/connections', authorization, {
    method: 'POST',
    body: JSON.stringify({
      connectorId: 'github',
      credentialId: mcpCredential.id,
      credentialVersionId: mcpCredential.activeVersionId,
      approvalMode: 'none',
    }),
  })
  expect([200, 201]).toContain(res.status)
}

describe('[CF] /api/environments', () => {
  beforeEach(async () => {
    await setupOidcProvider()
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
    const authorization = await signIn()
    const credential = await createCredentialVersion(authorization)
    await connectMcp(authorization)
    const createRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Node workspace',
        packages: [{ name: 'tsx', version: 'latest' }],
        variables: { NODE_ENV: { description: 'Runtime mode', required: true } },
        secretRefs: [{ name: 'NPM_TOKEN', ref: credential.activeVersionId }],
        networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
        mcpPolicy: { allowedConnectors: ['github'] },
        packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
        resourceLimits: { memoryMb: 512 },
        runtimeConfig: { image: 'node:24' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      currentVersionId: string
      version: number
      secretRefs: unknown[]
      hostingMode: string
      runtime: string
      runtimeConfig: Record<string, unknown>
      networkPolicy: Record<string, unknown>
    }
    expect(created.version).toBe(1)
    expect(created.hostingMode).toBe('cloud')
    expect(created.runtime).toBe('ama')
    expect(created.runtimeConfig).toEqual({ image: 'node:24' })
    expect(created.networkPolicy).toEqual({ mode: 'restricted', allowedHosts: ['registry.npmjs.org'] })
    expect(created).not.toHaveProperty('runtimeType')
    expect(created).not.toHaveProperty('runtimeImage')
    expect(JSON.stringify(created)).not.toContain('raw-secret')

    const readRes = await jsonFetch(`/api/environments/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      hostingMode: 'cloud',
      runtime: 'ama',
      runtimeConfig: { image: 'node:24' },
      packages: [{ name: 'tsx', version: 'latest' }],
      secretRefs: [{ name: 'NPM_TOKEN', ref: credential.activeVersionId }],
      mcpPolicy: { allowedConnectors: ['github'] },
      packageManagerPolicy: { allowedRegistries: ['registry.npmjs.org'] },
    })

    const updateRes = await jsonFetch(`/api/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { owner: 'runtime' } }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { version: number; currentVersionId: string }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)

    const versionsRes = await jsonFetch(`/api/environments/${created.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{
        version: number
        hostingMode: string
        runtime: string
        runtimeConfig: Record<string, unknown>
        packages: Array<{ name: string }>
      }>
    }
    expect(versions.data.map((version) => version.version)).toEqual([2, 1])
    expect(versions.data.map((version) => version.hostingMode)).toEqual(['cloud', 'cloud'])
    expect(versions.data.map((version) => version.runtime)).toEqual(['ama', 'ama'])
    expect(versions.data.find((version) => version.version === 1)?.runtimeConfig).toEqual({ image: 'node:24' })
    expect(versions.data.find((version) => version.version === 1)?.packages).toEqual([
      { name: 'tsx', version: 'latest' },
    ])

    const archiveRes = await jsonFetch(`/api/environments/${created.id}`, authorization, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const listRes = await jsonFetch('/api/environments', authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/environments?includeArchived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))

    const archivedReadRes = await jsonFetch(`/api/environments/${created.id}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({ archivedAt: expect.any(String) })

    const auditRes = await jsonFetch('/api/audit-records?action=environment.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: created.id, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/environments/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Cannot update archived environments' }),
    })
    expect(archivedUpdateRes.status).toBe(409)
  })

  it('publishes canonical runtime fields and rejects legacy environment fields', async () => {
    const authorization = await signIn()
    for (const runtime of ['ama', 'claude-code', 'codex', 'copilot']) {
      const res = await jsonFetch('/api/environments', authorization, {
        method: 'POST',
        body: JSON.stringify({
          name: `${runtime} workspace`,
          hostingMode: runtime === 'ama' ? 'cloud' : 'self_hosted',
          runtime,
          runtimeConfig: { runtime },
        }),
      })
      expect(res.status).toBe(201)
      await expect(res.json()).resolves.toMatchObject({
        hostingMode: runtime === 'ama' ? 'cloud' : 'self_hosted',
        runtime,
        runtimeConfig: { runtime },
      })
    }

    for (const body of [
      { name: 'legacy runtime type', runtimeType: 'self-hosted' },
      { name: 'legacy runtime image', runtimeImage: { image: 'node:24' } },
      { name: 'invalid hosting', hostingMode: 'self-hosted' },
      { name: 'invalid runtime', runtime: 'pi' },
    ]) {
      const res = await jsonFetch('/api/environments', authorization, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })
    }
  })

  it('validates strict network policy modes with field-level paths', async () => {
    const authorization = await signIn()
    const missingHostsRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Restricted without hosts',
        networkPolicy: { mode: 'restricted' },
      }),
    })
    expect(missingHostsRes.status).toBe(400)
    await expect(missingHostsRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        issues: [expect.objectContaining({ path: ['networkPolicy', 'allowedHosts'] })],
      },
    })

    const unrestrictedHostsRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Unrestricted with hosts',
        networkPolicy: { mode: 'unrestricted', allowedHosts: ['registry.npmjs.org'] },
      }),
    })
    expect(unrestrictedHostsRes.status).toBe(400)
    await expect(unrestrictedHostsRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        issues: [expect.objectContaining({ path: ['networkPolicy', 'allowedHosts'] })],
      },
    })

    const invalidHostRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid host workspace',
        networkPolicy: { mode: 'restricted', allowedHosts: ['https://registry.npmjs.org'] },
      }),
    })
    expect(invalidHostRes.status).toBe(400)
    await expect(invalidHostRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        issues: [expect.objectContaining({ path: ['networkPolicy', 'allowedHosts', 0] })],
      },
    })

    const openModeRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Legacy open workspace',
        networkPolicy: { mode: 'open' },
      }),
    })
    expect(openModeRes.status).toBe(400)
  })

  it('normalizes legacy restricted network policy rows without host lists', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Legacy restricted workspace' }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; currentVersionId: string }
    await env.DB.prepare('UPDATE environments SET network_policy = ? WHERE id = ?')
      .bind(JSON.stringify({ mode: 'restricted', allowedHosts: ['https://registry.npmjs.org'] }), created.id)
      .run()
    await env.DB.prepare('UPDATE environment_versions SET network_policy = ? WHERE id = ?')
      .bind(
        JSON.stringify({ mode: 'restricted', allowedHosts: ['https://registry.npmjs.org'] }),
        created.currentVersionId,
      )
      .run()

    const readRes = await jsonFetch(`/api/environments/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      networkPolicy: { mode: 'unrestricted' },
    })

    const versionsRes = await jsonFetch(`/api/environments/${created.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    await expect(versionsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ networkPolicy: { mode: 'unrestricted' } })],
    })
  })

  it('rejects unavailable secret references and disconnected MCP policy connectors', async () => {
    const authorization = await signIn()
    const invalidSecretRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid secret workspace',
        secretRefs: [{ name: 'NPM_TOKEN', ref: 'vaultver_missing' }],
      }),
    })
    expect(invalidSecretRes.status).toBe(400)
    const invalidSecretBody = await invalidSecretRes.json()
    expect(invalidSecretBody).toMatchObject({
      error: { details: { fields: { 'secretRefs[0]': expect.any(String) } } },
    })
    expect(JSON.stringify(invalidSecretBody)).not.toContain('vaultver_missing')

    const rawSecretRefRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Raw secret workspace',
        secretRefs: [{ name: 'NPM_TOKEN', ref: 'raw-npm-token' }],
      }),
    })
    expect(rawSecretRefRes.status).toBe(400)
    const rawSecretRefBody = await rawSecretRefRes.json()
    expect(rawSecretRefBody).toMatchObject({
      error: { details: { fields: { 'secretRefs[0]': expect.any(String) } } },
    })
    expect(JSON.stringify(rawSecretRefBody)).not.toContain('raw-npm-token')

    const rawMetadataRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw metadata workspace', metadata: { secretValue: 'raw-secret' } }),
    })
    expect(rawMetadataRes.status).toBe(400)
    await expect(rawMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const rawMetadataApiKeyRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw API key workspace', metadata: { api_key: 'raw-secret' } }),
    })
    expect(rawMetadataApiKeyRes.status).toBe(400)
    await expect(rawMetadataApiKeyRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const rawMcpPolicyRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw MCP policy workspace', mcpPolicy: { access_token: 'raw-secret' } }),
    })
    expect(rawMcpPolicyRes.status).toBe(400)
    const rawMcpPolicyBody = await rawMcpPolicyRes.json()
    expect(rawMcpPolicyBody).toMatchObject({
      error: { type: 'validation_error', issues: [expect.objectContaining({ path: ['mcpPolicy'] })] },
    })
    expect(JSON.stringify(rawMcpPolicyBody)).not.toContain('raw-secret')

    const rawPolicyRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw policy workspace', packageManagerPolicy: { npmToken: 'raw-secret' } }),
    })
    expect(rawPolicyRes.status).toBe(400)
    await expect(rawPolicyRes.json()).resolves.toMatchObject({
      error: { details: { fields: { packageManagerPolicy: expect.any(String) } } },
    })

    const invalidMcpRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid MCP workspace', mcpPolicy: { allowedConnectors: ['linear'] } }),
    })
    expect(invalidMcpRes.status).toBe(400)
    await expect(invalidMcpRes.json()).resolves.toMatchObject({
      error: { details: { fields: { mcpPolicy: expect.any(String) } } },
    })

    const environmentRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Update boundary workspace' }),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as { id: string }
    const rawUpdatePolicyRes = await jsonFetch(`/api/environments/${environment.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ mcpPolicy: { token: 'raw-secret' } }),
    })
    expect(rawUpdatePolicyRes.status).toBe(400)
    const rawUpdatePolicyBody = await rawUpdatePolicyRes.json()
    expect(rawUpdatePolicyBody).toMatchObject({
      error: { type: 'validation_error', issues: [expect.objectContaining({ path: ['mcpPolicy'] })] },
    })
    expect(JSON.stringify(rawUpdatePolicyBody)).not.toContain('raw-secret')
  })

  it('lists environments with pagination, search, status, and date filters', async () => {
    const authorization = await signIn()
    const alphaRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha workspace' }),
    })
    const alpha = (await alphaRes.json()) as { id: string; createdAt: string }
    const betaRes = await jsonFetch('/api/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta workspace' }),
    })
    const beta = (await betaRes.json()) as { id: string; createdAt: string }
    await jsonFetch(`/api/environments/${alpha.id}`, authorization, { method: 'DELETE' })

    const pagedRes = await jsonFetch('/api/environments?includeArchived=true&limit=1', authorization)
    const paged = (await pagedRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)
    expect(paged.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/environments?includeArchived=true&limit=1&cursor=${paged.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((environment) => environment.id)).not.toEqual(
      paged.data.map((environment) => environment.id),
    )

    const searchRes = await jsonFetch('/api/environments?includeArchived=true&search=Alpha', authorization)
    const search = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(search.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const statusRes = await jsonFetch('/api/environments?includeArchived=true&status=archived', authorization)
    const status = (await statusRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(status.data).toContainEqual(expect.objectContaining({ id: alpha.id, status: 'archived' }))
    expect(status.data.every((environment) => environment.status === 'archived')).toBe(true)

    const dateRes = await jsonFetch(
      `/api/environments?includeArchived=true&createdFrom=${encodeURIComponent(alpha.createdAt)}&createdTo=${encodeURIComponent(beta.createdAt)}`,
      authorization,
    )
    const date = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(date.data.map((environment) => environment.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]))
  })

  it('returns 404 for cross-project environment access', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/environments', authorization, {
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
