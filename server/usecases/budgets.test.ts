import { describe, expect, it } from 'vitest'
import { createBudget, updateBudget } from './budgets'
import type { Deps } from './deps'
import { type AuthScope, type BudgetRecord, GovernanceValidationError } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function budgetRecord(overrides: Partial<BudgetRecord> = {}): BudgetRecord {
  return {
    id: 'budget_1',
    scope: 'project',
    providerId: null,
    modelId: null,
    limitType: 'tokens',
    limitValue: 1000,
    window: 'month',
    enabled: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['budgets']> = {}): Deps {
  const budgets: Deps['budgets'] = {
    list: async () => [],
    listEnabled: async () => [],
    find: async () => null,
    insert: async (input, timestamp) => budgetRecord({ ...input, createdAt: timestamp, updatedAt: timestamp }),
    update: async (_p, id, fields, updatedAt) => budgetRecord({ id, ...fields, updatedAt }),
    delete: async () => {},
    ...repo,
  }
  return { budgets } as unknown as Deps
}

describe('[spec: governance/budget-create] createBudget', () => {
  it('inserts a project-scoped budget', async () => {
    const budget = await createBudget(fakeDeps(), auth, {
      scope: 'project',
      providerId: null,
      modelId: null,
      limitType: 'tokens',
      limitValue: 5000,
      window: 'month',
      enabled: true,
      metadata: {},
    })
    expect(budget.limitValue).toBe(5000)
  })

  it('rejects a provider-scoped budget with no providerId', async () => {
    await expect(
      createBudget(fakeDeps(), auth, {
        scope: 'provider',
        providerId: null,
        modelId: null,
        limitType: 'tokens',
        limitValue: 1,
        window: 'day',
        enabled: true,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(GovernanceValidationError)
  })
})

describe('[spec: governance/budget-create] createBudget — provider and model scoped', () => {
  it('inserts a provider-scoped budget with a providerId', async () => {
    const budget = await createBudget(fakeDeps(), auth, {
      scope: 'provider',
      providerId: 'workers-ai',
      modelId: null,
      limitType: 'tokens',
      limitValue: 1000,
      window: 'day',
      enabled: true,
      metadata: {},
    })
    expect(budget.scope).toBe('provider')
  })

  it('inserts a model-scoped budget with a modelId', async () => {
    const budget = await createBudget(fakeDeps(), auth, {
      scope: 'model',
      providerId: 'workers-ai',
      modelId: '@cf/llama',
      limitType: 'cost_micros',
      limitValue: 500,
      window: 'day',
      enabled: true,
      metadata: {},
    })
    expect(budget.scope).toBe('model')
  })
})

describe('[spec: governance/budget-update] updateBudget', () => {
  it('merges present fields and keeps the rest', async () => {
    const existing = budgetRecord({ limitValue: 1000, window: 'month', enabled: true })
    const updated = await updateBudget(fakeDeps(), auth, existing, { limitValue: 2000, enabled: false })
    expect(updated.limitValue).toBe(2000)
    expect(updated.enabled).toBe(false)
    expect(updated.window).toBe('month')
  })

  it('keeps existing window when not specified in patch', async () => {
    const existing = budgetRecord({ window: 'day' })
    const updated = await updateBudget(fakeDeps(), auth, existing, { limitValue: 9999 })
    expect(updated.window).toBe('day')
  })

  it('keeps existing metadata when not specified in patch', async () => {
    const existing = budgetRecord({ metadata: { owner: 'team-a' } })
    const updated = await updateBudget(fakeDeps(), auth, existing, { enabled: false })
    expect(updated.metadata).toEqual({ owner: 'team-a' })
  })

  it('keeps existing limitValue when not specified in patch', async () => {
    const existing = budgetRecord({ limitValue: 777 })
    const updated = await updateBudget(fakeDeps(), auth, existing, { window: 'day' })
    expect(updated.limitValue).toBe(777)
  })
})
