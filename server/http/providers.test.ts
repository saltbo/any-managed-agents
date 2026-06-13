import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agents } from '../db/schema'
import { expectAuthRequired, setupOidcProvider, signInUser } from '../test/auth'

async function jsonFetch(path: string, authorization: string | null, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
      ...init.headers,
    },
  })
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

async function createProvider(authorization: string, body: Record<string, unknown>) {
  const res = await jsonFetch('/api/v1/providers', authorization, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as {
    id: string
    projectId: string
    type: string
    displayName: string
    baseUrl: string | null
    isDefault: boolean
    enabled: boolean
    credentialRef: { credentialId: string; versionId?: string } | null
    credentialStatus: string
    modelCatalogState: string
    lastError: Record<string, unknown> | null
  }
}

describe('[CF] providers v1 [spec: providers/api-crud]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication', async () => {
    const res = await jsonFetch('/api/v1/providers', null)
    expect(res.status).toBe(401)
    expectAuthRequired(await res.json())
  })

  it('lists the platform default Workers AI provider with the v1 schema', async () => {
    const authorization = await signInUser('providers_default_list')

    const res = await jsonFetch('/api/v1/providers', authorization)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: Array<Record<string, unknown>> }
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'workers-ai',
        type: 'workers-ai',
        enabled: true,
        credentialRef: null,
        credentialStatus: 'not_required',
        modelCatalogState: 'ready',
      }),
    )
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('hasCredential')
    expect(serialized).not.toContain('credentialSecretRef')
    expect(serialized).not.toContain('"status"')
    expect(serialized).not.toContain('modelCatalogStatus')
  })

  it('creates, reads, updates, and hard-deletes providers', async () => {
    const authorization = await signInUser('providers_crud')

    const created = await createProvider(authorization, {
      type: 'openai-compatible',
      displayName: 'Gateway',
      baseUrl: 'https://models.example.test/v1',
      isDefault: true,
      credentialRef: { credentialId: 'cred_gateway', versionId: 'credver_gateway_1' },
      metadata: { region: 'auto' },
    })
    expect(created).toMatchObject({
      type: 'openai-compatible',
      displayName: 'Gateway',
      baseUrl: 'https://models.example.test/v1',
      isDefault: true,
      enabled: true,
      credentialRef: { credentialId: 'cred_gateway', versionId: 'credver_gateway_1' },
      credentialStatus: 'configured',
      modelCatalogState: 'ready',
      lastError: null,
    })

    const readRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ id: created.id, displayName: 'Gateway' })

    const disableRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    expect(disableRes.status).toBe(200)
    await expect(disableRes.json()).resolves.toMatchObject({ enabled: false })

    const clearCredentialRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ credentialRef: null }),
    })
    expect(clearCredentialRes.status).toBe(200)
    await expect(clearCredentialRes.json()).resolves.toMatchObject({
      credentialRef: null,
      credentialStatus: 'missing',
    })

    const deleteRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const goneRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization)
    expect(goneRes.status).toBe(404)
    await expect(goneRes.json()).resolves.toMatchObject({ error: { type: 'not_found' } })

    // With every configured provider deleted the platform default reappears.
    const listRes = await jsonFetch('/api/v1/providers', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data.map((row) => row.id)).toEqual(['workers-ai'])
  })

  it('deleting the synthesized platform default returns 404', async () => {
    const authorization = await signInUser('providers_delete_virtual')
    const res = await jsonFetch('/api/v1/providers/workers-ai', authorization, { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('validates openai-compatible base URLs on create and update', async () => {
    const authorization = await signInUser('providers_baseurl')

    const createRes = await jsonFetch('/api/v1/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'openai-compatible', displayName: 'No base URL' }),
    })
    expect(createRes.status).toBe(400)
    await expect(createRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { baseUrl: expect.any(String) } } },
    })

    const created = await createProvider(authorization, { type: 'openai', displayName: 'OpenAI' })
    const patchRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ type: 'openai-compatible' }),
    })
    expect(patchRes.status).toBe(400)
    await expect(patchRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { baseUrl: expect.any(String) } } },
    })
  })

  it('keeps a single default provider per project', async () => {
    const authorization = await signInUser('providers_default_unique')

    const first = await createProvider(authorization, {
      type: 'openai',
      displayName: 'First',
      isDefault: true,
    })
    const second = await createProvider(authorization, {
      type: 'anthropic',
      displayName: 'Second',
      isDefault: true,
    })

    const listRes = await jsonFetch('/api/v1/providers', authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string; isDefault: boolean }> }
    expect(list.data.find((row) => row.id === first.id)).toMatchObject({ isDefault: false })
    expect(list.data.find((row) => row.id === second.id)).toMatchObject({ isDefault: true })

    const promoteRes = await jsonFetch(`/api/v1/providers/${first.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ isDefault: true }),
    })
    expect(promoteRes.status).toBe(200)
    const afterRes = await jsonFetch('/api/v1/providers', authorization)
    const after = (await afterRes.json()) as { data: Array<{ id: string; isDefault: boolean }> }
    expect(after.data.find((row) => row.id === first.id)).toMatchObject({ isDefault: true })
    expect(after.data.find((row) => row.id === second.id)).toMatchObject({ isDefault: false })
  })

  it('supports the standard list contract: archived slice is empty, search filters by name', async () => {
    const authorization = await signInUser('providers_list_contract')
    await createProvider(authorization, { type: 'openai', displayName: 'Gateway Alpha' })
    await createProvider(authorization, { type: 'anthropic', displayName: 'Bravo' })

    const archivedRes = await jsonFetch('/api/v1/providers?archived=true', authorization)
    expect(archivedRes.status).toBe(200)
    await expect(archivedRes.json()).resolves.toMatchObject({ data: [] })

    const searchRes = await jsonFetch('/api/v1/providers?search=Alpha', authorization)
    expect(searchRes.status).toBe(200)
    const searched = (await searchRes.json()) as { data: Array<{ displayName: string }> }
    expect(searched.data).toHaveLength(1)
    expect(searched.data[0]).toMatchObject({ displayName: 'Gateway Alpha' })
  })

  it('isolates providers between tenants', async () => {
    const authorization = await signInUser('providers_iso_a')
    const other = await signInUser('providers_iso_b')

    const created = await createProvider(authorization, { type: 'openai', displayName: 'Tenant A provider' })
    const crossReadRes = await jsonFetch(`/api/v1/providers/${created.id}`, other)
    expect(crossReadRes.status).toBe(404)
    const crossDeleteRes = await jsonFetch(`/api/v1/providers/${created.id}`, other, { method: 'DELETE' })
    expect(crossDeleteRes.status).toBe(404)
  })

  it('rejects deleting a provider that agents still reference', async () => {
    const authorization = await signInUser('providers_delete_conflict')
    const created = await createProvider(authorization, { type: 'openai', displayName: 'Referenced' })

    const db = drizzle(env.DB)
    const agentId = newId('agent')
    const timestamp = new Date().toISOString()
    await db.insert(agents).values({
      id: agentId,
      projectId: created.projectId,
      name: 'Provider-bound agent',
      providerId: created.id,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const conflictRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, { method: 'DELETE' })
    expect(conflictRes.status).toBe(409)
    await expect(conflictRes.json()).resolves.toMatchObject({ error: { type: 'conflict' } })

    await db.delete(agents).where(eq(agents.id, agentId))
    const deleteRes = await jsonFetch(`/api/v1/providers/${created.id}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)
  })

  it('upserts provider models via PUT with full-replacement semantics [spec: providers/api-models]', async () => {
    const authorization = await signInUser('providers_model_upsert')
    const provider = await createProvider(authorization, { type: 'openai', displayName: 'Model host' })

    const createRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/gateway-model`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Gateway Model', capabilities: ['text'], contextWindow: 8000 }),
    })
    expect(createRes.status).toBe(201)
    const model = (await createRes.json()) as { id: string; modelId: string }
    expect(model).toMatchObject({ modelId: 'gateway-model', providerId: provider.id })

    const updateRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/gateway-model`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Gateway Model v2' }),
    })
    expect(updateRes.status).toBe(200)
    // PUT is a full replacement: omitted optional fields reset to defaults.
    await expect(updateRes.json()).resolves.toMatchObject({
      id: model.id,
      displayName: 'Gateway Model v2',
      capabilities: [],
      contextWindow: null,
      availability: 'available',
    })

    const listRes = await jsonFetch(`/api/v1/providers/${provider.id}/models`, authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ modelId: string }> }
    expect(list.data).toContainEqual(expect.objectContaining({ modelId: 'gateway-model' }))
  })

  it('accepts URL-encoded model ids containing slashes', async () => {
    const authorization = await signInUser('providers_model_encoded')
    const provider = await createProvider(authorization, { type: 'workers-ai', displayName: 'Workers AI' })

    const modelId = '@cf/moonshotai/kimi-k2.6'
    const encoded = encodeURIComponent(modelId)
    const putRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/${encoded}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Kimi K2.6' }),
    })
    expect(putRes.status).toBe(201)
    await expect(putRes.json()).resolves.toMatchObject({ modelId })

    const deleteRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/${encoded}`, authorization, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)
  })

  it('deletes provider models and 404s afterwards', async () => {
    const authorization = await signInUser('providers_model_delete')
    const provider = await createProvider(authorization, { type: 'openai', displayName: 'Model host' })

    const putRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/doomed-model`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Doomed' }),
    })
    expect(putRes.status).toBe(201)

    const deleteRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/doomed-model`, authorization, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)

    const againRes = await jsonFetch(`/api/v1/providers/${provider.id}/models/doomed-model`, authorization, {
      method: 'DELETE',
    })
    expect(againRes.status).toBe(404)

    const listRes = await jsonFetch(`/api/v1/providers/${provider.id}/models`, authorization)
    const list = (await listRes.json()) as { data: Array<{ modelId: string }> }
    expect(list.data).not.toContainEqual(expect.objectContaining({ modelId: 'doomed-model' }))
  })

  it('returns 404 for model writes on unknown or synthesized providers', async () => {
    const authorization = await signInUser('providers_model_404')

    const missingRes = await jsonFetch('/api/v1/providers/provider_missing/models/some-model', authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Nope' }),
    })
    expect(missingRes.status).toBe(404)

    // The synthesized platform default has no DB row to attach models to.
    const virtualRes = await jsonFetch('/api/v1/providers/workers-ai/models/some-model', authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Nope' }),
    })
    expect(virtualRes.status).toBe(404)
  })

  it('runs model discovery synchronously as an addressable task resource', async () => {
    const authorization = await signInUser('providers_discovery_ok')
    const provider = await createProvider(authorization, {
      type: 'openai-compatible',
      displayName: 'Gateway',
      baseUrl: 'https://models.example.test/v1',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : input.toString())
        if (url.origin === 'https://models.example.test' && url.pathname === '/v1/models') {
          return Response.json({
            data: [{ id: 'gateway-model-a', context_length: 8000 }, { id: 'gateway-model-b' }],
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )

    const taskRes = await jsonFetch(`/api/v1/providers/${provider.id}/model-discovery-tasks`, authorization, {
      method: 'POST',
    })
    expect(taskRes.status).toBe(201)
    const task = (await taskRes.json()) as { id: string; providerId: string; state: string; discoveredCount: number }
    expect(task).toMatchObject({
      providerId: provider.id,
      state: 'succeeded',
      discoveredCount: 2,
      error: null,
    })
    expect(taskRes.headers.get('location')).toBe(`/api/v1/providers/${provider.id}/model-discovery-tasks/${task.id}`)

    const readTaskRes = await jsonFetch(
      `/api/v1/providers/${provider.id}/model-discovery-tasks/${task.id}`,
      authorization,
    )
    expect(readTaskRes.status).toBe(200)
    await expect(readTaskRes.json()).resolves.toMatchObject({ id: task.id, state: 'succeeded', discoveredCount: 2 })

    const modelsRes = await jsonFetch(`/api/v1/providers/${provider.id}/models`, authorization)
    const models = (await modelsRes.json()) as { data: Array<{ modelId: string; contextWindow: number | null }> }
    expect(models.data.map((row) => row.modelId)).toEqual(['gateway-model-a', 'gateway-model-b'])
    expect(models.data[0]).toMatchObject({ contextWindow: 8000 })

    const providerRes = await jsonFetch(`/api/v1/providers/${provider.id}`, authorization)
    await expect(providerRes.json()).resolves.toMatchObject({ modelCatalogState: 'ready', lastError: null })
  })

  it('records failed discovery on the task and provider without leaking credentials', async () => {
    const authorization = await signInUser('providers_discovery_fail')
    const provider = await createProvider(authorization, {
      type: 'openai-compatible',
      displayName: 'Broken gateway',
      baseUrl: 'https://broken.example.test/v1',
      credentialRef: { credentialId: 'cred_top_secret' },
    })

    // setupOidcProvider's fetch stub returns 404 for unknown hosts.
    const taskRes = await jsonFetch(`/api/v1/providers/${provider.id}/model-discovery-tasks`, authorization, {
      method: 'POST',
    })
    expect(taskRes.status).toBe(201)
    const task = (await taskRes.json()) as { id: string; state: string; error: Record<string, unknown> | null }
    expect(task).toMatchObject({
      state: 'failed',
      discoveredCount: null,
      // The stub returns 404 for the discovery host, which the provider adapter
      // classifies as model_unavailable (see provider-adapters.test.ts).
      error: expect.objectContaining({ type: 'provider_error', category: 'model_unavailable', retryable: false }),
    })
    expect(JSON.stringify(task)).not.toContain('cred_top_secret')

    const readTaskRes = await jsonFetch(
      `/api/v1/providers/${provider.id}/model-discovery-tasks/${task.id}`,
      authorization,
    )
    expect(readTaskRes.status).toBe(200)
    await expect(readTaskRes.json()).resolves.toMatchObject({ state: 'failed' })

    const providerRes = await jsonFetch(`/api/v1/providers/${provider.id}`, authorization)
    await expect(providerRes.json()).resolves.toMatchObject({
      modelCatalogState: 'error',
      lastError: expect.objectContaining({ type: 'provider_error', category: 'model_unavailable' }),
    })
  })

  it('discovers the Workers AI catalog for configured workers-ai providers', async () => {
    const authorization = await signInUser('providers_discovery_workers')
    const provider = await createProvider(authorization, { type: 'workers-ai', displayName: 'Workers AI' })

    const taskRes = await jsonFetch(`/api/v1/providers/${provider.id}/model-discovery-tasks`, authorization, {
      method: 'POST',
    })
    expect(taskRes.status).toBe(201)
    await expect(taskRes.json()).resolves.toMatchObject({ state: 'succeeded', discoveredCount: 1 })

    const modelsRes = await jsonFetch(`/api/v1/providers/${provider.id}/models`, authorization)
    const models = (await modelsRes.json()) as { data: Array<{ displayName: string }> }
    expect(models.data).toContainEqual(expect.objectContaining({ displayName: 'Workers AI default model' }))
  })

  it('rejects discovery tasks for the synthesized platform default provider', async () => {
    const authorization = await signInUser('providers_discovery_virtual')
    const res = await jsonFetch('/api/v1/providers/workers-ai/model-discovery-tasks', authorization, {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })

  it('returns 404 for unknown discovery tasks', async () => {
    const authorization = await signInUser('providers_discovery_404')
    const provider = await createProvider(authorization, { type: 'openai', displayName: 'Task host' })
    const res = await jsonFetch(`/api/v1/providers/${provider.id}/model-discovery-tasks/mdtask_missing`, authorization)
    expect(res.status).toBe(404)
  })
})
