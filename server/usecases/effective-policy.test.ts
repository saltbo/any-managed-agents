import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { readEffectivePolicy } from './effective-policy'
import type { AuditEntry, AuthScope, BudgetRecord, EffectivePolicyResult, PolicyDecisionResult } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const effective: EffectivePolicyResult = {
  source: { type: 'project', id: 'policy_1' },
  sources: [{ scope: 'project', id: 'policy_1', teamId: null }],
  toolPolicy: { blockedTools: ['sandbox.exec'] },
  mcpPolicy: {},
  sandboxPolicy: {},
}

function budgetRecord(): BudgetRecord {
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
  }
}

function fakeDeps(
  overrides: { decision?: PolicyDecisionResult; audit?: AuditEntry[]; scopedTeams?: (string[] | undefined)[] } = {},
): Deps {
  return {
    budgets: { listEnabled: async () => [budgetRecord()] },
    audit: { record: async (_auth: AuthScope, entry: AuditEntry) => void overrides.audit?.push(entry) },
    policy: {
      resolveEffective: async (scoped: AuthScope) => {
        overrides.scopedTeams?.push(scoped.teams)
        return effective
      },
      evaluateProvider: async () =>
        overrides.decision ?? { allowed: true, category: 'provider', rule: null, message: 'ok' },
    },
  } as unknown as Deps
}

describe('[spec: governance/effective-policy] readEffectivePolicy', () => {
  it('resolves the merged policy objects and lists enabled budgets', async () => {
    const result = await readEffectivePolicy(fakeDeps(), auth, {})
    expect(result.toolPolicy).toEqual({ blockedTools: ['sandbox.exec'] })
    expect(result.budgets).toHaveLength(1)
    expect(result.decision).toBeUndefined()
  })

  it('attaches a decision and audits the evaluation when provider+model are given', async () => {
    const audit: AuditEntry[] = []
    const decision: PolicyDecisionResult = {
      allowed: false,
      category: 'provider',
      rule: 'rule_provider',
      message: 'no',
    }
    const deps = fakeDeps({ decision, audit })
    const result = await readEffectivePolicy(deps, auth, { providerId: 'workers-ai', modelId: 'm1' })
    expect(result.decision).toEqual(decision)
    expect(audit).toContainEqual(
      expect.objectContaining({ action: 'policy.evaluate', outcome: 'denied', policyCategory: 'provider' }),
    )
  })

  it('resolves the policy as a member of the requested team', async () => {
    const scopedTeams: (string[] | undefined)[] = []
    await readEffectivePolicy(fakeDeps({ scopedTeams }), auth, { teamId: 'team_platform' })
    expect(scopedTeams).toEqual([['team_platform']])
  })

  it('audits an allowed provider decision with success outcome and omits decision from metadata', async () => {
    const audit: AuditEntry[] = []
    const decision: PolicyDecisionResult = {
      allowed: true,
      category: 'provider',
      rule: null,
      message: 'ok',
    }
    const deps = fakeDeps({ decision, audit })
    const result = await readEffectivePolicy(deps, auth, { providerId: 'workers-ai', modelId: 'm1' })
    expect(result.decision?.allowed).toBe(true)
    expect(audit).toContainEqual(expect.objectContaining({ action: 'policy.evaluate', outcome: 'success' }))
    // metadata must not include 'decision' key when allowed
    const entry = audit.find((e) => e.action === 'policy.evaluate')
    expect(entry?.metadata).not.toHaveProperty('decision')
  })

  it('passes requestId from query into the audit entry', async () => {
    const audit: AuditEntry[] = []
    await readEffectivePolicy(fakeDeps({ audit }), auth, {
      providerId: 'workers-ai',
      modelId: 'm1',
      requestId: 'req_xyz',
    })
    expect(audit).toContainEqual(expect.objectContaining({ requestId: 'req_xyz' }))
  })
})
