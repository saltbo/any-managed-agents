import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usageRecords } from '../db/schema'
import { defaultClaims, setupFlareAuth, signIn } from '../test/auth'

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

async function authContext(authorization: string) {
  const res = await jsonFetch('/api/auth/me', authorization)
  expect(res.status).toBe(200)
  return (await res.json()) as {
    user: { id: string }
    organization: { id: string }
    project: { id: string }
  }
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

describe('[CF] providers, governance, usage, and audit', () => {
  beforeEach(async () => {
    await setupFlareAuth()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists default Workers AI and manages configured providers without exposing credentials', async () => {
    const authorization = await signIn()

    const defaultListRes = await jsonFetch('/api/providers', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ id: string; type: string; credentialSecretRef?: string }>
    }
    expect(defaultList.data).toContainEqual(expect.objectContaining({ id: 'workers-ai', type: 'workers-ai' }))
    expect(JSON.stringify(defaultList)).not.toContain('credentialSecretRef')

    const workersRes = await jsonFetch('/api/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'workers-ai', displayName: 'Workers AI', isDefault: true }),
    })
    expect(workersRes.status).toBe(201)
    const workers = (await workersRes.json()) as { id: string; type: string }
    expect(workers).toMatchObject({ type: 'workers-ai' })
    expect(workers.id).not.toBe('workers-ai')

    const defaultWorkersAgentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Default Workers AI agent' }),
    })
    expect(defaultWorkersAgentRes.status).toBe(201)
    await expect(defaultWorkersAgentRes.json()).resolves.toMatchObject({ provider: 'workers-ai' })

    const explicitWorkersAgentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Explicit Workers AI agent', provider: workers.id }),
    })
    expect(explicitWorkersAgentRes.status).toBe(201)
    await expect(explicitWorkersAgentRes.json()).resolves.toMatchObject({ provider: 'workers-ai' })

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_other_provider',
      email: 'provider-other@example.com',
      org_id: 'org_flare_provider_other',
      org_name: 'Other Provider Org',
    })
    const otherWorkersRes = await jsonFetch('/api/providers', otherCookie, {
      method: 'POST',
      body: JSON.stringify({ type: 'workers-ai', displayName: 'Other Workers AI', isDefault: true }),
    })
    expect(otherWorkersRes.status).toBe(201)

    const externalRes = await jsonFetch('/api/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'openai-compatible',
        displayName: 'Gateway',
        baseUrl: 'https://models.example.test/v1',
        isDefault: true,
        credentialSecretRef: 'secret://providers/gateway/raw-secret-value',
        metadata: { credentialHint: 'raw-secret-value' },
      }),
    })
    expect(externalRes.status).toBe(201)
    const external = (await externalRes.json()) as { id: string; hasCredential: boolean; isDefault: boolean }
    expect(external).toMatchObject({ hasCredential: true, isDefault: true })
    expect(JSON.stringify(external)).not.toContain('raw-secret-value')

    const modelRes = await jsonFetch(`/api/providers/${external.id}/models`, authorization, {
      method: 'POST',
      body: JSON.stringify({ modelId: 'gateway-model', displayName: 'Gateway Model', capabilities: ['text'] }),
    })
    expect(modelRes.status).toBe(201)
    const model = (await modelRes.json()) as { id: string; displayName: string }
    const updateModelRes = await jsonFetch(`/api/providers/${external.id}/models`, authorization, {
      method: 'POST',
      body: JSON.stringify({ modelId: 'gateway-model', displayName: 'Gateway Model v2', capabilities: ['text'] }),
    })
    expect(updateModelRes.status).toBe(201)
    await expect(updateModelRes.json()).resolves.toMatchObject({ id: model.id, displayName: 'Gateway Model v2' })

    const disableRes = await jsonFetch(`/api/providers/${external.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const agentRes = await jsonFetch('/api/agents', authorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Gateway agent', provider: external.id, model: 'gateway-model' }),
    })
    expect(agentRes.status).toBe(400)
    await expect(agentRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { provider: expect.any(String) } } },
    })
  })

  it('returns policy_denied for governance denials and writes safe audit records', async () => {
    const authorization = await signIn()

    const policyRes = await jsonFetch('/api/governance/policy', authorization, {
      method: 'PUT',
      body: JSON.stringify({
        providerRules: [{ providerId: 'workers-ai', effect: 'deny', reason: 'Budget review required.' }],
        budgetPolicy: { monthlyTokens: 10 },
      }),
    })
    expect(policyRes.status).toBe(200)

    const effectiveRes = await jsonFetch('/api/governance/effective-policy', authorization)
    expect(effectiveRes.status).toBe(200)
    await expect(effectiveRes.json()).resolves.toMatchObject({
      providerRules: [expect.objectContaining({ providerId: 'workers-ai', effect: 'deny' })],
    })

    const evaluationRes = await jsonFetch('/api/governance/evaluations', authorization, {
      method: 'POST',
      body: JSON.stringify({ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' }),
    })
    expect(evaluationRes.status).toBe(403)
    await expect(evaluationRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        details: { category: 'provider', resourceType: 'provider', resourceId: 'workers-ai' },
      },
    })

    const auditRes = await jsonFetch('/api/audit-records?action=policy.evaluate', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; outcome: string; metadata: unknown }> }
    expect(audit.data).toContainEqual(expect.objectContaining({ action: 'policy.evaluate', outcome: 'denied' }))
    expect(JSON.stringify(audit)).not.toContain('secret://')
  })

  it('enforces disabled project Workers AI overrides during policy evaluation', async () => {
    const authorization = await signIn({
      ...defaultClaims(),
      sub: 'user_disabled_workers',
      email: 'workers-disabled@example.com',
      org_id: 'org_flare_disabled_workers',
      org_name: 'Disabled Workers Org',
    })
    const workersRes = await jsonFetch('/api/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'workers-ai', displayName: 'Workers AI override' }),
    })
    expect(workersRes.status).toBe(201)
    const workers = (await workersRes.json()) as { id: string }

    const disableRes = await jsonFetch(`/api/providers/${workers.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const evaluationRes = await jsonFetch('/api/governance/evaluations', authorization, {
      method: 'POST',
      body: JSON.stringify({ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' }),
    })
    expect(evaluationRes.status).toBe(403)
    await expect(evaluationRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Provider is disabled for this project.',
        details: { category: 'provider', resourceType: 'provider', resourceId: 'workers-ai', ruleId: workers.id },
      },
    })
  })

  it('applies wildcard provider access rules created with omitted provider and model scopes', async () => {
    const authorization = await signIn({
      ...defaultClaims(),
      sub: 'user_wildcard_access_rule',
      email: 'wildcard-access@example.com',
      org_id: 'org_flare_wildcard_access',
      org_name: 'Wildcard Access Org',
    })

    const accessRuleRes = await jsonFetch('/api/governance/provider-access-rules', authorization, {
      method: 'POST',
      body: JSON.stringify({ effect: 'deny', reason: 'Project-wide model access is paused.' }),
    })
    expect(accessRuleRes.status).toBe(201)
    const accessRule = (await accessRuleRes.json()) as {
      id: string
      providerId: string
      modelId: string
      effect: string
    }
    expect(accessRule).toMatchObject({ providerId: '*', modelId: '*', effect: 'deny' })

    const evaluationRes = await jsonFetch('/api/governance/evaluations', authorization, {
      method: 'POST',
      body: JSON.stringify({ providerId: 'workers-ai', modelId: '@cf/moonshotai/kimi-k2.6' }),
    })
    expect(evaluationRes.status).toBe(403)
    await expect(evaluationRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Project-wide model access is paused.',
        details: { category: 'provider', resourceType: 'provider', resourceId: 'workers-ai', ruleId: accessRule.id },
      },
    })
  })

  it('summarizes usage deterministically for seeded D1 records', async () => {
    const authorization = await signIn()
    const context = await authContext(authorization)
    const db = drizzle(env.DB)
    const createdAt = '2026-05-01T00:00:00.000Z'
    await db.insert(usageRecords).values([
      {
        id: newId('usage'),
        organizationId: context.organization.id,
        projectId: context.project.id,
        agentId: 'agent_alpha',
        agentVersionId: 'agentver_alpha',
        sessionId: 'session_alpha',
        sessionEventId: 'event_alpha',
        correlationId: 'corr_alpha',
        providerId: 'workers-ai',
        providerType: 'workers-ai',
        modelId: '@cf/model-a',
        status: 'success',
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        durationMs: 100,
        costMicros: 25,
        currency: 'USD',
        usageType: 'model',
        metadata: '{}',
        createdAt,
      },
      {
        id: newId('usage'),
        organizationId: context.organization.id,
        projectId: context.project.id,
        agentId: 'agent_alpha',
        agentVersionId: 'agentver_alpha',
        sessionId: 'session_beta',
        sessionEventId: 'event_beta',
        correlationId: 'corr_beta',
        providerId: 'workers-ai',
        providerType: 'workers-ai',
        modelId: '@cf/model-a',
        status: 'error',
        promptTokens: 2,
        completionTokens: 0,
        totalTokens: 2,
        durationMs: 50,
        costMicros: 0,
        currency: 'USD',
        usageType: 'model',
        metadata: '{}',
        createdAt: '2026-05-02T00:00:00.000Z',
      },
    ])

    const summaryRes = await jsonFetch(
      '/api/usage/summary?createdFrom=2026-05-01T00%3A00%3A00.000Z&createdTo=2026-05-31T23%3A59%3A59.999Z&provider=workers-ai&groupBy=provider,model,status',
      authorization,
    )
    expect(summaryRes.status).toBe(200)
    const summary = (await summaryRes.json()) as {
      totals: { records: number; totalTokens: number; costMicros: number }
      groups: Array<{ key: Record<string, string>; records: number; totalTokens: number }>
    }
    expect(summary.totals).toMatchObject({ records: 2, totalTokens: 17, costMicros: 25 })
    expect(summary.groups).toEqual([
      expect.objectContaining({ key: { provider: 'workers-ai', model: '@cf/model-a', status: 'error' }, records: 1 }),
      expect.objectContaining({ key: { provider: 'workers-ai', model: '@cf/model-a', status: 'success' }, records: 1 }),
    ])
  })

  it('exports audit records with secret-like values redacted', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/providers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'openai',
        displayName: 'OpenAI',
        credentialSecretRef: 'secret://provider/openai/top-secret',
        metadata: { apiKey: 'top-secret' },
      }),
    })
    expect(createRes.status).toBe(201)

    const exportRes = await jsonFetch('/api/audit-records/export?action=provider.create', authorization)
    expect(exportRes.status).toBe(200)
    const exported = await exportRes.json()
    expect(JSON.stringify(exported)).not.toContain('top-secret')
    expect(JSON.stringify(exported)).toContain('[REDACTED]')
  })
})
