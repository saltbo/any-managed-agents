import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedPlatformProvider, setupOidcProvider, signIn } from './auth'

const MODEL_ID = '@cf/moonshotai/kimi-k2.6'

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

function decisionPath(providerId: string, modelId: string) {
  return `/api/v1/effective-policy?providerId=${encodeURIComponent(providerId)}&modelId=${encodeURIComponent(modelId)}`
}

describe('[CF] v1 effective policy', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges policies and enabled budgets into the effective policy [spec: governance/effective-policy-api]', async () => {
    const authorization = await signIn()

    const policyRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: { level: 'project' }, toolPolicy: { blockedTools: ['sandbox.exec'] } }),
    })
    expect(policyRes.status).toBe(201)

    const enabledBudgetRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({ scope: 'project', limitType: 'tokens', limitValue: 1000, window: 'month' }),
    })
    expect(enabledBudgetRes.status).toBe(201)
    const disabledBudgetRes = await jsonFetch('/api/v1/budgets', authorization, {
      method: 'POST',
      body: JSON.stringify({
        scope: 'project',
        limitType: 'sessions',
        limitValue: 5,
        window: 'day',
        enabled: false,
      }),
    })
    expect(disabledBudgetRes.status).toBe(201)

    const effectiveRes = await jsonFetch('/api/v1/effective-policy', authorization)
    expect(effectiveRes.status).toBe(200)
    const effective = (await effectiveRes.json()) as {
      toolPolicy: Record<string, unknown>
      budgets: Array<Record<string, unknown>>
      decision?: unknown
    }
    expect(effective.toolPolicy).toMatchObject({ blockedTools: ['sandbox.exec'] })
    expect(effective.budgets).toEqual([expect.objectContaining({ limitType: 'tokens', enabled: true })])
    expect(effective.decision).toBeUndefined()
  })

  it('attaches a denial decision for providerId+modelId and writes a safe audit record [spec: governance/effective-policy-api]', async () => {
    const authorization = await signIn()

    // A disabled provider denies the provider/model decision. The platform-default
    // workers-ai vendor row resolves by slug; disabling it produces the denial.
    const { providerId } = await seedPlatformProvider({ enabled: false })

    const decisionRes = await jsonFetch(decisionPath('workers-ai', MODEL_ID), authorization)
    expect(decisionRes.status).toBe(200)
    await expect(decisionRes.json()).resolves.toMatchObject({
      decision: {
        allowed: false,
        category: 'provider',
        rule: providerId,
        message: 'Provider is disabled for this project.',
      },
    })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=policy.evaluate', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; outcome: string }> }
    expect(audit.data).toContainEqual(expect.objectContaining({ action: 'policy.evaluate', outcome: 'denied' }))
    expect(JSON.stringify(audit)).not.toContain('secret://')
  })

  it('returns an allowed decision when nothing denies the provider', async () => {
    const authorization = await signIn()

    // The providers catalog is global state shared across tests; seed an enabled
    // workers-ai row so this decision is deterministic regardless of prior tests.
    await seedPlatformProvider({ enabled: true })

    const decisionRes = await jsonFetch(decisionPath('workers-ai', MODEL_ID), authorization)
    expect(decisionRes.status).toBe(200)
    await expect(decisionRes.json()).resolves.toMatchObject({
      decision: { allowed: true, rule: null },
    })
  })

  it('rejects providerId or modelId on their own', async () => {
    const authorization = await signIn()

    const providerOnlyRes = await jsonFetch('/api/v1/effective-policy?providerId=workers-ai', authorization)
    expect(providerOnlyRes.status).toBe(400)
    await expect(providerOnlyRes.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })

    const modelOnlyRes = await jsonFetch(
      `/api/v1/effective-policy?modelId=${encodeURIComponent(MODEL_ID)}`,
      authorization,
    )
    expect(modelOnlyRes.status).toBe(400)
  })

  it('denies disabled providers in the policy decision', async () => {
    const authorization = await signIn()

    // Providers are a global vendor catalog now; disable the workers-ai vendor
    // row directly. Provider policy resolves the row by slug and reports its id.
    const { providerId } = await seedPlatformProvider({ enabled: false })

    const decisionRes = await jsonFetch(decisionPath('workers-ai', MODEL_ID), authorization)
    expect(decisionRes.status).toBe(200)
    await expect(decisionRes.json()).resolves.toMatchObject({
      decision: {
        allowed: false,
        category: 'provider',
        rule: providerId,
        message: 'Provider is disabled for this project.',
      },
    })
  })

  it('resolves team-scoped policies through ?teamId= [spec: governance/policy-change-current]', async () => {
    const authorization = await signIn()

    const teamPolicyRes = await jsonFetch('/api/v1/policies', authorization, {
      method: 'POST',
      body: JSON.stringify({
        scope: { level: 'team', teamId: 'team_platform' },
        toolPolicy: { blockedTools: ['terminal.exec'] },
      }),
    })
    expect(teamPolicyRes.status).toBe(201)

    const withoutTeamRes = await jsonFetch('/api/v1/effective-policy', authorization)
    expect(withoutTeamRes.status).toBe(200)
    const withoutTeam = (await withoutTeamRes.json()) as { toolPolicy: Record<string, unknown> }
    expect(withoutTeam.toolPolicy.blockedTools).toBeUndefined()

    const withTeamRes = await jsonFetch('/api/v1/effective-policy?teamId=team_platform', authorization)
    expect(withTeamRes.status).toBe(200)
    await expect(withTeamRes.json()).resolves.toMatchObject({
      toolPolicy: { blockedTools: ['terminal.exec'] },
      sources: expect.arrayContaining([expect.objectContaining({ scope: 'team', teamId: 'team_platform' })]),
    })
  })
})
