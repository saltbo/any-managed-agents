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

// Governance, usage, and audit coverage moved to policies.test.ts,
// access-rules.test.ts, budgets.test.ts, effective-policy.test.ts,
// usage-records.test.ts, usage-summary.test.ts, and audit.test.ts.
describe('[CF] providers', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists default Workers AI and manages configured providers without exposing credentials', async () => {
    const authorization = await signIn()

    const defaultListRes = await jsonFetch('/api/v1/providers', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ id: string; type: string }>
    }
    expect(defaultList.data).toContainEqual(expect.objectContaining({ id: 'workers-ai', type: 'workers-ai' }))
    expect(JSON.stringify(defaultList)).not.toContain('credentialSecretRef')

    const workersRes = await jsonFetch('/api/v1/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'workers-ai', displayName: 'Workers AI', isDefault: true }),
    })
    expect(workersRes.status).toBe(201)
    const workers = (await workersRes.json()) as { id: string; type: string }
    expect(workers).toMatchObject({ type: 'workers-ai' })
    expect(workers.id).not.toBe('workers-ai')

    // A null providerId defers resolution of the project default provider to
    // session start, so it is not auto-filled at creation (docs §Agents).
    const defaultWorkersAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Default Workers AI agent' }),
    })
    expect(defaultWorkersAgentRes.status).toBe(201)
    await expect(defaultWorkersAgentRes.json()).resolves.toMatchObject({ providerId: null })

    const explicitWorkersAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Explicit Workers AI agent', providerId: workers.id }),
    })
    expect(explicitWorkersAgentRes.status).toBe(201)
    await expect(explicitWorkersAgentRes.json()).resolves.toMatchObject({ providerId: workers.id })

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_other_provider',
      email: 'provider-other@example.com',
      org_id: 'org_flare_provider_other',
      org_name: 'Other Provider Org',
    })
    const otherWorkersRes = await jsonFetch('/api/v1/providers', otherCookie, {
      method: 'POST',
      body: JSON.stringify({ type: 'workers-ai', displayName: 'Other Workers AI', isDefault: true }),
    })
    expect(otherWorkersRes.status).toBe(201)

    const externalRes = await jsonFetch('/api/v1/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'openai-compatible',
        displayName: 'Gateway',
        baseUrl: 'https://models.example.test/v1',
        isDefault: true,
        credentialRef: { credentialId: 'cred_gateway', versionId: 'credver_gateway_1' },
        metadata: { region: 'auto' },
      }),
    })
    expect(externalRes.status).toBe(201)
    const external = (await externalRes.json()) as {
      id: string
      credentialStatus: string
      isDefault: boolean
      credentialRef: { credentialId: string } | null
    }
    expect(external).toMatchObject({ credentialStatus: 'configured', isDefault: true })
    expect(JSON.stringify(external)).not.toContain('credentialSecretRef')
    expect(JSON.stringify(external)).not.toContain('hasCredential')

    const modelRes = await jsonFetch(`/api/v1/providers/${external.id}/models/gateway-model`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Gateway Model', capabilities: ['text'] }),
    })
    expect([200, 201]).toContain(modelRes.status)
    const model = (await modelRes.json()) as { id: string; displayName: string }
    const updateModelRes = await jsonFetch(`/api/v1/providers/${external.id}/models/gateway-model`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Gateway Model v2', capabilities: ['text'] }),
    })
    expect([200, 201]).toContain(updateModelRes.status)
    await expect(updateModelRes.json()).resolves.toMatchObject({ id: model.id, displayName: 'Gateway Model v2' })

    const disableRes = await jsonFetch(`/api/v1/providers/${external.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: false }),
    })
    expect(disableRes.status).toBe(200)
    await expect(disableRes.json()).resolves.toMatchObject({ enabled: false })

    const agentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gateway agent', providerId: external.id, model: 'gateway-model' }),
    })
    expect(agentRes.status).toBe(400)
    await expect(agentRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { providerId: expect.any(String) } } },
    })
  })
})
