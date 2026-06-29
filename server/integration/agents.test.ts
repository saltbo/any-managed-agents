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
  const vault = (await vaultRes.json()) as { id: string }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.id}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'GitHub token',
      type: 'Opaque',
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
        instructions: 'Answer with citations.',
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

  it('rejects removed legacy fields (systemPrompt, allowedTools, provider, status)', async () => {
    const authorization = await signIn()
    for (const body of [
      { name: 'Legacy prompt', systemPrompt: 'Answer with citations.' },
      { name: 'Legacy tools', allowedTools: ['web.search'] },
      { name: 'Legacy provider', provider: 'workers-ai' },
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
        instructions: 'Answer with citations.',
        skills: ['ama@research'],
        role: 'maintainer',
        capabilityTags: ['issue-triage', 'code-review'],
        handoffPolicy: { enabled: true, targets: [{ role: 'reviewer' }] },
        memoryPolicy: { enabled: true, mode: 'notebook', scope: 'project_agent' },
        mcpConnectors: ['github'],
        metadata: { owner: 'platform', remove: 'stale' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      id: string
      currentVersionId: string
      version: number
      providerId: string | null
      archivedAt: string | null
      status?: unknown
      systemPrompt?: unknown
      allowedTools?: unknown
    }
    expect(created.version).toBe(1)
    expect(created.providerId).toBeNull()
    expect(created.archivedAt).toBeNull()
    expect(created.status).toBeUndefined()
    expect(created.systemPrompt).toBeUndefined()
    expect(created.allowedTools).toBeUndefined()

    const readRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: created.id,
      version: 1,
      providerId: null,
      skills: ['ama@research'],
      role: 'maintainer',
      capabilityTags: ['issue-triage', 'code-review'],
      handoffPolicy: { enabled: true, targets: [{ role: 'reviewer' }] },
      memoryPolicy: { enabled: true, mode: 'notebook', scope: 'project_agent' },
      mcpConnectors: ['github'],
      archivedAt: null,
    })

    const updateRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Updated description', metadata: { owner: 'runtime', remove: null } }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as {
      version: number
      currentVersionId: string
      description: string
      metadata: Record<string, unknown>
    }
    expect(updated.version).toBe(2)
    expect(updated.currentVersionId).not.toBe(created.currentVersionId)
    expect(updated).toMatchObject({
      description: 'Updated description',
      metadata: { owner: 'runtime' },
      skills: ['ama@research'],
      role: 'maintainer',
    })
    expect(updated.metadata).not.toHaveProperty('remove')

    const clearPromptRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: null, instructions: null }),
    })
    expect(clearPromptRes.status).toBe(200)
    await expect(clearPromptRes.json()).resolves.toMatchObject({
      version: 3,
      description: null,
      instructions: null,
    })

    const updateRoleRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        role: 'lead',
        capabilityTags: ['planning'],
        handoffPolicy: { enabled: true, targets: [{ capability: 'implementation' }] },
        memoryPolicy: { enabled: false },
      }),
    })
    expect(updateRoleRes.status).toBe(200)
    await expect(updateRoleRes.json()).resolves.toMatchObject({
      version: 4,
      role: 'lead',
      capabilityTags: ['planning'],
      handoffPolicy: { enabled: true, targets: [{ capability: 'implementation' }] },
      memoryPolicy: { enabled: false },
    })

    const versionsRes = await jsonFetch(`/api/v1/agents/${created.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{ version: number; instructions: string | null; role: string | null; providerId: string | null }>
      pagination: Record<string, unknown>
    }
    expect(versions.data.map((version) => version.version)).toEqual([4, 3, 2, 1])
    expect(versions.data.find((version) => version.version === 1)?.instructions).toBe('Answer with citations.')
    expect(versions.data.find((version) => version.version === 3)?.instructions).toBeNull()
    expect(versions.pagination).not.toHaveProperty('firstId')
    expect(versions.pagination).not.toHaveProperty('lastId')

    const versionItemRes = await jsonFetch(`/api/v1/agents/${created.id}/versions/1`, authorization)
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      agentId: created.id,
      version: 1,
      instructions: 'Answer with citations.',
      role: 'maintainer',
    })

    const missingVersionRes = await jsonFetch(`/api/v1/agents/${created.id}/versions/99`, authorization)
    expect(missingVersionRes.status).toBe(404)

    const invalidVersionRes = await jsonFetch(`/api/v1/agents/${created.id}/versions/not-a-number`, authorization)
    expect(invalidVersionRes.status).toBe(400)

    // Archive = PATCH {archived: true}; DELETE no longer exists.
    const deleteRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(404)

    const archiveRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archivedAgent = (await archiveRes.json()) as { archivedAt: string | null }
    expect(archivedAgent.archivedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/v1/agents', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }>; pagination: { hasMore: boolean } }
    expect(list.data).not.toContainEqual(expect.objectContaining({ id: created.id }))
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; archivedAt: string | null }> }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({ id: created.id, archivedAt: expect.any(String) }),
    )

    const archivedReadRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({ archivedAt: expect.any(String) })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=agent.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: created.id, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Cannot update archived agents' }),
    })
    expect(archivedUpdateRes.status).toBe(409)

    // Archiving an archived agent is idempotent.
    const reArchiveRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(reArchiveRes.status).toBe(200)

    const unarchiveRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ archivedAt: null })

    const unarchivedUpdateRes = await jsonFetch(`/api/v1/agents/${created.id}`, authorization, {
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
    const alpha = (await createAlphaRes.json()) as { id: string; createdAt: string }
    const createBetaRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Beta support' }),
    })
    const beta = (await createBetaRes.json()) as { id: string; createdAt: string }
    await jsonFetch(`/api/v1/agents/${alpha.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })

    const defaultListRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ id: string; archivedAt: string | null }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([expect.objectContaining({ id: beta.id, archivedAt: null })])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string; archivedAt: string | null }> }
    expect(archivedList.data).toEqual([expect.objectContaining({ id: alpha.id, archivedAt: expect.any(String) })])

    const searchRes = await jsonFetch('/api/v1/agents?archived=true&search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searchList.data).toEqual([expect.objectContaining({ id: alpha.id })])

    const noMatchSearchRes = await jsonFetch('/api/v1/agents?search=Alpha', authorization)
    const noMatchSearch = (await noMatchSearchRes.json()) as { data: Array<{ id: string }> }
    expect(noMatchSearch.data).toEqual([])

    const dateRes = await jsonFetch(
      `/api/v1/agents?createdFrom=${encodeURIComponent(alpha.createdAt)}&createdTo=${encodeURIComponent(beta.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ id: string }> }
    expect(dateList.data.map((agent) => agent.id)).toEqual([beta.id])

    await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gamma triage' }),
    })
    const firstPageRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ id: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/v1/agents?limit=1&cursor=${firstPage.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ id: string }> }
    expect(nextPage.data).toHaveLength(1)
    expect(nextPage.data.map((agent) => agent.id)).not.toEqual(firstPage.data.map((agent) => agent.id))

    const invalidCursorRes = await jsonFetch('/api/v1/agents?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('validates providerId against configured providers', async () => {
    const authorization = await signIn()

    const missingProviderRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Missing provider agent', providerId: 'provider_missing' }),
    })
    expect(missingProviderRes.status).toBe(400)
    await expect(missingProviderRes.json()).resolves.toMatchObject({
      error: { details: { fields: { providerId: expect.any(String) } } },
    })

    // Null providerId defers provider resolution to session start.
    const deferredRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Deferred provider agent', providerId: null }),
    })
    expect(deferredRes.status).toBe(201)
    await expect(deferredRes.json()).resolves.toMatchObject({ providerId: null })

    // Providers are a global vendor catalog seeded out of band (discovery), not
    // created through the API. Bind the agent to the seeded vendor row.
    const { providerId, modelId } = await seedPlatformProvider()

    const boundRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Bound provider agent', providerId, model: modelId }),
    })
    expect(boundRes.status).toBe(201)
    await expect(boundRes.json()).resolves.toMatchObject({ providerId, model: modelId })

    // An unknown model is accepted at agent creation; (provider, model) validation
    // against the global catalog is deferred to session start.
    const unknownModelRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Unknown model agent', providerId, model: 'unknown-model' }),
    })
    expect(unknownModelRes.status).toBe(201)
    await expect(unknownModelRes.json()).resolves.toMatchObject({ providerId, model: 'unknown-model' })
  })

  it('stores agent memory only for agents with memory enabled and replaces it via PUT', async () => {
    const authorization = await signIn()
    const disabledRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Worker agent' }),
    })
    const disabled = (await disabledRes.json()) as { id: string }
    const disabledMemoryRes = await jsonFetch(`/api/v1/agents/${disabled.id}/memory`, authorization)
    expect(disabledMemoryRes.status).toBe(409)
    await expect(disabledMemoryRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Agent memory is disabled' },
    })

    const enabledRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Maintainer agent',
        memoryPolicy: { enabled: true, mode: 'notebook' },
      }),
    })
    const enabled = (await enabledRes.json()) as { id: string }
    const emptyMemoryRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization)
    expect(emptyMemoryRes.status).toBe(200)
    await expect(emptyMemoryRes.json()).resolves.toMatchObject({
      agentId: enabled.id,
      content: '',
      metadata: {},
    })

    // PATCH is gone: the memory singleton is replaced with PUT.
    const patchMemoryRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ content: 'patched' }),
    })
    expect(patchMemoryRes.status).toBe(404)

    const replaceMemoryRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({
        content: 'Checked stale tasks. Follow up on repo resources next heartbeat.',
        metadata: { format: 'markdown', cursor: 'task-42' },
      }),
    })
    expect(replaceMemoryRes.status).toBe(200)
    await expect(replaceMemoryRes.json()).resolves.toMatchObject({
      agentId: enabled.id,
      content: 'Checked stale tasks. Follow up on repo resources next heartbeat.',
      metadata: { format: 'markdown', cursor: 'task-42' },
    })

    // PUT replaces the whole document: previous metadata keys do not survive.
    const replaceAgainRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ content: 'Fresh notebook.', metadata: { lastHeartbeat: '2026-06-12' } }),
    })
    expect(replaceAgainRes.status).toBe(200)
    const replaced = (await replaceAgainRes.json()) as { content: string; metadata: Record<string, unknown> }
    expect(replaced.content).toBe('Fresh notebook.')
    expect(replaced.metadata).toEqual({ lastHeartbeat: '2026-06-12' })

    const clearMetadataRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ content: 'Notebook without metadata.' }),
    })
    expect(clearMetadataRes.status).toBe(200)
    await expect(clearMetadataRes.json()).resolves.toMatchObject({
      content: 'Notebook without metadata.',
      metadata: {},
    })

    const secretMemoryRes = await jsonFetch(`/api/v1/agents/${enabled.id}/memory`, authorization, {
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
      body: JSON.stringify({ name: 'Raw secret agent', metadata: { secretValue: 'raw-secret' } }),
    })
    expect(rawSecretMetadataRes.status).toBe(400)
    await expect(rawSecretMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { metadata: expect.any(String) } } },
    })

    const rawTokenMetadataRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Raw token agent', metadata: { access_token: 'raw-secret' } }),
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
      body: JSON.stringify({ name: 'Invalid capability', capabilityTags: ['has space'] }),
    })
    expect(invalidCapabilityRes.status).toBe(400)
    await expect(invalidCapabilityRes.json()).resolves.toMatchObject({
      error: { details: { fields: { capabilityTags: expect.any(String) } } },
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
    const agent = (await createRes.json()) as { id: string }
    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      org_id: 'org_flare_456',
      org_name: 'Other Org',
    })

    const crossProjectRead = await jsonFetch(`/api/v1/agents/${agent.id}`, otherAuthorization)
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
      body: JSON.stringify({ name: 'Duplicate tools', tools: [{ name: 'web.search' }, { name: 'web.search' }] }),
    })
    expect(duplicateRes.status).toBe(400)

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Tooled agent',
        tools: [
          {
            name: 'web.search',
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
    const agent = (await createRes.json()) as { id: string; tools: unknown[] }
    expect(agent.tools).toHaveLength(2)

    const versionsRes = await jsonFetch(`/api/v1/agents/${agent.id}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as { data: Array<{ tools: unknown[] }> }
    expect(versions.data[0]?.tools).toEqual([
      {
        name: 'web.search',
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
    const updateRes = await jsonFetch(`/api/v1/agents/${agent.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ tools: [{ name: 'repo.read', approvalMode: 'always_required' }] }),
    })
    expect(updateRes.status).toBe(200)
    const updatedVersionsRes = await jsonFetch(`/api/v1/agents/${agent.id}/versions`, authorization)
    const updatedVersions = (await updatedVersionsRes.json()) as { data: Array<{ tools: Array<{ name: string }> }> }
    expect(updatedVersions.data).toHaveLength(2)
    expect(updatedVersions.data[0]?.tools).toEqual([
      {
        name: 'repo.read',
        description: null,
        inputSchema: {},
        approvalMode: 'always_required',
        policyMetadata: {},
      },
    ])

    const updateBlockedRes = await jsonFetch(`/api/v1/agents/${agent.id}`, authorization, {
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
        handoffPolicy: { targets: [{ role: 'worker' }, { capability: 'implementation' }] },
      }),
    })
    expect(maintainerRes.status).toBe(201)
    const maintainer = (await maintainerRes.json()) as { id: string }

    const workerRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Worker agent', role: 'worker', capabilityTags: ['implementation'] }),
    })
    expect(workerRes.status).toBe(201)
    const worker = (await workerRes.json()) as { id: string }

    const reviewerRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Reviewer agent', role: 'reviewer' }),
    })
    expect(reviewerRes.status).toBe(201)
    const reviewer = (await reviewerRes.json()) as { id: string }

    const otherAuthorization = await signIn({ ...defaultClaims(), sub: 'user_other_project' })
    const foreignWorkerRes = await jsonFetch('/api/v1/agents', otherAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Foreign worker agent', role: 'worker' }),
    })
    expect(foreignWorkerRes.status).toBe(201)

    const policyResolvedRes = await jsonFetch(`/api/v1/agents/${maintainer.id}/handoff-candidates`, authorization)
    expect(policyResolvedRes.status).toBe(200)
    const policyResolved = (await policyResolvedRes.json()) as { data: Array<{ id: string }> }
    expect(policyResolved.data.map((candidate) => candidate.id)).toEqual([worker.id])

    const queryResolvedRes = await jsonFetch(
      `/api/v1/agents/${reviewer.id}/handoff-candidates?capability=implementation`,
      authorization,
    )
    expect(queryResolvedRes.status).toBe(200)
    const queryResolved = (await queryResolvedRes.json()) as {
      data: Array<{ id: string; role: string | null; capabilityTags: string[] }>
    }
    expect(queryResolved.data).toEqual([
      { id: worker.id, name: 'Worker agent', role: 'worker', capabilityTags: ['implementation'] },
    ])

    // Archived agents drop out of candidate resolution.
    await jsonFetch(`/api/v1/agents/${worker.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    const archivedResolvedRes = await jsonFetch(`/api/v1/agents/${maintainer.id}/handoff-candidates`, authorization)
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
    const agent = (await agentRes.json()) as { id: string }

    const res = await jsonFetch(`/api/v1/agents/${agent.id}/handoff-candidates`, authorization)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { target: expect.any(String) } } },
    })

    const missingRes = await jsonFetch('/api/v1/agents/agent_missing/handoff-candidates?role=worker', authorization)
    expect(missingRes.status).toBe(404)
  })
})
