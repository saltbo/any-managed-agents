import { describe, expect, it } from 'vitest'
import { updateAccessRule } from './access-rules'
import type { Deps } from './deps'
import type { AccessRuleRecord, AuthScope } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function accessRuleRecord(overrides: Partial<AccessRuleRecord> = {}): AccessRuleRecord {
  return {
    id: 'access_1',
    providerId: '*',
    modelId: '*',
    teamId: null,
    effect: 'deny',
    reason: 'paused',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['accessRules']> = {}): Deps {
  const accessRules: Deps['accessRules'] = {
    list: async () => [],
    find: async () => null,
    findByScope: async () => null,
    insert: async (input, timestamp) => accessRuleRecord({ ...input, createdAt: timestamp, updatedAt: timestamp }),
    update: async (_p, id, fields, updatedAt) => accessRuleRecord({ id, ...fields, updatedAt }),
    delete: async () => {},
    ...repo,
  }
  return { accessRules } as unknown as Deps
}

describe('[spec: governance/access-rule-update] updateAccessRule', () => {
  it('overrides effect and keeps the stored reason when reason is absent', async () => {
    const existing = accessRuleRecord({ effect: 'deny', reason: 'paused' })
    const updated = await updateAccessRule(fakeDeps(), auth, existing, { effect: 'allow' })
    expect(updated.effect).toBe('allow')
    expect(updated.reason).toBe('paused')
  })

  it('clears the reason when explicitly set to null', async () => {
    const existing = accessRuleRecord({ reason: 'paused' })
    const updated = await updateAccessRule(fakeDeps(), auth, existing, { reason: null })
    expect(updated.reason).toBeNull()
  })
})
