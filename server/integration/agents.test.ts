import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, seedPlatformProvider, setupOidcProvider, signIn } from './auth'
import { seedPolicy } from './policy-seed'

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

async function connectMcp(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: 'Agent MCP credentials' }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.metadata.uid}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'opaque',
      secret: { stringData: { value: 'raw-github-token' } },
    }),
  })
  expect(credentialRes.status).toBe(201)
  await credentialRes.json()
}

describe('[CF] /api/v1/agents', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/agents', {
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
    const createRes = await SELF.fetch('https://example.com/api/v1/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Research assistant',
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

  it('rejects removed legacy fields (instructions, allowedTools, providerId, status)', async () => {
    const authorization = await signIn()
    for (const body of [
      { name: 'Legacy prompt', instructions: 'Answer with citations.' },
      { name: 'Legacy tools', allowedTools: ['web_search'] },
      { name: 'Legacy provider', providerId: 'workers-ai' },
      { name: 'Legacy status', status: 'active' },
    ]) {
      const res = await jsonFetch('/api/v1/agents', authorization, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        error: { type: 'validation_error', message: 'Invalid request' },
      })
    }
  })

  it('creates, reads, updates, versions, and archives project-scoped agents [spec: agents/api-crud] [spec: agents/api-archive]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization)

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Research assistant',
        systemPrompt: 'Answer with citations.',
        skills: ['ama@research'],
        role: 'maintainer',
        handoff: {
          enabled: true,
          accepts: { roles: ['maintainer'], capabilities: ['issue-triage', 'code-review'] },
          targets: [{ role: 'reviewer' }],
        },
        mcpConnectors: ['github'],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; archivedAt: string | null; description: string | null }
      spec: {
        provider: string | null
        systemPrompt: string | null
        skills: string[]
        role: string | null
        handoff: Record<string, unknown>
        mcpConnectors: string[]
      }
      status: { currentVersionId: string; version: number; phase: string }
      allowedTools?: unknown
    }
    const createdId = created.metadata.uid
    expect(created.status.version).toBe(1)
    expect(created.spec.provider).toBeNull()
    expect(created.metadata.archivedAt).toBeNull()
    expect(created.status.phase).toBe('active')
    expect(created.allowedTools).toBeUndefined()

    const readRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId, archivedAt: null },
      spec: {
        provider: null,
        systemPrompt: 'Answer with citations.',
        skills: ['ama@research'],
        role: 'maintainer',
        handoff: {
          enabled: true,
          accepts: { roles: ['maintainer'], capabilities: ['issue-triage', 'code-review'] },
          targets: [{ role: 'reviewer' }],
        },
        mcpConnectors: ['github'],
      },
      status: { version: 1 },
    })

    const updateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updated description', skills: ['ama@research', 'ama@review'] }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as {
      metadata: { description: string | null }
      spec: { skills: string[]; role: string | null }
      status: { version: number; currentVersionId: string }
    }
    expect(updated.status.version).toBe(2)
    expect(updated.status.currentVersionId).not.toBe(created.status.currentVersionId)
    expect(updated).toMatchObject({
      metadata: { description: 'Updated description' },
      spec: { skills: ['ama@research', 'ama@review'], role: 'maintainer' },
    })

    const clearPromptRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: null, systemPrompt: null }),
    })
    expect(clearPromptRes.status).toBe(200)
    await expect(clearPromptRes.json()).resolves.toMatchObject({
      metadata: { description: null },
      spec: { systemPrompt: null },
      status: { version: 3 },
    })

    const updateRoleRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        role: 'lead',
        handoff: {
          enabled: true,
          accepts: { roles: ['lead'], capabilities: ['planning'] },
          targets: [{ capability: 'implementation' }],
        },
      }),
    })
    expect(updateRoleRes.status).toBe(200)
    await expect(updateRoleRes.json()).resolves.toMatchObject({
      spec: {
        role: 'lead',
        handoff: {
          enabled: true,
          accepts: { roles: ['lead'], capabilities: ['planning'] },
          targets: [{ capability: 'implementation' }],
        },
      },
      status: { version: 4 },
    })

    const versionsRes = await jsonFetch(`/api/v1/agents/${createdId}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{
        spec: { systemPrompt: string | null; role: string | null; provider: string | null }
        status: { version: number }
      }>
      pagination: Record<string, unknown>
    }
    expect(versions.data.map((version) => version.status.version)).toEqual([4, 3, 2, 1])
    expect(versions.data.find((version) => version.status.version === 1)?.spec.systemPrompt).toBe(
      'Answer with citations.',
    )
    expect(versions.data.find((version) => version.status.version === 3)?.spec.systemPrompt).toBeNull()
    expect(versions.pagination).not.toHaveProperty('firstId')
    expect(versions.pagination).not.toHaveProperty('lastId')

    const versionItemRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/1`, authorization)
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      status: { agentId: createdId, version: 1 },
      spec: { systemPrompt: 'Answer with citations.', role: 'maintainer' },
    })

    const missingVersionRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/99`, authorization)
    expect(missingVersionRes.status).toBe(404)

    const invalidVersionRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/not-a-number`, authorization)
    expect(invalidVersionRes.status).toBe(400)

    // Archive = PATCH {archived: true}; DELETE no longer exists.
    const deleteRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(404)

    const archiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archivedAgent = (await archiveRes.json()) as { metadata: { archivedAt: string | null } }
    expect(archivedAgent.metadata.archivedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/v1/agents', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean }
    }
    expect(list.data).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }),
    )
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: createdId, archivedAt: expect.any(String) }),
      }),
    )

    const archivedReadRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({ metadata: { archivedAt: expect.any(String) } })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=agent.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: createdId, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Cannot update archived agents' }),
    })
    expect(archivedUpdateRes.status).toBe(409)

    // Archiving an archived agent is idempotent.
    const reArchiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(reArchiveRes.status).toBe(200)

    const unarchiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ metadata: { archivedAt: null } })

    const unarchivedUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updatable again' }),
    })
    expect(unarchivedUpdateRes.status).toBe(200)
  })

  it('lists agents with pagination, search, archived, and date filters within the project [spec: agents/api-pagination] [spec: api-contracts/pagination] [spec: api-contracts/date-filters]', async () => {
    const authorization = await signIn()
    const createAlphaRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Alpha research' }),
    })
    const alpha = (await createAlphaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const alphaId = alpha.metadata.uid
    const createBetaRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta support' }),
    })
    const beta = (await createBetaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const betaId = beta.metadata.uid
    await jsonFetch(`/api/v1/agents/${alphaId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })

    const defaultListRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ uid: betaId, archivedAt: null }) }),
    ])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ uid: alphaId, archivedAt: expect.any(String) }) }),
    ])

    const searchRes = await jsonFetch('/api/v1/agents?archived=true&search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(searchList.data).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ uid: alphaId }) })])

    const noMatchSearchRes = await jsonFetch('/api/v1/agents?search=Alpha', authorization)
    const noMatchSearch = (await noMatchSearchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(noMatchSearch.data).toEqual([])

    const dateRes = await jsonFetch(
      `/api/v1/agents?createdFrom=${encodeURIComponent(alpha.metadata.createdAt)}&createdTo=${encodeURIComponent(beta.metadata.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(dateList.data.map((agent) => agent.metadata.uid)).toEqual([betaId])

    await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gamma triage' }),
    })
    const firstPageRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/v1/agents?limit=1&cursor=${firstPage.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(nextPage.data).toHaveLength(1)
    expect(nextPage.data.map((agent) => agent.metadata.uid)).not.toEqual(
      firstPage.data.map((agent) => agent.metadata.uid),
    )

    const invalidCursorRes = await jsonFetch('/api/v1/agents?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('validates provider against configured providers', async () => {
    const authorization = await signIn()

    const missingProviderRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Missing provider agent', provider: 'provider_missing' }),
    })
    expect(missingProviderRes.status).toBe(400)
    await expect(missingProviderRes.json()).resolves.toMatchObject({
      error: { details: { fields: { provider: expect.any(String) } } },
    })

    // Null provider defers provider resolution to session start.
    const deferredRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Deferred provider agent', provider: null }),
    })
    expect(deferredRes.status).toBe(201)
    await expect(deferredRes.json()).resolves.toMatchObject({ spec: { provider: null } })

    // Providers are a global vendor catalog seeded out of band (discovery), not
    // created through the API. Bind the agent to the seeded vendor row.
    const { providerId, modelId } = await seedPlatformProvider()

    const boundRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bound provider agent', provider: providerId, model: modelId }),
    })
    expect(boundRes.status).toBe(201)
    await expect(boundRes.json()).resolves.toMatchObject({ spec: { provider: providerId, model: modelId } })

    // An unknown model is accepted at agent creation; (provider, model) validation
    // against the global catalog is deferred to session start.
    const unknownModelRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Unknown model agent', provider: providerId, model: 'unknown-model' }),
    })
    expect(unknownModelRes.status).toBe(201)
    await expect(unknownModelRes.json()).resolves.toMatchObject({
      spec: { provider: providerId, model: 'unknown-model' },
    })
  })

  it('stores and replaces agent memory via PUT', async () => {
    const authorization = await signIn()
    const enabledRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Maintainer agent' }),
    })
    const enabled = (await enabledRes.json()) as { metadata: { uid: string } }
    const enabledId = enabled.metadata.uid
    const emptyMemoryRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization)
    expect(emptyMemoryRes.status).toBe(200)
    await expect(emptyMemoryRes.json()).resolves.toMatchObject({
      spec: { agentId: enabledId, content: '', metadata: {} },
    })

    // PATCH is gone: the memory singleton is replaced with PUT.
    const patchMemoryRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'patched' }),
    })
    expect(patchMemoryRes.status).toBe(404)

    const replaceMemoryRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({
        content: 'Checked stale tasks. Follow up on repo resources next heartbeat.',
        metadata: { format: 'markdown', cursor: 'task-42' },
      }),
    })
    expect(replaceMemoryRes.status).toBe(200)
    await expect(replaceMemoryRes.json()).resolves.toMatchObject({
      spec: {
        agentId: enabledId,
        content: 'Checked stale tasks. Follow up on repo resources next heartbeat.',
        metadata: { format: 'markdown', cursor: 'task-42' },
      },
    })

    // PUT replaces the whole document: previous metadata keys do not survive.
    const replaceAgainRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ content: 'Fresh notebook.', metadata: { lastHeartbeat: '2026-06-12' } }),
    })
    expect(replaceAgainRes.status).toBe(200)
    const replaced = (await replaceAgainRes.json()) as { spec: { content: string; metadata: Record<string, unknown> } }
    expect(replaced.spec.content).toBe('Fresh notebook.')
    expect(replaced.spec.metadata).toEqual({ lastHeartbeat: '2026-06-12' })

    const clearMetadataRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ content: 'Notebook without metadata.' }),
    })
    expect(clearMetadataRes.status).toBe(200)
    await expect(clearMetadataRes.json()).resolves.toMatchObject({
      spec: { content: 'Notebook without metadata.', metadata: {} },
    })

    const secretMemoryRes = await jsonFetch(`/api/v1/agents/${enabledId}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ content: 'x', metadata: { secretValue: 'raw-secret' } }),
    })
    expect(secretMemoryRes.status).toBe(400)
    await expect(secretMemoryRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })
  })

  it('rejects blocked tools, invalid skills, raw secrets, and cross-project reads', async () => {
    const authorization = await signIn()

    const invalidSkillRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid skill', skills: ['missing-style'] }),
    })
    expect(invalidSkillRes.status).toBe(400)
    await expect(invalidSkillRes.json()).resolves.toMatchObject({
      error: { details: { fields: { skills: expect.any(String) } } },
    })

    const invalidMcpRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Invalid MCP agent', mcpConnectors: ['missing-connector'] }),
    })
    expect(invalidMcpRes.status).toBe(400)
    await expect(invalidMcpRes.json()).resolves.toMatchObject({
      error: { details: { fields: { mcpConnectors: expect.any(String) } } },
    })

    const rawSecretMetadataRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw secret agent', subagents: [{ secretValue: 'raw-secret' }] }),
    })
    expect(rawSecretMetadataRes.status).toBe(400)
    await expect(rawSecretMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { subagents: expect.any(String) } } },
    })

    const rawTokenMetadataRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Raw token agent',
        handoff: { enabled: true, accepts: { roles: [], capabilities: ['raw-secret'] }, targets: [] },
      }),
    })
    expect(rawTokenMetadataRes.status).toBe(400)

    const rawSecretSkillRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw secret skill agent', skills: ['ama@raw-secret-token'] }),
    })
    expect(rawSecretSkillRes.status).toBe(400)
    await expect(rawSecretSkillRes.json()).resolves.toMatchObject({
      error: { details: { fields: { skills: expect.any(String) } } },
    })

    const invalidCapabilityRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid capability',
        handoff: { enabled: true, accepts: { roles: [], capabilities: ['has space'] }, targets: [] },
      }),
    })
    expect(invalidCapabilityRes.status).toBe(400)
    await expect(invalidCapabilityRes.json()).resolves.toMatchObject({
      error: { details: { fields: { handoff: expect.any(String) } } },
    })

    const validAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Valid agent' }),
    })
    expect(validAgentRes.status).toBe(201)

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Tenant agent' }),
    })
    const agent = (await createRes.json()) as { metadata: { uid: string } }
    const agentId = agent.metadata.uid
    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })

    const crossProjectRead = await jsonFetch(`/api/v1/agents/${agentId}`, otherAuthorization)
    expect(crossProjectRead.status).toBe(404)
  })

  it('stores the tool attachment contract on agent versions and rejects policy-blocked tools', async () => {
    const authorization = await signIn()
    await seedPolicy({
      authorization,
      scope: { level: 'project' },
      toolPolicy: { blockedTools: ['repo.delete'] },
    })

    const governanceBlockedRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Governance blocked tools', tools: [{ name: 'repo.delete' }] }),
    })
    expect(governanceBlockedRes.status).toBe(400)
    await expect(governanceBlockedRes.json()).resolves.toMatchObject({
      error: { details: { fields: { tools: 'Tool is blocked by policy: repo.delete' } } },
    })

    const platformBlockedRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Platform blocked tools', tools: [{ name: 'secrets.read' }] }),
    })
    expect(platformBlockedRes.status).toBe(400)

    const duplicateRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Duplicate tools', tools: [{ name: 'web_search' }, { name: 'web_search' }] }),
    })
    expect(duplicateRes.status).toBe(400)

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tooled agent',
        tools: [
          {
            name: 'web_search',
            description: 'Search the public web.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
            approvalMode: 'per_call',
            policyMetadata: { sensitivity: 'low' },
          },
          { name: 'repo.read' },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { metadata: { uid: string }; spec: { tools: unknown[] } }
    const agentId = agent.metadata.uid
    expect(agent.spec.tools).toHaveLength(2)

    const versionsRes = await jsonFetch(`/api/v1/agents/${agentId}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as { data: Array<{ spec: { tools: unknown[] } }> }
    expect(versions.data[0]?.spec.tools).toEqual([
      {
        name: 'web_search',
        description: 'Search the public web.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        approvalMode: 'per_call',
        policyMetadata: { sensitivity: 'low' },
      },
      {
        name: 'repo.read',
        description: null,
        inputSchema: {},
        approvalMode: 'project_policy',
        policyMetadata: {},
      },
    ])

    // Updating tools writes a new immutable version with the same contract.
    const updateRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ tools: [{ name: 'repo.read', approvalMode: 'always_required' }] }),
    })
    expect(updateRes.status).toBe(200)
    const updatedVersionsRes = await jsonFetch(`/api/v1/agents/${agentId}/versions`, authorization)
    const updatedVersions = (await updatedVersionsRes.json()) as {
      data: Array<{ spec: { tools: Array<{ name: string }> } }>
    }
    expect(updatedVersions.data).toHaveLength(2)
    expect(updatedVersions.data[0]?.spec.tools).toEqual([
      {
        name: 'repo.read',
        description: null,
        inputSchema: {},
        approvalMode: 'always_required',
        policyMetadata: {},
      },
    ])

    const updateBlockedRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ tools: [{ name: 'repo.delete' }] }),
    })
    expect(updateBlockedRes.status).toBe(400)
  })

  it('resolves handoff candidates by role or capability inside the same project', async () => {
    const authorization = await signIn()

    const maintainerRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Maintainer agent',
        role: 'maintainer',
        handoff: {
          enabled: true,
          accepts: { roles: ['maintainer'], capabilities: [] },
          targets: [{ role: 'worker' }, { capability: 'implementation' }],
        },
      }),
    })
    expect(maintainerRes.status).toBe(201)
    const maintainer = (await maintainerRes.json()) as { metadata: { uid: string } }
    const maintainerId = maintainer.metadata.uid

    const workerRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Worker agent',
        role: 'worker',
        handoff: { enabled: true, accepts: { roles: ['worker'], capabilities: ['implementation'] }, targets: [] },
      }),
    })
    expect(workerRes.status).toBe(201)
    const worker = (await workerRes.json()) as { metadata: { uid: string } }
    const workerId = worker.metadata.uid

    const reviewerRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Reviewer agent', role: 'reviewer' }),
    })
    expect(reviewerRes.status).toBe(201)
    const reviewer = (await reviewerRes.json()) as { metadata: { uid: string } }
    const reviewerId = reviewer.metadata.uid

    const otherAuthorization = await signIn({ ...defaultClaims(), sub: 'user_other_project' })
    const foreignWorkerRes = await jsonFetch('/api/v1/agents', otherAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Foreign worker agent', role: 'worker' }),
    })
    expect(foreignWorkerRes.status).toBe(201)

    const policyResolvedRes = await jsonFetch(`/api/v1/agents/${maintainerId}/handoff-candidates`, authorization)
    expect(policyResolvedRes.status).toBe(200)
    const policyResolved = (await policyResolvedRes.json()) as { data: Array<{ id: string }> }
    expect(policyResolved.data.map((candidate) => candidate.id)).toEqual([workerId])

    const queryResolvedRes = await jsonFetch(
      `/api/v1/agents/${reviewerId}/handoff-candidates?capability=implementation`,
      authorization,
    )
    expect(queryResolvedRes.status).toBe(200)
    const queryResolved = (await queryResolvedRes.json()) as {
      data: Array<{ id: string; role: string | null; capabilities: string[] }>
    }
    expect(queryResolved.data).toEqual([
      { id: workerId, name: 'Worker agent', role: 'worker', capabilities: ['implementation'] },
    ])

    // Archived agents drop out of candidate resolution.
    await jsonFetch(`/api/v1/agents/${workerId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    const archivedResolvedRes = await jsonFetch(`/api/v1/agents/${maintainerId}/handoff-candidates`, authorization)
    expect(archivedResolvedRes.status).toBe(200)
    const archivedResolved = (await archivedResolvedRes.json()) as { data: Array<{ id: string }> }
    expect(archivedResolved.data).toEqual([])
  })

  it('rejects handoff resolution without a requested target or policy targets', async () => {
    const authorization = await signIn()
    const agentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'No-target agent' }),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { metadata: { uid: string } }
    const agentId = agent.metadata.uid

    const res = await jsonFetch(`/api/v1/agents/${agentId}/handoff-candidates`, authorization)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { target: expect.any(String) } } },
    })

    const missingRes = await jsonFetch('/api/v1/agents/agent_missing/handoff-candidates?role=worker', authorization)
    expect(missingRes.status).toBe(404)
  })
})
