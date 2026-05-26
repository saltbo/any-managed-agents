import { SELF } from 'cloudflare:test'
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

async function createEnvironment(authorization: string) {
  const res = await jsonFetch('/api/environments', authorization, {
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

async function connectMcp(authorization: string) {
  const vaultRes = await jsonFetch('/api/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Agent MCP credentials' }),
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
  const credential = (await credentialRes.json()) as { id: string; activeVersionId: string }
  const connectRes = await jsonFetch('/api/mcp/connections', authorization, {
    method: 'POST',
    body: JSON.stringify({
      connectorId: 'github',
      credentialId: credential.id,
      credentialVersionId: credential.activeVersionId,
    }),
  })
  expect([200, 201]).toContain(connectRes.status)
}

describe('[CF] /api/agents', () => {
  beforeEach(async () => {
    await setupOidcProvider()
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
    const authorization = await signIn()
    await connectMcp(authorization)

    const createRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Research assistant',
        instructions: 'Answer with citations.',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
        allowedTools: ['web.search'],
        mcpConnectors: ['github'],
        sandboxPolicy: { network: 'enabled', filesystem: 'workspace' },
        metadata: { owner: 'platform', remove: 'stale' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; currentVersionId: string; version: number }
    expect(created.version).toBe(1)

    const readRes = await jsonFetch(`/api/agents/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      version: 1,
      allowedTools: ['web.search'],
      mcpConnectors: ['github'],
    })

    const updateRes = await jsonFetch(`/api/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updated description', metadata: { owner: 'runtime', remove: null } }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as {
      version: number
      currentVersionId: string
      description: string
      metadata: Record<string, unknown>
      allowedTools: string[]
    }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)
    expect(updated).toMatchObject({
      description: 'Updated description',
      metadata: { owner: 'runtime' },
      allowedTools: ['web.search'],
    })
    expect(updated.metadata).not.toHaveProperty('remove')

    const clearToolsRes = await jsonFetch(`/api/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ allowedTools: [] }),
    })
    expect(clearToolsRes.status).toBe(200)
    const clearedTools = (await clearToolsRes.json()) as { version: number; allowedTools: string[] }
    expect(clearedTools).toMatchObject({ version: 3, allowedTools: [] })

    const versionsRes = await jsonFetch(`/api/agents/${created.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as { data: Array<{ version: number; instructions: string }> }
    expect(versions.data.map((version) => version.version)).toEqual([3, 2, 1])
    expect(versions.data.find((version) => version.version === 1)?.instructions).toBe('Answer with citations.')

    const archiveRes = await jsonFetch(`/api/agents/${created.id}`, authorization, { method: 'DELETE' })
    expect(archiveRes.status).toBe(204)

    const listRes = await jsonFetch('/api/agents', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/agents?includeArchived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(archivedList.data).toContainEqual(expect.objectContaining({ id: created.id, status: 'archived' }))

    const archivedReadRes = await jsonFetch(`/api/agents/${created.id}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({ archivedAt: expect.any(String) })

    const auditRes = await jsonFetch('/api/audit-records?action=agent.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: created.id, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Cannot update archived agents' }),
    })
    expect(archivedUpdateRes.status).toBe(409)
  })

  it('lists agents with pagination, search, status, and date filters within the project', async () => {
    const authorization = await signIn()
    const createAlphaRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha research' }),
    })
    const alpha = (await createAlphaRes.json()) as { id: string; createdAt: string }
    const createBetaRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta support' }),
    })
    const beta = (await createBetaRes.json()) as { id: string; createdAt: string }
    await jsonFetch(`/api/agents/${alpha.id}`, authorization, { method: 'DELETE' })

    const defaultListRes = await jsonFetch('/api/agents?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ id: string; status: string }>
      pagination: {
        limit: number
        hasMore: boolean
        nextCursor: string | null
        firstId: string | null
        lastId: string | null
      }
    }
    expect(defaultList.data).toEqual([expect.objectContaining({ id: beta.id, status: 'active' })])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, firstId: beta.id, lastId: beta.id })

    const archivedListRes = await jsonFetch('/api/agents?includeArchived=true&limit=1', authorization)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(archivedList.data).toHaveLength(1)
    expect(archivedList.pagination.hasMore).toBe(true)
    expect(archivedList.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/agents?includeArchived=true&limit=1&cursor=${archivedList.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data.map((agent) => agent.id)).not.toEqual(archivedList.data.map((agent) => agent.id))

    const searchRes = await jsonFetch('/api/agents?includeArchived=true&search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const statusRes = await jsonFetch('/api/agents?includeArchived=true&status=archived', authorization)
    const statusList = (await statusRes.json()) as { data: Array<{ id: string; status: string }> }
    expect(statusList.data).toContainEqual(expect.objectContaining({ id: alpha.id, status: 'archived' }))
    expect(statusList.data.every((agent) => agent.status === 'archived')).toBe(true)

    const dateRes = await jsonFetch(
      `/api/agents?includeArchived=true&createdFrom=${encodeURIComponent(alpha.createdAt)}&createdTo=${encodeURIComponent(beta.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((agent) => agent.id)).toEqual(expect.arrayContaining([alpha.id, beta.id]))

    const invalidCursorRes = await jsonFetch('/api/agents?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('keeps session snapshots stable after agent and environment updates', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization)
    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Snapshot agent',
        instructions: 'Original instructions.',
      }),
    })
    const agent = (await agentRes.json()) as { id: string }

    const sessionRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as {
      agentVersionId: string
      agentSnapshot: { version: number; instructions: string }
      environmentVersionId: string
      environmentSnapshot: { version: number; packages: Array<{ name: string }> }
    }
    expect(session.agentSnapshot).toMatchObject({ version: 1, instructions: 'Original instructions.' })
    expect(session.environmentSnapshot.version).toBe(1)

    await jsonFetch(`/api/environments/${environment.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ packages: [{ name: 'vite' }] }),
    })
    await jsonFetch(`/api/agents/${agent.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ instructions: 'New instructions.' }),
    })

    expect(session.agentSnapshot).toMatchObject({ version: 1, instructions: 'Original instructions.' })
    expect(session.environmentSnapshot.packages).toEqual([{ name: 'tsx', version: 'latest' }])
  })

  it('rejects new sessions for archived agents and archived environments', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization)
    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Archived session agent' }),
    })
    const agent = (await agentRes.json()) as { id: string }

    await jsonFetch(`/api/environments/${environment.id}`, authorization, { method: 'DELETE' })
    const archivedEnvironmentSessionRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: agent.id, environmentId: environment.id }),
    })
    expect(archivedEnvironmentSessionRes.status).toBe(409)
    await expect(archivedEnvironmentSessionRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Selected environment is archived or unavailable' },
    })

    const noEnvironmentAgentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Archived agent' }),
    })
    const noEnvironmentAgent = (await noEnvironmentAgentRes.json()) as { id: string }
    await jsonFetch(`/api/agents/${noEnvironmentAgent.id}`, authorization, { method: 'DELETE' })

    const archivedAgentSessionRes = await jsonFetch('/api/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({ agentId: noEnvironmentAgent.id, environmentId: environment.id }),
    })
    expect(archivedAgentSessionRes.status).toBe(409)
    await expect(archivedAgentSessionRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Archived agents cannot create sessions' },
    })
  })

  it('rejects invalid model, blocked tools, invalid sandbox policy, and cross-project reads', async () => {
    const authorization = await signIn()
    const invalidModelRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid model', model: 'blocked-model' }),
    })
    expect(invalidModelRes.status).toBe(400)
    await expect(invalidModelRes.json()).resolves.toMatchObject({
      error: { details: { fields: { model: expect.any(String) } } },
    })

    const blockedToolRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Blocked tool', allowedTools: ['secrets.read'] }),
    })
    expect(blockedToolRes.status).toBe(400)
    await expect(blockedToolRes.json()).resolves.toMatchObject({
      error: { details: { fields: { allowedTools: expect.any(String) } } },
    })

    const invalidPolicyRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid policy', sandboxPolicy: { network: 'maybe' } }),
    })
    expect(invalidPolicyRes.status).toBe(400)

    const invalidMcpRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid MCP agent', mcpConnectors: ['linear'] }),
    })
    expect(invalidMcpRes.status).toBe(400)
    await expect(invalidMcpRes.json()).resolves.toMatchObject({
      error: { details: { fields: { mcpConnectors: expect.any(String) } } },
    })

    const rawSecretMetadataRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw secret agent', metadata: { secretValue: 'raw-secret' } }),
    })
    expect(rawSecretMetadataRes.status).toBe(400)
    await expect(rawSecretMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const rawTokenMetadataRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw token agent', metadata: { access_token: 'raw-secret' } }),
    })
    expect(rawTokenMetadataRes.status).toBe(400)
    await expect(rawTokenMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const validAgentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Valid agent' }),
    })
    expect(validAgentRes.status).toBe(201)

    const createRes = await jsonFetch('/api/agents', authorization, {
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
