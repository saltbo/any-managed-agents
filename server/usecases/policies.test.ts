import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { createPolicy, replacePolicy } from './policies'
import { type AuthScope, GovernanceValidationError, type PolicyRecord } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function policyRecord(overrides: Partial<PolicyRecord> = {}): PolicyRecord {
  return {
    id: 'policy_1',
    projectId: 'project_1',
    scope: { level: 'project' },
    toolPolicy: {},
    mcpPolicy: {},
    sandboxPolicy: {},
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['policies']> = {}): Deps {
  const policies: Deps['policies'] = {
    list: async () => [],
    find: async () => null,
    findByScope: async () => null,
    insert: async (input, timestamp) =>
      policyRecord({ ...input, scope: input.scope, createdAt: timestamp, updatedAt: timestamp }),
    replace: async (_p, id, fields, updatedAt) => policyRecord({ id, ...fields, updatedAt }),
    delete: async () => {},
    ...repo,
  }
  return { policies } as unknown as Deps
}

describe('[spec: governance/policy-create] createPolicy', () => {
  it('inserts a valid scoped policy', async () => {
    const policy = await createPolicy(fakeDeps(), auth, {
      scope: { level: 'project' },
      toolPolicy: { blockedTools: ['a'] },
      mcpPolicy: {},
      sandboxPolicy: {},
      metadata: {},
    })
    expect(policy.scope).toEqual({ level: 'project' })
    expect(policy.toolPolicy).toEqual({ blockedTools: ['a'] })
  })

  it('rejects an invalid team scope', async () => {
    await expect(
      createPolicy(fakeDeps(), auth, {
        scope: { level: 'team' },
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(GovernanceValidationError)
  })

  it('rejects a duplicate scope with the existing id', async () => {
    const deps = fakeDeps({ findByScope: async () => policyRecord({ id: 'policy_existing' }) })
    await expect(
      createPolicy(deps, auth, {
        scope: { level: 'project' },
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
        metadata: {},
      }),
    ).rejects.toMatchObject({ name: 'PolicyScopeConflictError', policyId: 'policy_existing' })
  })
})

describe('[spec: governance/policy-replace] replacePolicy', () => {
  it('replaces the document when the scope is unchanged', async () => {
    const existing = policyRecord({ toolPolicy: { blockedTools: ['old'] } })
    const replaced = await replacePolicy(fakeDeps(), auth, existing, {
      scope: { level: 'project' },
      toolPolicy: {},
      mcpPolicy: { defaultEffect: 'deny' },
      sandboxPolicy: {},
      metadata: {},
    })
    expect(replaced.toolPolicy).toEqual({})
    expect(replaced.mcpPolicy).toEqual({ defaultEffect: 'deny' })
  })

  it('rejects a scope change as immutable', async () => {
    const existing = policyRecord({ scope: { level: 'project' } })
    await expect(
      replacePolicy(fakeDeps(), auth, existing, {
        scope: { level: 'organization' },
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
        metadata: {},
      }),
    ).rejects.toMatchObject({ fields: { scope: expect.any(String) } })
  })
})
