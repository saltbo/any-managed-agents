import { describe, expect, it } from 'vitest'
import {
  accessRuleView,
  mergePolicyObjects,
  policyScopeChanged,
  validateBudgetScope,
  validatePolicyScope,
} from './policy'

describe('mergePolicyObjects', () => {
  it('unions blocked/denied/requireApproval lists across levels', () => {
    const merged = mergePolicyObjects([{ blockedTools: ['a'] }, { blockedTools: ['b'] }, { blockedTools: ['a', 'c'] }])
    expect(merged.blockedTools).toEqual(['a', 'b', 'c'])
  })

  it('intersects allow lists, with * as identity', () => {
    expect(mergePolicyObjects([{ allowedTools: ['*'] }, { allowedTools: ['a', 'b'] }]).allowedTools).toEqual(['a', 'b'])
    expect(mergePolicyObjects([{ allowedTools: ['a', 'b'] }, { allowedTools: ['b', 'c'] }]).allowedTools).toEqual(['b'])
  })

  it('makes defaultEffect deny sticky', () => {
    expect(mergePolicyObjects([{ defaultEffect: 'deny' }, { defaultEffect: 'allow' }]).defaultEffect).toBe('deny')
    expect(mergePolicyObjects([{ defaultEffect: 'allow' }, { defaultEffect: 'deny' }]).defaultEffect).toBe('deny')
  })

  it('ANDs booleans (false sticky) and takes the minimum number', () => {
    expect(mergePolicyObjects([{ enabled: true }, { enabled: false }]).enabled).toBe(false)
    expect(mergePolicyObjects([{ limit: 10 }, { limit: 3 }, { limit: 7 }]).limit).toBe(3)
  })

  it('keeps a restrictive network string sticky against a later relaxed value', () => {
    expect(mergePolicyObjects([{ network: 'offline' }, { network: 'unrestricted' }]).network).toBe('offline')
  })

  it('shallow-merges nested objects with the most specific level last', () => {
    const merged = mergePolicyObjects([{ approvals: { a: 1, b: 1 } }, { approvals: { b: 2, c: 2 } }])
    expect(merged.approvals).toEqual({ a: 1, b: 2, c: 2 })
  })

  it('takes the most specific scalar for unrelated keys', () => {
    expect(mergePolicyObjects([{ mode: 'a' }, { mode: 'b' }]).mode).toBe('b')
  })
})

describe('validatePolicyScope', () => {
  it('requires teamId for team scope', () => {
    expect(validatePolicyScope({ level: 'team' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'team', teamId: 't1' })).toBeNull()
  })

  it('rejects teamId on non-team scopes', () => {
    expect(validatePolicyScope({ level: 'project', teamId: 't1' })).toEqual({ 'scope.teamId': expect.any(String) })
    expect(validatePolicyScope({ level: 'project' })).toBeNull()
  })
})

describe('policyScopeChanged', () => {
  it('detects level and teamId changes', () => {
    expect(policyScopeChanged({ level: 'project' }, { level: 'project', teamId: null })).toBe(false)
    expect(policyScopeChanged({ level: 'organization' }, { level: 'project', teamId: null })).toBe(true)
    expect(policyScopeChanged({ level: 'team', teamId: 't2' }, { level: 'team', teamId: 't1' })).toBe(true)
  })
})

describe('validateBudgetScope', () => {
  it('requires the matching identifier for provider/model scopes', () => {
    expect(validateBudgetScope({ scope: 'provider' })).toEqual({ providerId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'model' })).toEqual({ modelId: expect.any(String) })
    expect(validateBudgetScope({ scope: 'provider', providerId: 'p1' })).toBeNull()
    expect(validateBudgetScope({ scope: 'project' })).toBeNull()
  })
})

describe('accessRuleView', () => {
  it('drops wildcard scopes and omits an empty reason', () => {
    expect(accessRuleView({ providerId: '*', modelId: '*', effect: 'deny', reason: null })).toEqual({ effect: 'deny' })
    expect(accessRuleView({ providerId: 'p1', modelId: 'm1', effect: 'allow', reason: 'ok' })).toEqual({
      providerId: 'p1',
      modelId: 'm1',
      effect: 'allow',
      reason: 'ok',
    })
  })
})
